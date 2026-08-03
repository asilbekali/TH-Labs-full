import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

import { STRIPE_CLIENT } from './stripe.provider';

// Thin wrapper around the Stripe SDK. Keeps the nullable-client handling in one
// place: the app boots without Stripe configured, but any operation that truly
// needs the SDK (signature verification, subscription cancel) fails loudly.
@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);

  constructor(
    @Inject(STRIPE_CLIENT) private readonly stripe: Stripe | null,
    private readonly config: ConfigService,
  ) {}

  get enabled(): boolean {
    return this.stripe !== null;
  }

  private client(): Stripe {
    if (!this.stripe) {
      throw new ServiceUnavailableException(
        'Stripe is not configured (STRIPE_SECRET_KEY missing).',
      );
    }
    return this.stripe;
  }

  // Verify a webhook payload against the signature header. Throws on any
  // mismatch so the caller can return 400 without processing.
  constructEvent(rawBody: Buffer | string, signature: string | undefined): Stripe.Event {
    const secret = this.config.get<string>('STRIPE_WEBHOOK_SECRET');
    if (!secret) {
      throw new ServiceUnavailableException('STRIPE_WEBHOOK_SECRET not configured');
    }
    if (!signature) {
      throw new BadRequestException('Missing stripe-signature header');
    }
    try {
      return this.client().webhooks.constructEvent(rawBody, signature, secret);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error';
      this.logger.warn(`Webhook signature verification failed: ${message}`);
      throw new BadRequestException('Invalid webhook signature');
    }
  }

  // Best-effort fetch of a subscription so we can read the real billing period.
  // Returns null when Stripe is unavailable — callers fall back to a computed period.
  async retrieveSubscription(id: string): Promise<Stripe.Subscription | null> {
    if (!this.stripe) return null;
    try {
      return await this.stripe.subscriptions.retrieve(id);
    } catch (err) {
      this.logger.warn(
        `Could not retrieve subscription ${id}: ${err instanceof Error ? err.message : err}`,
      );
      return null;
    }
  }

  // Flip cancel_at_period_end so the user keeps access (and credits) until the
  // paid period ends.
  async cancelAtPeriodEnd(subscriptionId: string): Promise<Stripe.Subscription> {
    return this.client().subscriptions.update(subscriptionId, {
      cancel_at_period_end: true,
    });
  }
}
