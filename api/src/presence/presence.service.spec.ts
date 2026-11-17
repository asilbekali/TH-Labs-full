import { isAuditable } from '../audit/audit.action';
import type { PrismaService } from '../prisma/prisma.service';
import type { HeartbeatDto } from './dto/heartbeat.dto';
import { PresenceService } from './presence.service';

function setup() {
  const prisma = {
    siteVisit: {
      upsert: jest.fn(() => Promise.resolve({})),
      findMany: jest.fn(() => Promise.resolve([])),
    },
    user: {
      findUnique: jest.fn(() =>
        Promise.resolve({
          id: 42,
          name: 'Ada Lovelace',
          email: 'ada@example.com',
          role: 'USER',
        }),
      ),
      count: jest.fn(() => Promise.resolve(0)),
      findMany: jest.fn(() => Promise.resolve([])),
    },
    payment: { findMany: jest.fn(() => Promise.resolve([])) },
    creditEntry: {
      aggregate: jest.fn(() => Promise.resolve({ _sum: { delta: null } })),
    },
  };
  const service = new PresenceService(prisma as unknown as PrismaService);
  return { prisma, service };
}

const beat = (over: Partial<HeartbeatDto> = {}): HeartbeatDto => ({
  visitorId: 'v_test123456',
  site: 'landing',
  path: '/pricing?ref=ad#plans',
  ...over,
});

const FROM = new Date('2026-11-17T00:00:00Z');

describe('PresenceService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('shows a beat in city().people, with the query stripped', async () => {
    const { service } = setup();
    await service.beat(beat({ doing: 'Reading plans' }));

    const { people } = await service.city(FROM);
    expect(people).toHaveLength(1);
    expect(people[0]).toMatchObject({
      visitorId: 'v_test123456',
      site: 'landing',
      path: '/pricing',
      doing: 'Reading plans',
      user: null,
    });
  });

  it('prunes a tab that has not beaten for more than 75s', async () => {
    const { service } = setup();
    const t0 = Date.parse('2026-11-17T09:00:00Z');
    const now = jest.spyOn(Date, 'now').mockReturnValue(t0);
    await service.beat(beat());

    now.mockReturnValue(t0 + 75_000);
    expect((await service.city(FROM)).people).toHaveLength(1);

    now.mockReturnValue(t0 + 76_000);
    expect((await service.city(FROM)).people).toHaveLength(0);
  });

  it('counts a navigation in SiteVisit, but not a keep-alive', async () => {
    const { prisma, service } = setup();
    await service.beat(beat({ pageview: true }));
    expect(prisma.siteVisit.upsert).toHaveBeenCalledTimes(1);

    await service.beat(beat());
    expect(prisma.siteVisit.upsert).toHaveBeenCalledTimes(1);
  });

  it('still shows the person when the visit write fails', async () => {
    const { prisma, service } = setup();
    prisma.siteVisit.upsert.mockRejectedValueOnce(new Error('db asleep'));
    jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);

    await expect(service.beat(beat({ pageview: true }))).resolves.toBe(
      undefined,
    );
    expect((await service.city(FROM)).people).toHaveLength(1);
  });

  it('looks the account up once per browser, not on every beat', async () => {
    const { prisma, service } = setup();
    const auth = { id: 42, email: 'ada@example.com', role: 'USER' as const };
    await service.beat(beat({ site: 'app', path: '/studio' }), auth);
    await service.beat(beat({ site: 'app', path: '/studio' }), auth);

    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
    const [person] = (await service.city(FROM)).people;
    expect(person.user).toMatchObject({ id: 42, name: 'Ada Lovelace' });
  });

  it('keeps presence out of the audit log', () => {
    expect(isAuditable('POST', '/v1/presence', false)).toBe(false);
  });
});
