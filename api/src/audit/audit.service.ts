import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditLog, Prisma, Role } from '@prisma/client';
import { Observable, Subject } from 'rxjs';

import { PrismaService } from '../prisma/prisma.service';
import {
  AuditQueryDto,
  AuditStatsDto,
  StatsBucket,
} from './dto/audit-query.dto';

export interface AuditWrite {
  actorId?: number | null;
  actorEmail?: string | null;
  actorRole?: Role | null;
  action: string;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  success: boolean;
  targetType?: string | null;
  targetId?: string | null;
  targetLabel?: string | null;
  summary?: string | null;
  meta?: Prisma.InputJsonValue | null;
  ip?: string | null;
  userAgent?: string | null;
}

// How long a bucket is, in milliseconds, for the stats endpoint.
const BUCKET_MS: Record<StatsBucket, number> = {
  second: 1000,
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
};

@Injectable()
export class AuditService implements OnModuleDestroy {
  private readonly logger = new Logger(AuditService.name);

  // Live feed. The interceptor publishes here after the row is written, and
  // the SSE endpoint multicasts to whoever is watching the panel.
  private readonly stream = new Subject<AuditLog>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  onModuleDestroy(): void {
    this.stream.complete();
  }

  /**
   * True when GET reads are logged too (AUDIT_LOG_READS=true).
   *
   * validateEnv coerces this to a real boolean, so ConfigService hands back a
   * boolean here and a string only if that validation is ever bypassed. Both
   * are accepted: reading it as a string alone threw on every request that
   * touched the log.
   */
  get logReads(): boolean {
    const raw = this.config.get<boolean | string>('AUDIT_LOG_READS');
    return raw === true || raw === 'true';
  }

  get retentionDays(): number {
    return Number(this.config.get('AUDIT_LOG_RETENTION_DAYS')) || 90;
  }

  /** Subscribe to the live feed (SSE). */
  watch(): Observable<AuditLog> {
    return this.stream.asObservable();
  }

  /**
   * Write one row.
   *
   * Never throws. An audit write failing must not turn a request that already
   * succeeded into a 500 — the user's action happened, and losing the record
   * of it is the lesser harm. It is logged loudly instead, because silent gaps
   * in an audit trail are worse than a noisy error.
   */
  async record(entry: AuditWrite): Promise<void> {
    try {
      const row = await this.prisma.auditLog.create({
        data: {
          actorId: entry.actorId ?? null,
          actorEmail: entry.actorEmail ?? null,
          actorRole: entry.actorRole ?? null,
          action: entry.action,
          method: entry.method,
          path: entry.path,
          statusCode: entry.statusCode,
          durationMs: entry.durationMs,
          success: entry.success,
          targetType: entry.targetType ?? null,
          targetId: entry.targetId ?? null,
          targetLabel: entry.targetLabel ?? null,
          summary: entry.summary ?? null,
          meta: entry.meta ?? Prisma.JsonNull,
          ip: entry.ip ?? null,
          userAgent: entry.userAgent ?? null,
        },
      });
      this.stream.next(row);
    } catch (err) {
      this.logger.error(
        `Failed to write audit row for ${entry.method} ${entry.path}: ` +
          `${err instanceof Error ? err.message : err}`,
      );
    }
  }

  // ── Reading ─────────────────────────────────────────────────────────────
  private whereFrom(q: AuditQueryDto): Prisma.AuditLogWhereInput {
    const where: Prisma.AuditLogWhereInput = {};

    if (q.actorId !== undefined) where.actorId = q.actorId;
    if (q.actorEmail) {
      where.actorEmail = { contains: q.actorEmail, mode: 'insensitive' };
    }
    if (q.role) where.actorRole = q.role;
    if (q.action) where.action = { startsWith: q.action };
    if (q.method) where.method = q.method.toUpperCase();
    if (q.targetType) where.targetType = q.targetType;
    if (q.targetId) where.targetId = q.targetId;
    if (q.targetLabel) {
      where.targetLabel = { contains: q.targetLabel, mode: 'insensitive' };
    }
    if (q.success !== undefined) where.success = q.success;

    const from = q.from ? new Date(q.from) : undefined;
    const to = q.to ? new Date(q.to) : undefined;
    if (from || to) {
      where.createdAt = {
        ...(from ? { gte: from } : {}),
        ...(to ? { lte: to } : {}),
      };
    }

    // Free text over the fields a human would scan: the sentence, the path,
    // and who did it.
    if (q.q) {
      where.OR = [
        { summary: { contains: q.q, mode: 'insensitive' } },
        { path: { contains: q.q, mode: 'insensitive' } },
        { actorEmail: { contains: q.q, mode: 'insensitive' } },
        { action: { contains: q.q, mode: 'insensitive' } },
        // Searching an email should find both what that account DID and what
        // was done TO it — the two halves of one person's history.
        { targetLabel: { contains: q.q, mode: 'insensitive' } },
      ];
    }

    return where;
  }

  async list(q: AuditQueryDto) {
    const page = q.page ?? 1;
    const limit = q.limit ?? 50;
    const where = this.whereFrom(q);

    const [total, items] = await this.prisma.$transaction([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return { page, limit, total, pages: Math.ceil(total / limit) || 1, items };
  }

  async findOne(id: string): Promise<AuditLog | null> {
    return this.prisma.auditLog.findUnique({ where: { id } });
  }

  /**
   * Counts over time, plus the busiest actors and actions.
   *
   * Bucketing is done in JS over the matched rows rather than in SQL. That
   * keeps it portable and readable, and the row cap below is what keeps it
   * honest: a window wide enough to exceed it is reported as truncated rather
   * than quietly summarising half the data.
   */
  async stats(q: AuditStatsDto) {
    const bucket = q.bucket ?? 'hour';
    const to = q.to ? new Date(q.to) : new Date();
    const from = q.from
      ? new Date(q.from)
      : new Date(to.getTime() - 24 * BUCKET_MS.hour);

    const MAX_ROWS = 50_000;
    const where: Prisma.AuditLogWhereInput = {
      createdAt: { gte: from, lte: to },
      ...(q.action ? { action: { startsWith: q.action } } : {}),
      ...(q.actorId !== undefined ? { actorId: q.actorId } : {}),
    };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        take: MAX_ROWS,
        select: {
          createdAt: true,
          action: true,
          success: true,
          durationMs: true,
          actorId: true,
          actorEmail: true,
        },
      }),
    ]);

    const size = BUCKET_MS[bucket];
    const series = new Map<string, { total: number; failed: number }>();
    const byAction = new Map<string, number>();
    const byActor = new Map<
      string,
      { actorId: number | null; email: string | null; count: number }
    >();
    let failed = 0;
    let durationTotal = 0;

    for (const row of rows) {
      const slot = new Date(
        Math.floor(row.createdAt.getTime() / size) * size,
      ).toISOString();
      const entry = series.get(slot) ?? { total: 0, failed: 0 };
      entry.total++;
      if (!row.success) entry.failed++;
      series.set(slot, entry);

      byAction.set(row.action, (byAction.get(row.action) ?? 0) + 1);

      const key = row.actorId === null ? 'anonymous' : String(row.actorId);
      const actor = byActor.get(key) ?? {
        actorId: row.actorId,
        email: row.actorEmail,
        count: 0,
      };
      actor.count++;
      byActor.set(key, actor);

      if (!row.success) failed++;
      durationTotal += row.durationMs;
    }

    const top = <T>(map: Map<string, T>, count: (v: T) => number) =>
      [...map.entries()].sort((a, b) => count(b[1]) - count(a[1])).slice(0, 10);

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      bucket,
      total,
      counted: rows.length,
      /** True when the window held more rows than one call reports on. */
      truncated: total > rows.length,
      failed,
      successRate: rows.length ? 1 - failed / rows.length : 1,
      avgDurationMs: rows.length ? Math.round(durationTotal / rows.length) : 0,
      series: [...series.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([at, v]) => ({ at, total: v.total, failed: v.failed })),
      topActions: top(byAction, (v) => v).map(([action, count]) => ({
        action,
        count,
      })),
      topActors: top(byActor, (v) => v.count).map(([, v]) => v),
    };
  }

  /** Distinct action names, so the panel can offer a filter dropdown. */
  async actions(): Promise<string[]> {
    const rows = await this.prisma.auditLog.findMany({
      distinct: ['action'],
      select: { action: true },
      orderBy: { action: 'asc' },
      take: 500,
    });
    return rows.map((r) => r.action);
  }

  /** Delete rows older than the retention window. Returns how many went. */
  async prune(olderThanDays = this.retentionDays): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanDays * BUCKET_MS.day);
    const { count } = await this.prisma.auditLog.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    return count;
  }
}
