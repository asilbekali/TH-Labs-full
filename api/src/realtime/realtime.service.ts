import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PaymentRequiredException } from '../payment/payment-required.exception';
import { PaymentService } from '../payment/payment.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  MIN_GRANT_SECONDS,
  allowance,
  isUnlimited,
  paidGrant,
  toGoogleLanguage,
  tokenRequestBody,
} from './realtime.logic';

const TOKEN_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/auth_tokens';
// The token-authenticated ("Constrained") Live API socket. v1beta only —
// ephemeral tokens do not work on other versions.
const SOCKET_ENDPOINT =
  'wss://generativelanguage.googleapis.com/ws/' +
  'google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained';

// First key of the two-int advisory lock, so this lock can never collide with
// another feature locking on a bare user id. Arbitrary, but fixed.
const LOCK_NAMESPACE = 0x52_54_4c; // "RTL"

export interface RealtimeGrant {
  token: string;
  model: string;
  wsUrl: string;
  targetLanguage: string;
  expiresAt: string;
  maxSeconds: number;
  /** Free trial seconds left after this session. */
  trialRemainingSeconds: number;
  /** @deprecated Same as trialRemainingSeconds; kept until clients move over. */
  remainingSecondsToday: number;
  /** Seconds taken from the real-time wallet; 0 while it runs on the trial. */
  chargedSeconds: number;
  /** @deprecated Same as chargedSeconds; kept until clients move over. */
  creditsCharged: number;
  /** No daily allowance for this account (REALTIME_UNLIMITED_EMAILS). */
  unlimited: boolean;
}

export interface RealtimeUsage {
  configured: boolean;
  unlimited: boolean;
  /** The one-time free trial, in seconds (REALTIME_TRIAL_SECONDS). */
  trialSeconds: number;
  /** Trial seconds granted so far; paid sessions are not counted. */
  trialUsedSeconds: number;
  trialRemainingSeconds: number;
  /** Bought real-time time left (User.realtimeSeconds), used after the trial. */
  balanceSeconds: number;
  /** Trial left plus bought time: the total a user can still dub live. */
  availableSeconds: number;
  sessionSeconds: number;
  /** @deprecated Same as trialUsedSeconds; kept until clients move over. */
  usedSecondsToday: number;
  /** @deprecated Same as trialSeconds; kept until clients move over. */
  dailySeconds: number;
}

/**
 * Hands out live-translation sessions on the Realtime page.
 *
 * The browser streams audio to Google itself; this service's whole job is to
 * decide whether a user may start a session and, if so, mint a one-use
 * Gemini ephemeral token locked to one model and one target language. The
 * API key never leaves the server. Every account gets a one-time free trial;
 * after it a session takes its seconds from the real-time wallet — bought
 * minutes, kept apart from the AI-dubbing token balance.
 */
@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);

  /** Overridable for tests. */
  fetchImpl: (url: string, init: RequestInit) => Promise<Response> = (
    url,
    init,
  ) => fetch(url, init);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly payments: PaymentService,
  ) {}

  private get key(): string | undefined {
    return this.config.get<string>('GEMINI_API_KEY') || undefined;
  }

  private get model(): string {
    return (
      this.config.get<string>('REALTIME_MODEL') ||
      'gemini-3.5-live-translate-preview'
    );
  }

  private get sessionSeconds(): number {
    return Number(this.config.get('REALTIME_SESSION_SECONDS')) || 60;
  }

  private get trialSeconds(): number {
    return Number(this.config.get('REALTIME_TRIAL_SECONDS')) || 600;
  }

  private unlimited(email: string | undefined): boolean {
    return isUnlimited(
      email,
      this.config.get<string>('REALTIME_UNLIMITED_EMAILS'),
    );
  }

  /** Free trial seconds granted so far, ever, and how many the trial has. */
  private async freeTime(
    userId: number,
    db: Pick<PrismaService, 'realtimeSession'> = this.prisma,
  ): Promise<{ used: number; limit: number }> {
    const agg = await db.realtimeSession.aggregate({
      where: { userId, chargedSeconds: 0 },
      _sum: { grantedSeconds: true },
    });
    return { used: agg._sum.grantedSeconds ?? 0, limit: this.trialSeconds };
  }

  private async balance(
    userId: number,
    db: Pick<PrismaService, 'user'> = this.prisma,
  ): Promise<number> {
    // The real-time wallet only, in seconds: AI-dubbing tokens never pay for
    // live time.
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { realtimeSeconds: true },
    });
    return user?.realtimeSeconds ?? 0;
  }

  private outOfTime(balance: number): PaymentRequiredException {
    return new PaymentRequiredException({
      reason: 'INSUFFICIENT_CREDITS',
      message:
        'Your free live minutes are used up and you have no real-time ' +
        'minutes left. Buy real-time minutes to keep going.',
      // All in seconds: a session needs at least MIN_GRANT_SECONDS of them.
      cost: MIN_GRANT_SECONDS,
      balance,
      affordableSeconds: balance,
    });
  }

  async usage(userId: number, email?: string): Promise<RealtimeUsage> {
    const [free, balance] = await Promise.all([
      this.freeTime(userId),
      this.balance(userId),
    ]);
    const trialRemainingSeconds = Math.max(0, free.limit - free.used);
    return {
      configured: Boolean(this.key),
      unlimited: this.unlimited(email),
      trialSeconds: free.limit,
      trialUsedSeconds: free.used,
      trialRemainingSeconds,
      balanceSeconds: balance,
      availableSeconds: trialRemainingSeconds + balance,
      sessionSeconds: this.sessionSeconds,
      usedSecondsToday: free.used,
      dailySeconds: free.limit,
    };
  }

  async startSession(
    userId: number,
    language: string,
    email?: string,
  ): Promise<RealtimeGrant> {
    const key = this.key;
    if (!key) {
      throw new ServiceUnavailableException(
        'Live translation is not configured',
      );
    }
    const target = toGoogleLanguage(language);
    if (!target) {
      throw new BadRequestException(
        `Live translation does not support "${language}"`,
      );
    }

    const now = new Date();
    // Listed testers skip the trial limit, not the session length; their
    // sessions are still recorded so the spend stays visible.
    const unlimited = this.unlimited(email);
    // Reserve before asking Google. Reading the trial used so far, checking it and
    // writing the row happen under a per-user advisory lock, so simultaneous
    // requests (two tabs, a script) queue instead of all reading the same
    // total. The row is removed again if Google refuses, so a failed start
    // costs nothing.
    const { left, cost, balance, reservation } = await this.prisma.$transaction(
      async (tx) => {
        // ::int casts are required: Prisma sends numbers as bigint, and the
        // two-key pg_advisory_xact_lock only exists for (int, int).
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK_NAMESPACE}::int, ${userId}::int)`;
        const free = await this.freeTime(userId, tx);
        const left = unlimited
          ? {
              ok: true,
              remainingSeconds: this.sessionSeconds,
              grantSeconds: this.sessionSeconds,
            }
          : allowance(free.used, free.limit, this.sessionSeconds);
        // Trial first, then bought time. A session is one or the other, never a
        // mix, so a free remainder too short to grant is simply left unused.
        const balance = left.ok ? 0 : await this.balance(userId, tx);
        const paid = left.ok ? null : paidGrant(balance, this.sessionSeconds);
        if (paid && !paid.ok) {
          return { left, cost: 0, balance, reservation: null };
        }
        const cost = paid?.cost ?? 0;
        const reservation = await tx.realtimeSession.create({
          data: {
            userId,
            targetLanguage: target,
            grantedSeconds: paid?.grantSeconds ?? left.grantSeconds,
            chargedSeconds: cost,
          },
        });
        return { left, cost, balance, reservation };
      },
    );
    if (!reservation) throw this.outOfTime(balance);
    const grantSeconds = reservation.grantedSeconds;
    const release = () =>
      this.prisma.realtimeSession
        .delete({ where: { id: reservation.id } })
        .catch((err: unknown) =>
          this.logger.error(`Could not release a reservation: ${String(err)}`),
        );

    let res: Response;
    try {
      res = await this.fetchImpl(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify(
          tokenRequestBody(now, this.model, target, grantSeconds),
        ),
      });
    } catch (err) {
      await release();
      this.logger.error(`Gemini token request failed: ${String(err)}`);
      throw new BadGatewayException(
        'Live translation is unavailable right now',
      );
    }
    const text = await res.text();
    let token: string | undefined;
    try {
      token = res.ok ? (JSON.parse(text) as { name?: string }).name : undefined;
    } catch {
      token = undefined; // a garbled 200 is a refusal like any other
    }
    if (!token) {
      await release();
      // Google's error body names the cause (402 = out of prepaid credit,
      // 429 = rate limit). It never contains our key; the request header does.
      this.logger.error(
        `Gemini refused a token: HTTP ${res.status} ${text.slice(0, 300)}`,
      );
      throw new BadGatewayException(
        'Live translation is unavailable right now',
      );
    }

    // Charged once Google has agreed and before the token is handed over: a
    // refusal needs no refund, and a token that was not paid for is dropped.
    if (cost > 0) {
      try {
        await this.payments.spendRealtimeSeconds(
          userId,
          cost,
          reservation.id,
          `real-time dubbing (${grantSeconds}s ${target})`,
        );
      } catch (err) {
        await release();
        // Another spend got to the balance first; anything else is a fault.
        if (err instanceof BadRequestException) {
          throw this.outOfTime(await this.balance(userId));
        }
        throw err;
      }
    }

    const trialLeft = Math.max(0, left.remainingSeconds - left.grantSeconds);
    return {
      token,
      model: this.model,
      wsUrl: `${SOCKET_ENDPOINT}?access_token=${encodeURIComponent(token)}`,
      targetLanguage: target,
      expiresAt: new Date(now.getTime() + grantSeconds * 1000).toISOString(),
      maxSeconds: grantSeconds,
      trialRemainingSeconds: trialLeft,
      remainingSecondsToday: trialLeft,
      chargedSeconds: cost,
      creditsCharged: cost,
      unlimited,
    };
  }
}
