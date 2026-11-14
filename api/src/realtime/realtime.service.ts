import {
  BadGatewayException,
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../prisma/prisma.service';
import {
  allowance,
  toGoogleLanguage,
  tokenRequestBody,
  utcDayStart,
} from './realtime.logic';

const TOKEN_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/auth_tokens';
// The token-authenticated ("Constrained") Live API socket. v1beta only —
// ephemeral tokens do not work on other versions.
const SOCKET_ENDPOINT =
  'wss://generativelanguage.googleapis.com/ws/' +
  'google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained';

export interface RealtimeGrant {
  token: string;
  model: string;
  wsUrl: string;
  targetLanguage: string;
  expiresAt: string;
  maxSeconds: number;
  remainingSecondsToday: number;
}

export interface RealtimeUsage {
  configured: boolean;
  usedSecondsToday: number;
  dailySeconds: number;
  sessionSeconds: number;
}

/**
 * Hands out live-translation sessions on the Realtime page.
 *
 * The browser streams audio to Google itself; this service's whole job is to
 * decide whether a user may start a session and, if so, mint a one-use
 * Gemini ephemeral token locked to one model and one target language. The
 * API key never leaves the server. While the feature is a playground it is
 * free, so the only brake on Google spend is the daily allowance enforced here
 * (and Google's own monthly cap on the billing account).
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
    return Number(this.config.get('REALTIME_SESSION_SECONDS')) || 300;
  }

  private get dailySeconds(): number {
    return Number(this.config.get('REALTIME_DAILY_SECONDS')) || 900;
  }

  private async usedToday(userId: number, now: Date): Promise<number> {
    const agg = await this.prisma.realtimeSession.aggregate({
      where: { userId, createdAt: { gte: utcDayStart(now) } },
      _sum: { grantedSeconds: true },
    });
    return agg._sum.grantedSeconds ?? 0;
  }

  async usage(userId: number): Promise<RealtimeUsage> {
    return {
      configured: Boolean(this.key),
      usedSecondsToday: await this.usedToday(userId, new Date()),
      dailySeconds: this.dailySeconds,
      sessionSeconds: this.sessionSeconds,
    };
  }

  async startSession(userId: number, language: string): Promise<RealtimeGrant> {
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
    const used = await this.usedToday(userId, now);
    const left = allowance(used, this.dailySeconds, this.sessionSeconds);
    if (!left.ok) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Daily live translation limit reached',
          remainingSeconds: left.remainingSeconds,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    let res: Response;
    try {
      res = await this.fetchImpl(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify(
          tokenRequestBody(now, this.model, target, left.grantSeconds),
        ),
      });
    } catch (err) {
      this.logger.error(`Gemini token request failed: ${String(err)}`);
      throw new BadGatewayException(
        'Live translation is unavailable right now',
      );
    }
    const text = await res.text();
    const token = res.ok
      ? (JSON.parse(text) as { name?: string }).name
      : undefined;
    if (!token) {
      // Google's error body names the cause (402 = out of prepaid credit,
      // 429 = rate limit). It never contains our key; the request header does.
      this.logger.error(
        `Gemini refused a token: HTTP ${res.status} ${text.slice(0, 300)}`,
      );
      throw new BadGatewayException(
        'Live translation is unavailable right now',
      );
    }

    // Recorded only once Google has issued the token: a refused request must
    // not use up anyone's allowance.
    await this.prisma.realtimeSession.create({
      data: {
        userId,
        targetLanguage: target,
        grantedSeconds: left.grantSeconds,
      },
    });

    return {
      token,
      model: this.model,
      wsUrl: `${SOCKET_ENDPOINT}?access_token=${encodeURIComponent(token)}`,
      targetLanguage: target,
      expiresAt: new Date(
        now.getTime() + left.grantSeconds * 1000,
      ).toISOString(),
      maxSeconds: left.grantSeconds,
      remainingSecondsToday: Math.max(
        0,
        left.remainingSeconds - left.grantSeconds,
      ),
    };
  }
}
