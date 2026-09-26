import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { from, Observable, switchMap, tap } from 'rxjs';

import { AuditService } from './audit.service';
import { AuditTargetResolver } from './audit.target';
import {
  isAuditable,
  normalizePath,
  resolveAction,
  withTargetLabel,
} from './audit.action';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';

// Field names whose VALUE must never reach the log, matched case-insensitively
// as a substring. A denylist is the wrong shape for secrets in general, but
// the alternative here — an allowlist of loggable fields — would silently drop
// the request detail that makes an audit row useful. So the list is broad and
// errs toward redacting.
const SECRET_KEY =
  /pass|secret|token|authorization|cookie|key|otp|code|signature|card|cvv/i;

// Bodies can be large (a base64 upload). Cap what we keep.
const MAX_META_CHARS = 4000;

function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (depth > 4) return '[deep]';

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((v) => redact(v, depth + 1));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SECRET_KEY.test(key) ? '[redacted]' : redact(val, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string' && value.length > 500) {
    return `${value.slice(0, 500)}…[truncated]`;
  }
  return value;
}

function clip(meta: Record<string, unknown>): Record<string, unknown> {
  const json = JSON.stringify(meta);
  if (json.length <= MAX_META_CHARS) return meta;
  return { truncated: true, preview: json.slice(0, MAX_META_CHARS) };
}

// Behind Caddy the socket address is the proxy's. Trust the first hop in
// X-Forwarded-For, which is what the proxy appends the real client as.
function clientIp(req: Request): string | null {
  const forwarded = req.headers['x-forwarded-for'];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (first) return first.split(',')[0].trim();
  return req.ip ?? req.socket?.remoteAddress ?? null;
}

// The `{ accessToken, user }` that login and create-user return. Read
// defensively: this runs on every audited response, most of which are some
// other shape entirely.
function actorFromResponse(payload: unknown): AuthenticatedUser | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const user = (payload as { user?: unknown }).user;
  if (!user || typeof user !== 'object') return undefined;

  const { id, email, role } = user as Record<string, unknown>;
  if (typeof id !== 'number' || typeof email !== 'string') return undefined;
  return { id, email, role: role as AuthenticatedUser['role'] };
}

/**
 * Writes one AuditLog row per state-changing request.
 *
 * Registered globally (see AuditModule), and runs on both the success and the
 * error path — a rejected action is exactly the thing an admin wants to see,
 * so a 403 gets a row just as a 200 does.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly audit: AuditService,
    private readonly targets: AuditTargetResolver,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const http = context.switchToHttp();
    const req = http.getRequest<Request & { user?: AuthenticatedUser }>();
    const res = http.getResponse<Response>();

    if (!isAuditable(req.method, req.originalUrl, this.audit.logReads)) {
      return next.handle();
    }

    const startedAt = Date.now();
    // Snapshot the body now: a handler is free to mutate the object it was
    // handed, and we want what was sent, not what it became.
    const body = redact(req.body) as Record<string, unknown> | undefined;
    const query = redact(req.query) as Record<string, unknown> | undefined;

    const resolved = resolveAction(req.method, req.originalUrl);

    const run = (labelBefore: string | null): Observable<unknown> => {
      const write = (
        statusCode: number,
        payload?: unknown,
        error?: unknown,
      ) => {
        void this.writeRow({
          req,
          resolved,
          labelBefore,
          statusCode,
          startedAt,
          body,
          query,
          payload,
          error,
        });
      };

      return next.handle().pipe(
        tap({
          next: (payload: unknown) => write(res.statusCode, payload),
          error: (err: unknown) =>
            write(
              err instanceof HttpException ? err.getStatus() : 500,
              undefined,
              err,
            ),
        }),
      );
    };

    // Most routes have no target, and must not pay for a lookup.
    if (!resolved.target) return run(null);

    // The ones that do: label the target and WAIT before running the handler.
    // Merely starting the lookup first is not enough — it races the handler
    // against the same database, and a DELETE that commits first leaves the
    // lookup with nothing to find. That is how "Deleted the account
    // ada@example.com" turns back into "Deleted the account user 12".
    //
    // The cost is one indexed read before an admin mutation, which is the
    // right trade for the line that says whose account was destroyed.
    return from(this.targets.lookup(resolved.target)).pipe(
      switchMap((label) => run(label)),
    );
  }

  // Split out because resolving the target label may need a query, and the
  // response must not wait on the audit row. Nothing awaits this; the service
  // swallows its own failures.
  private async writeRow(ctx: {
    req: Request & { user?: AuthenticatedUser };
    resolved: ReturnType<typeof resolveAction>;
    labelBefore: string | null;
    statusCode: number;
    startedAt: number;
    body: Record<string, unknown> | undefined;
    query: Record<string, unknown> | undefined;
    payload: unknown;
    error: unknown;
  }): Promise<void> {
    const {
      req,
      resolved,
      statusCode,
      startedAt,
      body,
      query,
      payload,
      error,
    } = ctx;
    const { action, summary, target } = resolved;

    // `req.user` is only populated once the guard has run, so it is read at
    // the end rather than at the start.
    //
    // On the routes that CREATE a session there is no guard and so no
    // req.user — login and register would otherwise be filed as "anonymous",
    // losing exactly the fact the feed exists to show. Both return the
    // account in their response, so fall back to that.
    const user = req.user ?? actorFromResponse(payload);

    // The response wins when it has one (it reflects the change just made);
    // the pre-handler lookup is the fallback, and the only source for a row
    // that no longer exists.
    const targetLabel =
      this.targets.fromPayload(target, payload) ?? ctx.labelBefore;

    const meta: Record<string, unknown> = {};
    if (body && Object.keys(body).length) meta.body = body;
    if (query && Object.keys(query).length) meta.query = query;
    if (error) {
      meta.error =
        error instanceof HttpException
          ? error.getResponse()
          : error instanceof Error
            ? error.message
            : // A thrown non-Error: String() on a plain object gives
              // "[object Object]", which tells an admin nothing.
              JSON.stringify(error);
    }

    await this.audit.record({
      actorId: user?.id ?? null,
      actorEmail: user?.email ?? null,
      actorRole: user?.role ?? null,
      action,
      method: req.method,
      path: normalizePath(req.originalUrl),
      statusCode,
      durationMs: Date.now() - startedAt,
      success: statusCode < 400,
      targetType: target?.type ?? null,
      targetId: target?.id ?? null,
      targetLabel,
      summary: withTargetLabel(summary, targetLabel, target),
      // Cast is safe and necessary: the value is JSON.stringify-able by
      // construction (redact() only ever emits primitives, arrays and plain
      // objects), but Prisma's InputJsonValue cannot express that.
      meta: Object.keys(meta).length
        ? (clip(meta) as Prisma.InputJsonValue)
        : undefined,
      ip: clientIp(req),
      userAgent: req.headers['user-agent'] ?? null,
    });
  }
}
