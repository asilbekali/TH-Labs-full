import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import type { AuditTarget } from './audit.action';

/**
 * Turns `{ type: 'user', id: '42' }` into "ada@example.com".
 *
 * Without this the feed reads "changed the role of user 42", which is not an
 * answer to "which account did this admin touch" — it is the same question
 * again with an id attached. The label is resolved once, at write time, and
 * stored on the row: an audit trail has to keep saying what was done to
 * ada@example.com even after that account is renamed or deleted.
 *
 * Two sources, and the ORDER they are gathered in matters:
 *
 *  1. `lookup()` runs BEFORE the handler. It has to: a DELETE destroys the
 *     row, and a label resolved afterwards is null — which is how
 *     "Deleted the account ada@example.com" degrades into
 *     "Deleted the account user 11", the one line where the email matters
 *     most.
 *  2. `fromPayload()` runs after, on the handler's own response, which for
 *     most PATCH/POST routes carries the affected record. It wins when both
 *     are present, because it reflects the change that was just made.
 *
 * Every failure returns null rather than throwing. A missing label costs the
 * feed a nicety; a throw here would cost the row.
 */
@Injectable()
export class AuditTargetResolver {
  private readonly logger = new Logger(AuditTargetResolver.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Read the label from the database. Call this BEFORE the handler runs. */
  async lookup(target: AuditTarget | undefined): Promise<string | null> {
    if (!target) return null;
    try {
      return await this.fromDatabase(target);
    } catch (err) {
      this.logger.warn(
        `Could not label ${target.type} ${target.id}: ` +
          `${err instanceof Error ? err.message : err}`,
      );
      return null;
    }
  }

  /** Read the label off the handler's response. Free, and post-change. */
  fromPayload(
    target: AuditTarget | undefined,
    payload: unknown,
  ): string | null {
    if (!target) return null;
    return this.fromResponse(target, payload);
  }

  // ── From the handler's response ─────────────────────────────────────────
  // Responses are shaped `{ plan: {…} }`, `{ pack: {…} }`, `{ user: {…} }` or
  // the record itself, so unwrap one level before reading.
  private fromResponse(target: AuditTarget, payload: unknown): string | null {
    if (!payload || typeof payload !== 'object') return null;

    const outer = payload as Record<string, unknown>;
    const candidates = [outer, outer.user, outer.plan, outer.pack, outer.admin];

    for (const candidate of candidates) {
      if (!candidate || typeof candidate !== 'object') continue;
      const record = candidate as Record<string, unknown>;

      // Only trust a record that is actually the thing we are labelling —
      // otherwise a response that happens to carry the acting admin would
      // label the row with the actor's own email. Ids are strings (cuid) or
      // numbers; anything else is not an id and the record is not ours.
      const id = record.id;
      if (id !== undefined) {
        if (typeof id !== 'string' && typeof id !== 'number') continue;
        if (String(id) !== target.id) continue;
      }

      const label = this.labelOf(target.type, record);
      if (label) return label;
    }
    return null;
  }

  private labelOf(
    type: string,
    record: Record<string, unknown>,
  ): string | null {
    const str = (v: unknown) => (typeof v === 'string' && v ? v : null);

    switch (type) {
      case 'user':
      case 'admin':
        return str(record.email) ?? str(record.name);
      case 'plan': {
        const tier = str(record.tier);
        const cycle = str(record.cycle);
        return tier && cycle ? `${tier}/${cycle}` : null;
      }
      case 'creditPack':
        return str(record.slug);
      case 'feedback':
        // The sender, not the subject: "the feedback from ada@example.com"
        // identifies a message in a way a truncated subject line does not.
        return str(record.email) ?? str(record.name);
      case 'language':
        return str(record.name) ?? str(record.code);
      default:
        return null;
    }
  }

  // ── From the database ───────────────────────────────────────────────────
  private async fromDatabase(target: AuditTarget): Promise<string | null> {
    const { type, id } = target;

    // User, Admin, Language and Feedback are keyed by int; a non-numeric id on
    // those is a malformed request, not a lookup worth making.
    const numeric = Number(id);
    const isNumeric = Number.isInteger(numeric);

    switch (type) {
      case 'user': {
        if (!isNumeric) return null;
        const user = await this.prisma.user.findUnique({
          where: { id: numeric },
          select: { email: true },
        });
        return user?.email ?? null;
      }
      case 'admin': {
        if (!isNumeric) return null;
        const admin = await this.prisma.admin.findUnique({
          where: { id: numeric },
          select: { email: true },
        });
        return admin?.email ?? null;
      }
      case 'language': {
        if (!isNumeric) return null;
        const lang = await this.prisma.language.findUnique({
          where: { id: numeric },
          select: { name: true },
        });
        return lang?.name ?? null;
      }
      case 'plan': {
        const plan = await this.prisma.plan.findUnique({
          where: { id },
          select: { tier: true, cycle: true },
        });
        return plan ? `${plan.tier}/${plan.cycle}` : null;
      }
      case 'creditPack': {
        const pack = await this.prisma.creditPack.findUnique({
          where: { id },
          select: { slug: true },
        });
        return pack?.slug ?? null;
      }
      case 'feedback': {
        if (!isNumeric) return null;
        const entry = await this.prisma.feedback.findUnique({
          where: { id: numeric },
          select: { email: true },
        });
        return entry?.email ?? null;
      }
      default:
        return null;
    }
  }
}
