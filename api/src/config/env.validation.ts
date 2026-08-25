// Boot-time environment validation. Registered via ConfigModule's `validate`
// option so the process refuses to start when a required secret is missing,
// rather than crashing later at the first webhook.
//
// Stripe secrets are intentionally *optional*: checkout links live on the Plan
// rows and work without the SDK, and the app must still boot in dev without a
// Stripe account. When STRIPE_WEBHOOK_SECRET is absent the webhook route logs a
// loud warning and rejects every event — see StripeService.
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
  FREE_DUB_MAX_SECONDS: number;

  // Origin of the dubbing pipeline (FastAPI), probed by GET /v1/health.
  // Optional: an account API with no pipeline attached is a valid deployment,
  // and health then reports `pipeline: "not_configured"` rather than guessing.
  DUB_API_URL?: string;

  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;

  STRIPE_LINK_PRO_WEEKLY?: string;
  STRIPE_LINK_PRO_MONTHLY?: string;
  STRIPE_LINK_PRO_YEARLY?: string;
  STRIPE_LINK_STUDIO_WEEKLY?: string;
  STRIPE_LINK_STUDIO_MONTHLY?: string;
  STRIPE_LINK_STUDIO_YEARLY?: string;
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

  if (!config.STRIPE_SECRET_KEY || !config.STRIPE_WEBHOOK_SECRET) {
    logger.warn(
      'STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET not set — the /payments/webhook ' +
        'route will reject all events until they are configured. Checkout links still work.',
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
    FREE_DUB_MAX_SECONDS: toInt(config.FREE_DUB_MAX_SECONDS, 120),

    DUB_API_URL: config.DUB_API_URL?.trim() || undefined,

    STRIPE_SECRET_KEY: config.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: config.STRIPE_WEBHOOK_SECRET,

    STRIPE_LINK_PRO_WEEKLY: config.STRIPE_LINK_PRO_WEEKLY,
    STRIPE_LINK_PRO_MONTHLY: config.STRIPE_LINK_PRO_MONTHLY,
    STRIPE_LINK_PRO_YEARLY: config.STRIPE_LINK_PRO_YEARLY,
    STRIPE_LINK_STUDIO_WEEKLY: config.STRIPE_LINK_STUDIO_WEEKLY,
    STRIPE_LINK_STUDIO_MONTHLY: config.STRIPE_LINK_STUDIO_MONTHLY,
    STRIPE_LINK_STUDIO_YEARLY: config.STRIPE_LINK_STUDIO_YEARLY,
  };
}
