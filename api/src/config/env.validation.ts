// Boot-time environment validation. Registered via ConfigModule's `validate`
// option so the process refuses to start when a required secret is missing,
// rather than crashing later at the first webhook.
//
// Dodo Payments secrets are intentionally *optional*: static payment links
// live on the Plan rows and work without the SDK, and the app must still boot
// in dev without a merchant account. When DODO_WEBHOOK_SECRET is absent the
// webhook route logs a loud warning and rejects every event — see DodoService.
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

  DODO_PAYMENTS_API_KEY?: string;
  DODO_WEBHOOK_SECRET?: string;
  /**
   * 'true' lets /payments/checkout hand out a URL even with no webhook secret.
   * Dev only: such a purchase takes money and grants nothing, so without this
   * the checkout endpoints 503 rather than sell something they cannot honour.
   */
  DODO_ALLOW_UNVERIFIED_CHECKOUT: boolean;
  /** 'test_mode' (default) or 'live_mode'. Decides which Dodo host we talk to. */
  DODO_PAYMENTS_ENVIRONMENT: 'test_mode' | 'live_mode';

  // One Dodo product per purchasable plan. Each accepts a product id
  // (`pdt_…`) or the full payment link copied from the dashboard; the seed
  // reads them onto the Plan rows.
  DODO_PRODUCT_PRO_MONTHLY?: string;
  DODO_PRODUCT_PRO_YEARLY?: string;
  DODO_PRODUCT_STUDIO_MONTHLY?: string;
  DODO_PRODUCT_STUDIO_YEARLY?: string;

  // One-time credit packs (see src/payment/credit-packs.ts).
  DODO_PRODUCT_PACK_100?: string;
  DODO_PRODUCT_PACK_500?: string;
  DODO_PRODUCT_PACK_2000?: string;

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

  const allowUnverifiedCheckout =
    config.DODO_ALLOW_UNVERIFIED_CHECKOUT?.trim() === 'true';

  if (!config.DODO_WEBHOOK_SECRET) {
    logger.error(
      'DODO_WEBHOOK_SECRET not set — /payments/webhook will reject every event, ' +
        'so no purchase can ever grant credits. ' +
        (allowUnverifiedCheckout
          ? 'DODO_ALLOW_UNVERIFIED_CHECKOUT=true, so checkout still hands out ' +
            'URLs: anyone who pays gets NOTHING. Never set this in production.'
          : 'Checkout is therefore disabled (503) rather than selling something ' +
            'that cannot be credited.'),
    );
  }
  if (!config.DODO_PAYMENTS_API_KEY) {
    logger.warn(
      'DODO_PAYMENTS_API_KEY not set — checkout falls back to static payment ' +
        'links, and cancel / customer portal are unavailable.',
    );
  }
  if (config.DODO_PAYMENTS_ENVIRONMENT?.trim() === 'live_mode') {
    logger.log('Dodo Payments: LIVE mode — real money will move.');
  } else {
    logger.warn(
      'Dodo Payments: test mode (set DODO_PAYMENTS_ENVIRONMENT=live_mode to take ' +
        'real payments). Test-card purchases grant real credits in this database.',
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

    DODO_PAYMENTS_API_KEY: config.DODO_PAYMENTS_API_KEY,
    DODO_WEBHOOK_SECRET: config.DODO_WEBHOOK_SECRET,
    DODO_ALLOW_UNVERIFIED_CHECKOUT: allowUnverifiedCheckout,
    DODO_PAYMENTS_ENVIRONMENT:
      config.DODO_PAYMENTS_ENVIRONMENT?.trim() === 'live_mode'
        ? 'live_mode'
        : 'test_mode',

    DODO_PRODUCT_PRO_MONTHLY: config.DODO_PRODUCT_PRO_MONTHLY,
    DODO_PRODUCT_PRO_YEARLY: config.DODO_PRODUCT_PRO_YEARLY,
    DODO_PRODUCT_STUDIO_MONTHLY: config.DODO_PRODUCT_STUDIO_MONTHLY,
    DODO_PRODUCT_STUDIO_YEARLY: config.DODO_PRODUCT_STUDIO_YEARLY,

    DODO_PRODUCT_PACK_100: config.DODO_PRODUCT_PACK_100,
    DODO_PRODUCT_PACK_500: config.DODO_PRODUCT_PACK_500,
    DODO_PRODUCT_PACK_2000: config.DODO_PRODUCT_PACK_2000,

    AUDIT_LOG_READS: config.AUDIT_LOG_READS?.trim() === 'true',
    AUDIT_LOG_RETENTION_DAYS: toInt(config.AUDIT_LOG_RETENTION_DAYS, 90),
  };
}
