import { Injectable, Logger } from '@nestjs/common';
import { CreditReason, PaymentStatus, Role } from '@prisma/client';

import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import type { HeartbeatDto, PresenceSite } from './dto/heartbeat.dto';

/** A tab that has not beaten for this long has been closed. */
const STALE_MS = 75_000;
/** Public endpoint — bound the map so nobody can grow it without limit. */
const MAX_LIVE = 5_000;

export interface LivePresence {
  visitorId: string;
  site: PresenceSite;
  path: string;
  doing: string | null;
  /** When they arrived on this path. */
  since: number;
  lastSeen: number;
  user: { id: number; name: string; email: string; role: Role } | null;
}

/**
 * Who has th-labs.uz or the Studio open right now, and on which page.
 *
 * Live presence is in memory on purpose: it is a beat every 20s per open tab,
 * and it is worthless a minute later, so it never touches the database. The
 * cost is that a restart empties the city for one beat — and that this assumes
 * a single API instance, which is how it is deployed today. Visitor COUNTS are
 * durable (SiteVisit), and only written on a navigation.
 */
@Injectable()
export class PresenceService {
  private readonly logger = new Logger(PresenceService.name);
  private readonly live = new Map<string, LivePresence>();

  constructor(private readonly prisma: PrismaService) {}

  async beat(dto: HeartbeatDto, auth?: AuthenticatedUser): Promise<void> {
    const now = Date.now();
    this.prune(now);

    const prev = this.live.get(dto.visitorId);
    if (!prev && this.live.size >= MAX_LIVE) return;

    let user = prev?.user ?? null;
    if (auth && user?.id !== auth.id) {
      // The name is not in the token. Looked up once per browser, not per beat.
      const row = await this.prisma.user.findUnique({
        where: { id: auth.id },
        select: { id: true, name: true, email: true, role: true },
      });
      user = row;
    } else if (!auth) {
      user = null;
    }

    const path = dto.path.split(/[?#]/, 1)[0] || '/';
    this.live.set(dto.visitorId, {
      visitorId: dto.visitorId,
      site: dto.site,
      path,
      doing: dto.doing?.trim() || null,
      since:
        prev && prev.path === path && prev.site === dto.site ? prev.since : now,
      lastSeen: now,
      user,
    });

    if (dto.pageview) {
      // A lost count is better than a failed beat: the tab never retries, so a
      // 500 helps nobody — but say so, or the numbers drift silently.
      const day = new Date(now).toISOString().slice(0, 10);
      try {
        await this.prisma.siteVisit.upsert({
          where: {
            visitorId_day_site: {
              visitorId: dto.visitorId,
              day,
              site: dto.site,
            },
          },
          create: {
            visitorId: dto.visitorId,
            day,
            site: dto.site,
            userId: user?.id,
          },
          update: {
            pageviews: { increment: 1 },
            ...(user ? { userId: user.id } : {}),
          },
        });
      } catch (err) {
        this.logger.warn(
          `Visit not counted for ${dto.site}: ${(err as Error).message}`,
        );
      }
    }
  }

  /**
   * Everything the office screen shows, in one read. `from` is the start of
   * "today" in the panel's own timezone — the server's midnight is UTC, and
   * the office is not.
   */
  async city(from: Date) {
    const now = Date.now();
    this.prune(now);

    const [visits, signups, payments, tokens, recentSignups, recentPayments] =
      await Promise.all([
        this.prisma.siteVisit.findMany({
          where: { lastSeen: { gte: from } },
          select: { visitorId: true, site: true, pageviews: true },
        }),
        this.prisma.user.count({ where: { createdAt: { gte: from } } }),
        this.prisma.payment.findMany({
          where: { createdAt: { gte: from }, status: PaymentStatus.SUCCEEDED },
          select: { amountCents: true, currency: true, subscriptionId: true },
        }),
        this.prisma.creditEntry.aggregate({
          where: {
            createdAt: { gte: from },
            reason: {
              in: [CreditReason.PACK_PURCHASE, CreditReason.SUBSCRIPTION_GRANT],
            },
          },
          _sum: { delta: true },
        }),
        this.prisma.user.findMany({
          orderBy: { createdAt: 'desc' },
          take: 6,
          select: { id: true, name: true, email: true, createdAt: true },
        }),
        this.prisma.payment.findMany({
          where: { status: PaymentStatus.SUCCEEDED },
          orderBy: { createdAt: 'desc' },
          take: 6,
          select: {
            id: true,
            amountCents: true,
            currency: true,
            description: true,
            subscriptionId: true,
            createdAt: true,
            user: { select: { id: true, name: true, email: true } },
          },
        }),
      ]);

    const distinct = (site: PresenceSite) =>
      new Set(visits.filter((v) => v.site === site).map((v) => v.visitorId))
        .size;

    const revenue: Record<string, number> = {};
    for (const p of payments) {
      revenue[p.currency] = (revenue[p.currency] ?? 0) + p.amountCents;
    }

    return {
      now: new Date(now).toISOString(),
      from: from.toISOString(),
      people: [...this.live.values()]
        .sort((a, b) => b.lastSeen - a.lastSeen)
        .map((p) => ({
          ...p,
          since: new Date(p.since).toISOString(),
          lastSeen: new Date(p.lastSeen).toISOString(),
        })),
      today: {
        /** Distinct browsers on th-labs.uz. */
        visitors: distinct('landing'),
        /** Distinct browsers in the signed-in Studio. */
        appVisitors: distinct('app'),
        pageviews: visits.reduce((n, v) => n + v.pageviews, 0),
        signups,
        purchases: payments.length,
        subscriptions: payments.filter((p) => p.subscriptionId).length,
        tokenPacks: payments.filter((p) => !p.subscriptionId).length,
        /** Credits granted by purchases — what people bought, in tokens. */
        tokensSold: tokens._sum.delta ?? 0,
        /** Cents per currency. Mixed currencies are not summed together. */
        revenue,
      },
      recentSignups,
      recentPurchases: recentPayments.map(({ subscriptionId, ...p }) => ({
        ...p,
        kind: subscriptionId ? 'subscription' : 'tokens',
      })),
    };
  }

  private prune(now: number) {
    for (const [id, p] of this.live) {
      if (now - p.lastSeen > STALE_MS) this.live.delete(id);
    }
  }
}
