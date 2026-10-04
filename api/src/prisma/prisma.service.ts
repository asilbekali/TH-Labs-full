import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

// Boot-time connect retries. Neon scales the compute to zero when idle, and
// waking it takes longer than one connection attempt: measured from here a cold
// connect is ~3 s on its own, and a compute that was actually suspended can take
// 10-20 s before it accepts anything. 5 flat 2 s retries gave up after ~10 s of
// waiting, so `yarn start` simply crashed with P1001 ("Can't reach database
// server") whenever nobody had used the database for a while — including in the
// middle of a test run.
//
// Backed off rather than merely counted higher, so a database that is genuinely
// gone still fails in reasonable time while one that is only waking is waited
// out: 1s, 2s, 4s, 8s, 10s, 10s… ≈ 65 s total.
const MAX_RETRIES = 9;
const RETRY_BASE_DELAY_MS = 1000;
const RETRY_MAX_DELAY_MS = 10_000;

function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * How long a `$transaction` may wait for a connection, and how long its body
 * may run.
 *
 * Prisma's defaults are maxWait 2s / timeout 5s, which are sized for a
 * Postgres on the same host. This database is Neon, reached over the public
 * internet: a round trip measures 200–430 ms from the dev box, opening a FRESH
 * connection (TLS + channel binding + the Neon proxy, after Neon has closed an
 * idle one or woken a scaled-to-zero compute) measures ~3 s, and
 * `PaymentService.commitDub` makes five sequential queries inside one
 * transaction — 4.3 s of the 5 s budget on a good day.
 *
 * So both defaults were being missed, and the one that broke dubbing was
 * maxWait: every time the pool had to open a new connection for the charge,
 * `POST /v1/payments/commit-dub` threw P2028 "Unable to start a transaction in
 * the given time". `/payments/credits` and `/payments/can-dub` kept working
 * because neither opens a transaction, which is why the Studio's preflight
 * passed and the job then died at the charge.
 */
const TX_MAX_WAIT_MS = envInt('DB_TX_MAX_WAIT_MS', 15_000);
const TX_TIMEOUT_MS = envInt('DB_TX_TIMEOUT_MS', 20_000);

/**
 * Prisma codes that mean "the database was not ready just now", as opposed to
 * "this query is wrong". Every one of them is safe to retry because the
 * transaction they aborted was rolled back whole.
 */
const TRANSIENT_CODES = new Set([
  'P2024', // timed out fetching a connection from the pool
  'P2028', // transaction API error — could not start, or ran out of time
  'P2034', // write conflict / deadlock, retryable by definition
  'P1001', // can't reach the database server
  'P1002', // connection timed out
  'P1008', // operation timed out
  'P1017', // server closed the connection
]);

function isTransient(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    TRANSIENT_CODES.has(error.code)
  );
}

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    // Set once, here, so EVERY `$transaction` in the codebase gets the budget —
    // the signup bonus, the webhook's purchase grant, the monthly cron and the
    // dub charge all run against the same remote database and all had the same
    // 2 s/5 s ceiling. Overridable per environment: a Postgres on localhost
    // wants the tight defaults back, and a worse network wants more.
    super({
      transactionOptions: { maxWait: TX_MAX_WAIT_MS, timeout: TX_TIMEOUT_MS },
    });
  }

  async onModuleInit() {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        await this.$connect();
        if (attempt > 1) {
          this.logger.log(`Database connected on attempt ${attempt}.`);
        }
        return;
      } catch (error) {
        if (attempt === MAX_RETRIES) throw error;

        const delay = Math.min(
          RETRY_BASE_DELAY_MS * 2 ** (attempt - 1),
          RETRY_MAX_DELAY_MS,
        );
        this.logger.warn(
          `Database connection failed (attempt ${attempt}/${MAX_RETRIES}), ` +
            `retrying in ${delay}ms — a Neon compute waking from scale-to-zero ` +
            'takes a few seconds.',
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /**
   * `$transaction`, retried when the database was merely slow to answer.
   *
   * The budget above is enough for a transaction that gets a connection; this
   * covers the case where it does not get one at all — a Neon compute waking
   * from scale-to-zero can take longer than any sane maxWait, and the honest
   * response to that is to try again rather than to fail the request.
   *
   * `fn` must therefore be safe to run twice. Every caller here is: the
   * transaction that failed was rolled back in full, and the one caller where
   * a double-run would cost real money — the dub charge — is keyed on its
   * jobId and recognises its own earlier work.
   */
  async transaction<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
    label = 'transaction',
    attempts = 3,
  ): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        return await this.$transaction(fn);
      } catch (error) {
        lastError = error;
        if (!isTransient(error) || attempt === attempts) break;
        const code = (error as Prisma.PrismaClientKnownRequestError).code;
        const backoff = 250 * attempt;
        this.logger.warn(
          `${label}: ${code} on attempt ${attempt}/${attempts}, retrying in ${backoff}ms`,
        );
        await new Promise((resolve) => setTimeout(resolve, backoff));
      }
    }
    throw lastError;
  }
}
