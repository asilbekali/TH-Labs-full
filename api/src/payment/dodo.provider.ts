import { Logger, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import DodoPayments from 'dodopayments';

// Injection token for the Dodo Payments SDK client. It is nullable on purpose:
// the app must still boot in dev without DODO_PAYMENTS_API_KEY set. Without it
// checkout falls back to the static payment links stored on each Plan row, and
// only the operations that genuinely need the API (hosted checkout sessions,
// cancel, customer portal) fail — loudly, with a 503.
export const DODO_CLIENT = 'DODO_CLIENT';

// `test_mode` talks to https://test.dodopayments.com and takes test cards only.
export type DodoEnvironment = 'test_mode' | 'live_mode';

export function dodoEnvironment(raw: string | undefined): DodoEnvironment {
  return raw?.trim() === 'live_mode' ? 'live_mode' : 'test_mode';
}

export const DodoProvider: Provider = {
  provide: DODO_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService): DodoPayments | null => {
    const key = config.get<string>('DODO_PAYMENTS_API_KEY')?.trim();
    if (!key) {
      new Logger('DodoProvider').warn(
        'DODO_PAYMENTS_API_KEY not set — hosted checkout sessions, cancel and the ' +
          'customer portal are disabled; static payment links still work',
      );
      return null;
    }
    return new DodoPayments({
      bearerToken: key,
      environment: dodoEnvironment(
        config.get<string>('DODO_PAYMENTS_ENVIRONMENT'),
      ),
      // Used by webhooks.unwrap() to verify the Standard Webhooks signature.
      // Null is fine here — DodoService refuses to verify without it rather
      // than letting an unverified payload through.
      webhookKey: config.get<string>('DODO_WEBHOOK_SECRET')?.trim() || null,
    });
  },
};
