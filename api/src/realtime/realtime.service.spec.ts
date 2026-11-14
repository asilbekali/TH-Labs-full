import {
  BadGatewayException,
  BadRequestException,
  HttpException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import type { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from './realtime.service';

const KEY = 'test-gemini-key-must-not-leak';

function setup(
  opts: {
    key?: string;
    usedToday?: number;
    google?: Response;
    googleDelayMs?: number;
  } = {},
) {
  type Row = { userId: number; targetLanguage: string; grantedSeconds: number };
  const rows: (Row & { id: string })[] = [];
  // A stand-in that behaves like the database where it matters: the sum
  // reflects rows actually written, and transactions run one at a time (the
  // per-user advisory lock serialises them in Postgres).
  let chain: Promise<unknown> = Promise.resolve();
  const table = {
    aggregate: jest.fn(() => {
      const sum =
        (opts.usedToday ?? 0) + rows.reduce((s, r) => s + r.grantedSeconds, 0);
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
  const tx = { realtimeSession: table, $executeRaw: jest.fn(() => 1) };
  const prisma = {
    realtimeSession: table,
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
    REALTIME_DAILY_SECONDS: 900,
    REALTIME_UNLIMITED_EMAILS: 'Tester@Example.com, other@example.com',
  };
  const config = { get: (k: string) => env[k] };
  const service = new RealtimeService(
    prisma as unknown as PrismaService,
    config as unknown as ConfigService,
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
  return { service, prisma, fetchImpl, rows };
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

  it('grants the last 300 s of the day and records them', async () => {
    const { service, rows } = setup({ usedToday: 600 });
    const grant = await service.startSession(7, 'uz');
    expect(rows).toEqual([
      expect.objectContaining({
        userId: 7,
        targetLanguage: 'uz',
        grantedSeconds: 300,
      }),
    ]);
    expect(grant.maxSeconds).toBe(300);
    expect(grant.remainingSecondsToday).toBe(0);
    expect(grant.targetLanguage).toBe('uz');
  });

  it('cannot be raced: simultaneous requests get only what the day has left', async () => {
    // 600 s used, 300 s left: of three requests in flight at once (Google
    // answering slowly), exactly one may get a session.
    const { service, rows } = setup({ usedToday: 600, googleDelayMs: 30 });
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
        r.reason.getStatus() === 429,
    );
    expect(granted).toHaveLength(1);
    expect(refused).toHaveLength(2);
    expect(rows.reduce((s, r) => s + r.grantedSeconds, 0)).toBe(300);
  });

  it('refuses a fourth session in a day without asking Google', async () => {
    const { service, fetchImpl, rows } = setup({ usedToday: 900 });
    const err: unknown = await service
      .startSession(7, 'uz')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(429);
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

describe('RealtimeService unlimited testers', () => {
  it('lets a listed account start sessions past the daily allowance', async () => {
    const { service, rows } = setup({ usedToday: 900 });
    const grant = await service.startSession(7, 'uz', 'tester@example.com');
    expect(grant.maxSeconds).toBe(300);
    expect(grant.unlimited).toBe(true);
    // still recorded, so the spend stays visible
    expect(rows).toEqual([expect.objectContaining({ grantedSeconds: 300 })]);
  });

  it('still limits everyone else', async () => {
    const { service } = setup({ usedToday: 900 });
    const err: unknown = await service
      .startSession(7, 'uz', 'someone@example.com')
      .catch((e: unknown) => e);
    expect((err as HttpException).getStatus()).toBe(429);
  });

  it('reports a listed account as unlimited', async () => {
    const { service } = setup({ usedToday: 900 });
    expect((await service.usage(7, 'TESTER@example.com')).unlimited).toBe(true);
    expect((await service.usage(7, 'someone@example.com')).unlimited).toBe(
      false,
    );
  });
});

describe('RealtimeService.usage', () => {
  it('reports configuration and seconds used today', async () => {
    const { service } = setup({ usedToday: 300 });
    await expect(service.usage(7)).resolves.toEqual({
      configured: true,
      unlimited: false,
      usedSecondsToday: 300,
      dailySeconds: 900,
      sessionSeconds: 300,
    });
  });

  it('says unconfigured without a key', async () => {
    const { service } = setup({ key: undefined });
    expect((await service.usage(7)).configured).toBe(false);
  });
});
