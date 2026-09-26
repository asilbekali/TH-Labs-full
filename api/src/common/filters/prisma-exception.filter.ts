// Turns a Prisma failure into an HTTP answer instead of a 500 with a stack.
//
// Without this, anything Prisma throws falls through to Nest's default handler
// and the client gets `500 Internal server error` with no idea whether it sent
// something wrong, hit a duplicate, or caught the database mid-migration. The
// `public.Feedback does not exist` crash that prompted this filter is the exact
// shape of the problem: a pending migration is an operator problem, but it
// reached the browser as an unexplained 500.
//
// Every branch below keeps the *cause* on the server log and sends the client
// only what it can act on. Prisma messages quote table names, column names and
// sometimes the offending value, so they are never forwarded verbatim.
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';

/** Everything that means "the database is not answering right now". */
const UNREACHABLE =
  'The service is temporarily unavailable. Please try again in a moment.';

/** What the client is told, per Prisma error code. */
const KNOWN: Record<string, { status: number; message: string }> = {
  // ── Connectivity (P1xxx) ────────────────────────────────────────────────
  // A sleeping or unreachable database is an OUTAGE, not a bad request, and
  // the honest status is 503. These used to fall through to 500, which told
  // the browser the request was at fault and told the operator nothing — the
  // Neon compute scaling to zero looked exactly like an application crash.
  //
  // 503 also matters to the client: the frontend's QueryClient retry policy
  // (frontend/src/lib/query.ts) gives up on 401/403/404 and retries anything
  // else twice — so a paused Neon branch, which answers normally a second or
  // two after the first call wakes it, now recovers on its own.
  P1001: { status: HttpStatus.SERVICE_UNAVAILABLE, message: UNREACHABLE }, // can't reach server
  P1002: { status: HttpStatus.SERVICE_UNAVAILABLE, message: UNREACHABLE }, // connection timed out
  P1008: { status: HttpStatus.SERVICE_UNAVAILABLE, message: UNREACHABLE }, // operation timed out
  P1011: { status: HttpStatus.SERVICE_UNAVAILABLE, message: UNREACHABLE }, // TLS error
  P1017: { status: HttpStatus.SERVICE_UNAVAILABLE, message: UNREACHABLE }, // server closed it
  P2024: { status: HttpStatus.SERVICE_UNAVAILABLE, message: UNREACHABLE }, // pool timeout

  // Unique constraint. The route that cares usually catches this itself and
  // says something specific ("already on the list"); this is the fallback.
  P2002: {
    status: HttpStatus.CONFLICT,
    message: 'That already exists.',
  },
  // Foreign key / required relation violated — the request pointed at a row
  // that is not there.
  P2003: {
    status: HttpStatus.BAD_REQUEST,
    message: 'A referenced record does not exist.',
  },
  P2025: {
    status: HttpStatus.NOT_FOUND,
    message: 'Record not found.',
  },
  // P2021/P2022 mean the database does not match the schema this build expects
  // — an unapplied migration. 503, not 500: it is a real outage, it is
  // temporary, and calling it "unavailable" tells an operator where to look.
  P2021: {
    status: HttpStatus.SERVICE_UNAVAILABLE,
    message:
      'This feature is not available yet — the database is still being prepared.',
  },
  P2022: {
    status: HttpStatus.SERVICE_UNAVAILABLE,
    message:
      'This feature is not available yet — the database is still being prepared.',
  },
};

@Catch(
  Prisma.PrismaClientKnownRequestError,
  Prisma.PrismaClientValidationError,
  Prisma.PrismaClientInitializationError,
  Prisma.PrismaClientRustPanicError,
)
export class PrismaExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(PrismaExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Something went wrong. Please try again.';
    let code: string | undefined;

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      code = exception.code;
      const mapped = KNOWN[exception.code];
      if (mapped) {
        status = mapped.status;
        message = mapped.message;
      }
    } else if (exception instanceof Prisma.PrismaClientValidationError) {
      // The query the server built does not typecheck against the schema. That
      // is our bug, not the caller's, but a 400 is still the honest answer for
      // the request that triggered it in every case seen so far (a bad enum or
      // a malformed filter coming in from the query string).
      status = HttpStatus.BAD_REQUEST;
      message = 'The request could not be processed.';
    } else if (exception instanceof Prisma.PrismaClientInitializationError) {
      status = HttpStatus.SERVICE_UNAVAILABLE;
      message = 'The database is unreachable. Please try again shortly.';
    }

    // The full error, with its table and column names, stays here.
    this.logger.error(
      `${req.method} ${req.originalUrl} → ${status}${code ? ` (${code})` : ''}: ${
        exception instanceof Error ? exception.message.split('\n')[0] : exception
      }`,
    );

    res.status(status).json({
      statusCode: status,
      message,
      error: HttpStatus[status],
      path: req.originalUrl,
      timestamp: new Date().toISOString(),
    });
  }
}
