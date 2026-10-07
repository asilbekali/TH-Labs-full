// Boot-time environment validation. Registered via ConfigModule's `validate`
// option so the process refuses to start when a required secret is missing,
// rather than crashing later at the first webhook.
//
// LEMONSQUEEZY_API_KEY is intentionally *optional*: the catalog, the credit
// ledger and dubbing all work without it, and the app must still boot in dev
// with no merchant account. What it gates is CLAIMING a purchase — without it
// a completed payment cannot be verified, so Buy buttons are disabled rather
// than taking money that could never be credited. LemonSqueezyService logs that
// loudly at boot, and GET /v1/admin/billing/overview reports it as
// `canGrantCredits`.
//
// LEMONSQUEEZY_WEBHOOK_SECRET is optional too. With it, the LS webhook
// (POST /v1/payments/webhook) credits a purchase the moment it is paid; without
// it, purchases are still credited by the success page and the cron.
import { Logger } from '@nestjs/common';

type RawEnv = Record<string, string | undefined>;

export interface AppEnv {
  DATABASE_URL: string;

  JWT_SECRET: string;
  JWT_REFRESH_SECRET: string;
  JWT_EXPIRES_IN: string;
  JWT_REFRESH_EXPIRES_IN: string;

  PORT: number;
  APP_URL: string;

  // FREE_DUB_MAX_SECONDS is gone. The free allowance is no longer a length cap
  // on a special "one free dub" — a new account is granted credits worth one
  // minute (SIGNUP_BONUS_CREDITS in src/payment/quality-cost.ts) and the balance
  // alone decides from then on. Setting it in an env file now does nothing.

  // Origin of the dubbing pipeline (FastAPI), probed by GET /v1/health.
  // Optional: an account API with no pipeline attached is a valid deployment,
  // and health then reports `pipeline: "not_configured"` rather than guessing.
  DUB_API_URL?: string;

  // SMTP. Optional: with no credentials MailService logs and skips sends, so a
  // dev box boots fine without a mailbox attached.
  MAIL_HOST: string;
  MAIL_PORT: number;
  MAIL_USER?: string;
  MAIL_PASS?: string;
  MAIL_FROM?: string;

  /**
   * Lemon Squeezy API key (Settings → API). The ONE thing that lets a
   * completed purchase be verified and therefore credited. LS keys are
   * per-mode: a test-mode key sees only test-mode orders, so it must come from
   * the same mode as the checkout links in the catalog.
   */
  LEMONSQUEEZY_API_KEY?: string;
  /**
   * The store orders are read from. Optional when the key sees exactly one
   * store — it is looked up — but required when it sees several, so a key
   * shared across stores can never credit an order from the wrong one.
   */
  LEMONSQUEEZY_STORE_ID?: string;
  /**
   * Signing secret of the LS webhook (Settings → Webhooks). Turns on
   * POST /v1/payments/webhook, which credits a purchase the instant it is paid.
   */
  LEMONSQUEEZY_WEBHOOK_SECRET?: string;

  // ── Audit log ────────────────────────────────────────────────────────────
  /** 'true' records GET reads as well as mutations. A lot of rows. */
  AUDIT_LOG_READS: boolean;
  /** Days of history kept; a daily cron prunes past this. */
  AUDIT_LOG_RETENTION_DAYS: number;
}

// Secrets the app genuinely cannot run without.
const REQUIRED = ['DATABASE_URL', 'JWT_SECRET', 'JWT_REFRESH_SECRET'] as const;

function toInt(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function validateEnv(config: RawEnv): AppEnv {
  const logger = new Logger('EnvValidation');

  const missing = REQUIRED.filter((key) => !config[key]);
  if (missing.length) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}. ` +
        'Refusing to start — see api/.env.example.',
    );
  }

  const lsKey = config.LEMONSQUEEZY_API_KEY?.trim();
  if (!lsKey) {
    logger.error(
      'LEMONSQUEEZY_API_KEY not set — a completed purchase cannot be verified, ' +
        'so no checkout can grant credits. Buy buttons are disabled (503) ' +
        'rather than selling something that could never be honoured.',
    );
  }
  const lsStore = config.LEMONSQUEEZY_STORE_ID?.trim();
  if (lsStore && !/^\d+$/.test(lsStore)) {
    throw new Error(
      `LEMONSQUEEZY_STORE_ID must be the numeric store id, got "${lsStore}".`,
    );
  }

  return {
    DATABASE_URL: config.DATABASE_URL as string,

    JWT_SECRET: config.JWT_SECRET as string,
    JWT_REFRESH_SECRET: config.JWT_REFRESH_SECRET as string,
    JWT_EXPIRES_IN: config.JWT_EXPIRES_IN ?? '15m',
    JWT_REFRESH_EXPIRES_IN: config.JWT_REFRESH_EXPIRES_IN ?? '30d',

    PORT: toInt(config.PORT, 3000),
    APP_URL: config.APP_URL ?? 'http://localhost:5173',

    DUB_API_URL: config.DUB_API_URL?.trim() || undefined,

    MAIL_HOST: config.MAIL_HOST ?? 'smtp.gmail.com',
    MAIL_PORT: toInt(config.MAIL_PORT, 465),
    MAIL_USER: config.MAIL_USER,
    MAIL_PASS: config.MAIL_PASS,
    MAIL_FROM: config.MAIL_FROM,

    LEMONSQUEEZY_API_KEY: lsKey || undefined,
    LEMONSQUEEZY_STORE_ID: lsStore || undefined,
    LEMONSQUEEZY_WEBHOOK_SECRET:
      config.LEMONSQUEEZY_WEBHOOK_SECRET?.trim() || undefined,

    AUDIT_LOG_READS: config.AUDIT_LOG_READS?.trim() === 'true',
    AUDIT_LOG_RETENTION_DAYS: toInt(config.AUDIT_LOG_RETENTION_DAYS, 90),
  };
}
