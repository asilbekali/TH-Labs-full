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
  opts: { key?: string; usedToday?: number; google?: Response } = {},
) {
  type Row = { userId: number; targetLanguage: string; grantedSeconds: number };
  const rows: Row[] = [];
  const prisma = {
    realtimeSession: {
      aggregate: jest.fn(() =>
        Promise.resolve({ _sum: { grantedSeconds: opts.usedToday ?? null } }),
      ),
      create: jest.fn(({ data }: { data: Row }) => {
        rows.push(data);
        return Promise.resolve({ id: 'r1', ...data });
      }),
    },
  };
  const env: Record<string, unknown> = {
    GEMINI_API_KEY: 'key' in opts ? opts.key : KEY,
    REALTIME_MODEL: 'gemini-3.5-live-translate-preview',
    REALTIME_SESSION_SECONDS: 300,
    REALTIME_DAILY_SECONDS: 900,
  };
  const config = { get: (k: string) => env[k] };
  const service = new RealtimeService(
    prisma as unknown as PrismaService,
    config as unknown as ConfigService,
  );
  const fetchImpl = jest.fn<Promise<Response>, [string, RequestInit]>(() =>
    Promise.resolve(
      opts.google ??
        new Response(JSON.stringify({ name: 'auth_tokens/abc123' }), {
          status: 200,
        }),
    ),
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

describe('RealtimeService.usage', () => {
  it('reports configuration and seconds used today', async () => {
    const { service } = setup({ usedToday: 300 });
    await expect(service.usage(7)).resolves.toEqual({
      configured: true,
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
