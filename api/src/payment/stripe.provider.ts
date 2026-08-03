import { Logger, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

// Injection token for the Stripe SDK client. It is nullable on purpose: the app
// must still boot in dev without STRIPE_SECRET_KEY set. Only the webhook
// signature verification actually needs the SDK — checkout URLs are built from
// the Payment Links stored on each Plan row, so /payments/checkout works even
// when this is null.
export const STRIPE_CLIENT = 'STRIPE_CLIENT';

export const StripeProvider: Provider = {
  provide: STRIPE_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService): Stripe | null => {
    const key = config.get<string>('STRIPE_SECRET_KEY');
    if (!key) {
      new Logger('StripeProvider').warn(
        'STRIPE_SECRET_KEY not set — webhook verification disabled, checkout links still work',
      );
      return null;
    }
    // Omit apiVersion so the SDK uses the account default and we avoid pinning
    // to a version string the installed SDK might not type.
    return new Stripe(key);
  },
};
