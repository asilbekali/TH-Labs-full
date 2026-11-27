import {
  BadGatewayException,
  BadRequestException,
  HttpException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import type { PaymentService } from '../payment/payment.service';
import type { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from './realtime.service';

const KEY = 'test-gemini-key-must-not-leak';

function setup(
  opts: {
    key?: string;
    /** Free trial seconds granted before the test starts. */
    usedTrial?: number;
    /** Bought seconds in the real-time wallet. */
    seconds?: number;
    /** The balance is spent elsewhere while Google is answering. */
    spentMeanwhile?: boolean;
    google?: Response;
    googleDelayMs?: number;
  } = {},
) {
  type Row = {
    userId: number;
    targetLanguage: string;
    grantedSeconds: number;
    chargedSeconds: number;
  };
  const rows: (Row & { id: string })[] = [];
  // A stand-in that behaves like the database where it matters: the sum
  // reflects rows actually written, and transactions run one at a time (the
  // per-user advisory lock serialises them in Postgres).
  let chain: Promise<unknown> = Promise.resolve();
  const table = {
    aggregate: jest.fn(() => {
      const sum =
        (opts.usedTrial ?? 0) +
        rows
          .filter((r) => r.chargedSeconds === 0)
          .reduce((s, r) => s + r.grantedSeconds, 0);
      return Promise.resolve({ _sum: { grantedSeconds: sum || null } });
    }),
    create: jest.fn(({ data }: { data: Row }) => {
      const row = { id: `r${rows.length + 1}`, ...data };
      rows.push(row);
      return Promise.resolve(row);
    }),
    delete: jest.fn(({ where }: { where: { id: string } }) => {
      const i = rows.findIndex((r) => r.id === where.id);
      if (i >= 0) rows.splice(i, 1);
      return Promise.resolve({});
    }),
  };
  // realtimeSeconds is the real-time wallet; `credits` is the AI-dubbing one,
  // which a live session must never read or touch.
  const wallet = { realtimeSeconds: opts.seconds ?? 0, credits: 5000 };
  const user = { findUnique: jest.fn(() => Promise.resolve({ ...wallet })) };
  const tx = { realtimeSession: table, user, $executeRaw: jest.fn(() => 1) };
  const prisma = {
    realtimeSession: table,
    user,
    $transaction: jest.fn(<T>(fn: (t: typeof tx) => Promise<T>): Promise<T> => {
      const run = chain.then(() => fn(tx));
      chain = run.catch(() => undefined);
      return run;
    }),
  };
  const env: Record<string, unknown> = {
    GEMINI_API_KEY: 'key' in opts ? opts.key : KEY,
    REALTIME_MODEL: 'gemini-3.5-live-translate-preview',
    REALTIME_SESSION_SECONDS: 300,
    REALTIME_TRIAL_SECONDS: 600,
    REALTIME_UNLIMITED_EMAILS: 'Tester@Example.com, other@example.com',
  };
  const config = { get: (k: string) => env[k] };
  // Guarded like the real one: the balance never goes negative.
  const spendCredits = jest.fn((_user: number, amount: number) => {
    if (opts.spentMeanwhile) wallet.realtimeSeconds = 0;
    if (wallet.realtimeSeconds < amount) {
      return Promise.reject(new BadRequestException('INSUFFICIENT_CREDITS'));
    }
    wallet.realtimeSeconds -= amount;
    return Promise.resolve(wallet.realtimeSeconds);
  });
  // The AI-dubbing spend: present so a test can prove it is never called.
  const spendDubCredits = jest.fn();
  const service = new RealtimeService(
    prisma as unknown as PrismaService,
    config as unknown as ConfigService,
    {
      spendRealtimeSeconds: spendCredits,
      spendCredits: spendDubCredits,
    } as unknown as PaymentService,
  );
  const fetchImpl = jest.fn<Promise<Response>, [string, RequestInit]>(
    async () => {
      if (opts.googleDelayMs) {
        await new Promise((r) => setTimeout(r, opts.googleDelayMs));
      }
      return (
        opts.google ??
        new Response(JSON.stringify({ name: 'auth_tokens/abc123' }), {
          status: 200,
        })
      );
    },
  );
  service.fetchImpl = fetchImpl;
  return {
    service,
    prisma,
    fetchImpl,
    rows,
    spendCredits,
    spendDubCredits,
    wallet,
  };
}

describe('RealtimeService.startSession', () => {
  it('is unavailable without a Gemini key, and never calls Google', async () => {
    const { service, fetchImpl } = setup({ key: undefined });
    await expect(service.startSession(7, 'uz')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses a language outside the catalog', async () => {
    const { service, fetchImpl } = setup();
    await expect(service.startSession(7, 'xx')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('grants the last 300 s of the trial and records them', async () => {
    const { service, rows } = setup({ usedTrial: 300 });
    const grant = await service.startSession(7, 'uz');
    expect(rows).toEqual([
      expect.objectContaining({
        userId: 7,
        targetLanguage: 'uz',
        grantedSeconds: 300,
      }),
    ]);
    expect(grant.maxSeconds).toBe(300);
    expect(grant.trialRemainingSeconds).toBe(0);
    expect(grant.targetLanguage).toBe('uz');
  });

  it('cannot be raced: simultaneous requests get only what the trial has left', async () => {
    // 300 s used, 300 s left: of three requests in flight at once (Google
    // answering slowly), exactly one may get a session.
    const { service, rows } = setup({ usedTrial: 300, googleDelayMs: 30 });
    const results = await Promise.allSettled([
      service.startSession(7, 'uz'),
      service.startSession(7, 'uz'),
      service.startSession(7, 'uz'),
    ]);
    const granted = results.filter((r) => r.status === 'fulfilled');
    const refused = results.filter(
      (r) =>
        r.status === 'rejected' &&
        r.reason instanceof HttpException &&
        r.reason.getStatus() === 402,
    );
    expect(granted).toHaveLength(1);
    expect(refused).toHaveLength(2);
    expect(rows.reduce((s, r) => s + r.grantedSeconds, 0)).toBe(300);
  });

  it('refuses when free time and tokens are both gone, without asking Google', async () => {
    const { service, fetchImpl, rows } = setup({ usedTrial: 600 });
    const err: unknown = await service
      .startSession(7, 'uz')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(402);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(rows).toEqual([]);
  });

  it('records nothing when Google refuses the token', async () => {
    const { service, rows } = setup({
      google: new Response('{"error":{"code":402}}', { status: 402 }),
    });
    await expect(service.startSession(7, 'uz')).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    expect(rows).toEqual([]);
  });

  it('treats a garbled reply from Google as a refusal, and keeps nothing', async () => {
    const { service, rows } = setup({
      google: new Response('<html>oops</html>', { status: 200 }),
    });
    await expect(service.startSession(7, 'uz')).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    expect(rows).toEqual([]);
  });

  it('hands out a socket URL with the token and never the key', async () => {
    const { service, fetchImpl } = setup();
    const grant = await service.startSession(7, 'zh');
    expect(grant.wsUrl).toContain(
      'BidiGenerateContentConstrained?access_token=auth_tokens%2Fabc123',
    );
    expect(grant.token).toBe('auth_tokens/abc123');
    expect(grant.targetLanguage).toBe('zh-Hans');
    expect(JSON.stringify(grant)).not.toContain(KEY);
    const [, init] = fetchImpl.mock.calls[0];
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe(
      KEY,
    );
  });
});

describe('RealtimeService paid sessions', () => {
  it('uses the trial before touching bought minutes', async () => {
    const { service, spendCredits, rows } = setup({
      seconds: 3600,
    });
    const grant = await service.startSession(7, 'uz');
    expect(grant.creditsCharged).toBe(0);
    expect(rows).toEqual([expect.objectContaining({ chargedSeconds: 0 })]);
    expect(spendCredits).not.toHaveBeenCalled();
  });

  it('takes a minute of bought time per minute once the trial is gone', async () => {
    const { service, spendCredits, rows, wallet } = setup({
      usedTrial: 600,
      seconds: 80,
    });
    const grant = await service.startSession(7, 'uz');
    expect(grant).toMatchObject({ maxSeconds: 60, chargedSeconds: 60 });
    expect(wallet.realtimeSeconds).toBe(20);
    expect(spendCredits).toHaveBeenCalledWith(7, 60, 'r1', expect.any(String));
    expect(rows).toEqual([
      expect.objectContaining({ grantedSeconds: 60, chargedSeconds: 60 }),
    ]);
    // 20 s left is under the 30 s minimum
    await expect(service.startSession(7, 'uz')).rejects.toMatchObject({
      status: 402,
    });
    expect(wallet.realtimeSeconds).toBe(20);
  });

  it('does not count paid minutes against the trial', async () => {
    const { service } = setup({ usedTrial: 600, seconds: 300 });
    await service.startSession(7, 'uz');
    expect((await service.usage(7)).trialUsedSeconds).toBe(600);
  });

  it('takes nothing when Google refuses', async () => {
    const { service, wallet, rows, spendCredits } = setup({
      usedTrial: 600,
      seconds: 300,
      google: new Response('{"error":{"code":402}}', { status: 402 }),
    });
    await expect(service.startSession(7, 'uz')).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    expect(spendCredits).not.toHaveBeenCalled();
    expect(wallet.realtimeSeconds).toBe(300);
    expect(rows).toEqual([]);
  });

  it('hands out no token when the balance is gone by the time it is charged', async () => {
    const { service, rows } = setup({
      usedTrial: 600,
      seconds: 300,
      spentMeanwhile: true,
    });
    await expect(service.startSession(7, 'uz')).rejects.toMatchObject({
      status: 402,
    });
    expect(rows).toEqual([]);
  });

  it('cannot be raced past the balance', async () => {
    const { service, rows, wallet } = setup({
      usedTrial: 600,
      seconds: 80,
      googleDelayMs: 20,
    });
    const results = await Promise.allSettled([
      service.startSession(7, 'uz'),
      service.startSession(7, 'uz'),
      service.startSession(7, 'uz'),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(rows).toHaveLength(1);
    expect(wallet.realtimeSeconds).toBe(20);
  });

  it('pays only from the real-time wallet, never the AI-dubbing one', async () => {
    // 5 000 AI-dubbing tokens and no real-time minutes: still refused
    const { service, spendDubCredits, wallet } = setup({ usedTrial: 600 });
    await expect(service.startSession(7, 'uz')).rejects.toMatchObject({
      status: 402,
    });
    expect(spendDubCredits).not.toHaveBeenCalled();
    expect(wallet.credits).toBe(5000);
  });

  it('never charges an unlimited tester', async () => {
    const { service, spendCredits } = setup({ usedTrial: 600, seconds: 3600 });
    await service.startSession(7, 'uz', 'tester@example.com');
    expect(spendCredits).not.toHaveBeenCalled();
  });
});

describe('RealtimeService unlimited testers', () => {
  it('lets a listed account start sessions past the trial', async () => {
    const { service, rows } = setup({ usedTrial: 600 });
    const grant = await service.startSession(7, 'uz', 'tester@example.com');
    expect(grant.maxSeconds).toBe(300);
    expect(grant.unlimited).toBe(true);
    // still recorded, so the spend stays visible
    expect(rows).toEqual([expect.objectContaining({ grantedSeconds: 300 })]);
  });

  it('still limits everyone else', async () => {
    const { service } = setup({ usedTrial: 600 });
    const err: unknown = await service
      .startSession(7, 'uz', 'someone@example.com')
      .catch((e: unknown) => e);
    expect((err as HttpException).getStatus()).toBe(402);
  });

  it('reports a listed account as unlimited', async () => {
    const { service } = setup({ usedTrial: 600 });
    expect((await service.usage(7, 'TESTER@example.com')).unlimited).toBe(true);
    expect((await service.usage(7, 'someone@example.com')).unlimited).toBe(
      false,
    );
  });
});

describe('RealtimeService.usage', () => {
  it('reports the trial left and the bought time', async () => {
    const { service } = setup({ usedTrial: 240 });
    await expect(service.usage(7)).resolves.toEqual({
      configured: true,
      unlimited: false,
      trialSeconds: 600,
      trialUsedSeconds: 240,
      trialRemainingSeconds: 360,
      balanceSeconds: 0,
      availableSeconds: 360,
      sessionSeconds: 300,
      usedSecondsToday: 240,
      dailySeconds: 600,
    });
  });

  it('adds bought minutes to whatever is left of the trial', async () => {
    const { service } = setup({ usedTrial: 300, seconds: 3600 });
    expect(await service.usage(7)).toMatchObject({
      trialRemainingSeconds: 300,
      balanceSeconds: 3600,
      availableSeconds: 3900,
    });
  });

  it('never gives the trial back, however long ago it was used', async () => {
    // freeTime sums every free session ever, not just today's
    const { service, prisma } = setup({ usedTrial: 600 });
    await service.usage(7);
    expect(prisma.realtimeSession.aggregate).toHaveBeenCalledWith({
      where: { userId: 7, chargedSeconds: 0 },
      _sum: { grantedSeconds: true },
    });
  });

  it('says unconfigured without a key', async () => {
    const { service } = setup({ key: undefined });
    expect((await service.usage(7)).configured).toBe(false);
  });
});
