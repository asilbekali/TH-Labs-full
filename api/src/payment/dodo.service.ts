import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import DodoPayments from 'dodopayments';

import { DODO_CLIENT, DodoEnvironment, dodoEnvironment } from './dodo.provider';
import { isTestCheckoutUrl, paymentLinkFor } from './dodo-product-ref';

// The three headers Standard Webhooks signs over. Dodo sends exactly these.
const SIGNATURE_HEADERS = [
  'webhook-id',
  'webhook-signature',
  'webhook-timestamp',
] as const;

export interface CheckoutSessionInput {
  productId: string;
  /** Stamped onto the payment AND the subscription, and read back by the webhook. */
  metadata: Record<string, string>;
  customer: { email: string; name: string };
  returnUrl: string;
  quantity?: number;
}

// Thin wrapper around the Dodo Payments SDK. Keeps the nullable-client handling
// in one place: the app boots without an API key, but any operation that truly
// needs it (hosted checkout, cancel, customer portal, signature verification)
// fails loudly instead of pretending to work.
@Injectable()
export class DodoService {
  private readonly logger = new Logger(DodoService.name);

  constructor(
    @Inject(DODO_CLIENT) private readonly dodo: DodoPayments | null,
    private readonly config: ConfigService,
  ) {}

  get enabled(): boolean {
    return this.dodo !== null;
  }

  get environment(): DodoEnvironment {
    return dodoEnvironment(
      this.config.get<string>('DODO_PAYMENTS_ENVIRONMENT'),
    );
  }

  get isTestMode(): boolean {
    return this.environment === 'test_mode';
  }

  /** False when DODO_WEBHOOK_SECRET is missing — every event is then rejected. */
  get webhookConfigured(): boolean {
    return !!this.config.get<string>('DODO_WEBHOOK_SECRET')?.trim();
  }

  private client(): DodoPayments {
    if (!this.dodo) {
      throw new ServiceUnavailableException(
        'Dodo Payments is not configured (DODO_PAYMENTS_API_KEY missing).',
      );
    }
    return this.dodo;
  }

  // ── Webhooks ──────────────────────────────────────────────────────────
  // Verify a payload against the Standard Webhooks signature. Throws on any
  // mismatch so the caller can return 400 without processing.
  //
  // The signature covers the exact bytes Dodo sent, so this must be handed the
  // raw body — a payload the JSON parser has already round-tripped verifies
  // against nothing.
  constructEvent(
    rawBody: Buffer | string,
    headers: Record<string, string | string[] | undefined>,
  ): DodoPayments.UnwrapWebhookEvent {
    if (!this.webhookConfigured) {
      throw new ServiceUnavailableException(
        'DODO_WEBHOOK_SECRET not configured',
      );
    }

    const signatureHeaders: Record<string, string> = {};
    for (const name of SIGNATURE_HEADERS) {
      const value = headers[name];
      const single = Array.isArray(value) ? value[0] : value;
      if (!single) {
        throw new BadRequestException(`Missing ${name} header`);
      }
      signatureHeaders[name] = single;
    }

    const body =
      typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
    try {
      return this.client().webhooks.unwrap(body, {
        headers: signatureHeaders,
        key: this.config.get<string>('DODO_WEBHOOK_SECRET')!.trim(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error';
      this.logger.warn(`Webhook signature verification failed: ${message}`);
      throw new BadRequestException('Invalid webhook signature');
    }
  }

  // ── Checkout ──────────────────────────────────────────────────────────
  // A hosted checkout session. Preferred over a static link because the
  // metadata travels server-side: the webhook can then tell who paid without
  // trusting anything the browser could have edited on the way.
  async createCheckoutSession(input: CheckoutSessionInput): Promise<string> {
    const session = await this.client().checkoutSessions.create({
      product_cart: [
        { product_id: input.productId, quantity: input.quantity ?? 1 },
      ],
      customer: { email: input.customer.email, name: input.customer.name },
      metadata: input.metadata,
      return_url: input.returnUrl,
    });
    // Nullable in the SDK because a session created with a saved payment
    // method has nothing to redirect to. We never pass one, so an empty URL
    // here means something changed on Dodo's side — fail rather than hand the
    // browser an `undefined` to navigate to.
    if (!session.checkout_url) {
      throw new ServiceUnavailableException(
        `Dodo returned checkout session ${session.session_id} with no checkout URL.`,
      );
    }
    return session.checkout_url;
  }

  /**
   * The no-API-key fallback: a static payment link carrying the same metadata
   * as query parameters (`metadata_<key>=<value>`, which Dodo stores on the
   * resulting payment and subscription).
   *
   * These parameters are visible and editable in the address bar, so the
   * webhook treats the user id they carry as a hint and re-checks it against
   * the paying customer's email before granting anything.
   */
  staticCheckoutUrl(
    linkOrProductId: string,
    input: Omit<CheckoutSessionInput, 'productId'>,
  ): string {
    const base = linkOrProductId.includes('://')
      ? linkOrProductId
      : paymentLinkFor(linkOrProductId, this.environment);

    const url = new URL(base);
    url.searchParams.set('quantity', String(input.quantity ?? 1));
    url.searchParams.set('redirect_url', input.returnUrl);
    url.searchParams.set('email', input.customer.email);
    url.searchParams.set('disableEmail', 'true');
    url.searchParams.set('fullName', input.customer.name);
    for (const [key, value] of Object.entries(input.metadata)) {
      url.searchParams.set(`metadata_${key}`, value);
    }
    return url.toString();
  }

  /** Whether a checkout URL points at Dodo's test host. */
  isTestCheckoutUrl(url: string | null | undefined): boolean {
    return isTestCheckoutUrl(url);
  }

  // ── Subscriptions ─────────────────────────────────────────────────────
  // Best-effort fetch so we can read the real next_billing_date. Returns null
  // when Dodo is unavailable — callers fall back to a computed period.
  async retrieveSubscription(
    id: string,
  ): Promise<DodoPayments.Subscription | null> {
    if (!this.dodo) return null;
    try {
      return await this.dodo.subscriptions.retrieve(id);
    } catch (err) {
      this.logger.warn(
        `Could not retrieve subscription ${id}: ${err instanceof Error ? err.message : err}`,
      );
      return null;
    }
  }

  // Dodo's equivalent of Stripe's cancel_at_period_end: the subscription runs
  // to the end of the paid period and simply does not renew.
  async cancelAtPeriodEnd(
    subscriptionId: string,
  ): Promise<DodoPayments.Subscription> {
    return this.client().subscriptions.update(subscriptionId, {
      cancel_at_next_billing_date: true,
      cancel_reason: 'cancelled_by_customer',
    });
  }

  // Dodo-hosted portal where a customer can see invoices, update their card
  // and manage the subscription themselves.
  async customerPortalLink(customerId: string): Promise<string> {
    const session = await this.client().customers.customerPortal.create(
      customerId,
      {
        send_email: false,
      },
    );
    return session.link;
  }
}
