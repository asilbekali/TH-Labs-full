// The only module that talks to Lemon Squeezy. It reads; it never creates a
// checkout, and the only thing it ever changes is cancelling a subscription the
// user asked to cancel (or replaced with another plan).
//
// There is no webhook endpoint in this API. Products and their share links
// are made by hand in the LS dashboard; the Buy button sends the browser
// straight to `https://<store>.lemonsqueezy.com/checkout/buy/<uuid>`. What makes
// that safe is this file: afterwards the API asks LS which orders exist for the
// account's email, and credits the ones that are paid.
//
// Why it has to be asked. A share link never calls us, and LS's redirect back
// carries no order id — the only thing that comes back is a browser on a URL,
// and a URL is typed by whoever wants to. Granting credits because someone
// loaded `/plans/success` would be an open till.
//
// So the trust boundary is exactly here. Everything downstream
// (PaymentService.claimOrders / syncRenewals) acts only on what this service
// returns: the order's status and its VARIANT, both set by LS.
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const API = 'https://api.lemonsqueezy.com/v1';

/** One LS order, reduced to what a claim needs. Nothing JSON:API-shaped leaks past this. */
export interface LsOrder {
  id: string;
  /** The order's public UUID — what the LS dashboard and receipts show. */
  identifier: string;
  orderNumber: number;
  /** 'pending' | 'failed' | 'paid' | 'refunded' | 'partial_refund' | 'fraudulent' */
  status: string;
  /** True only for an order whose money has actually arrived. */
  paid: boolean;
  /** What was bought. Set by LS from the share link; the buyer cannot change it. */
  variantId: string | null;
  productName: string | null;
  variantName: string | null;
  /** Total in the order's currency (smallest unit), and the same in USD cents. */
  total: number;
  totalUsd: number;
  currency: string;
  userEmail: string;
  customerId: string | null;
  testMode: boolean;
  createdAt: Date;
}

export interface LsSubscription {
  id: string;
  orderId: string | null;
  /** 'on_trial' | 'active' | 'paused' | 'past_due' | 'unpaid' | 'cancelled' | 'expired' */
  status: string;
  variantId: string | null;
  renewsAt: Date | null;
  endsAt: Date | null;
  cancelled: boolean;
}

export interface LsInvoice {
  id: string;
  subscriptionId: string;
  /** 'initial' | 'renewal' | 'updated' */
  billingReason: string;
  /** 'pending' | 'paid' | 'void' | 'refunded' | 'partial_refund' */
  status: string;
  total: number;
  totalUsd: number;
  currency: string;
  createdAt: Date;
}

/** LS could not be asked (no key, network, outage). Never means "not paid". */
export class LemonSqueezyUnavailableError extends Error {}

type JsonApiResource = {
  id: string;
  attributes: Record<string, unknown>;
};

type JsonApiList = {
  data: JsonApiResource[];
  links?: { next?: string | null };
};

const str = (v: unknown): string | null =>
  v === null || v === undefined || v === '' ? null : String(v);
const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v) || 0);
const date = (v: unknown): Date | null => {
  if (typeof v !== 'string') return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

// Hard cap on pages followed for one listing. A real account has a handful of
// orders; this only stops a misbehaving `links.next` from looping forever.
const MAX_PAGES = 10;

@Injectable()
export class LemonSqueezyService {
  private readonly logger = new Logger(LemonSqueezyService.name);
  private readonly apiKey: string | null;
  private storeId: string | null;
  private storeLookup: Promise<string> | null = null;
  private readonly modeCache = new Map<
    string,
    { value: boolean | null; until: number }
  >();

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.get<string>('LEMONSQUEEZY_API_KEY')?.trim() || null;
    this.storeId =
      this.config.get<string>('LEMONSQUEEZY_STORE_ID')?.trim() || null;

    if (!this.apiKey) {
      // Not fatal: the catalog, the ledger and dubbing all work without it.
      // Only confirming a purchase does not — and the Buy buttons are switched
      // off rather than taking money nothing could ever credit.
      this.logger.warn(
        'LEMONSQUEEZY_API_KEY is not set — a completed purchase cannot be ' +
          'verified, so no checkout can grant credits. Buy buttons stay off.',
      );
    }
  }

  get configured(): boolean {
    return this.apiKey !== null;
  }

  // ── HTTP ──────────────────────────────────────────────────────────────────
  private async request<T>(
    path: string,
    init: { method?: 'GET' | 'DELETE' } = {},
  ): Promise<T> {
    if (!this.apiKey) {
      throw new LemonSqueezyUnavailableError('Lemon Squeezy is not configured.');
    }
    const url = path.startsWith('http') ? path : `${API}${path}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: init.method ?? 'GET',
        headers: {
          Accept: 'application/vnd.api+json',
          'Content-Type': 'application/vnd.api+json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.error(`LS ${init.method ?? 'GET'} ${path} failed: ${detail}`);
      throw new LemonSqueezyUnavailableError(detail);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      this.logger.error(
        `LS ${init.method ?? 'GET'} ${path} → ${res.status} ${body.slice(0, 300)}`,
      );
      throw new LemonSqueezyUnavailableError(`Lemon Squeezy answered ${res.status}`);
    }
    return (await res.json()) as T;
  }

  /** Every resource of a listing, following `links.next`. */
  private async list(path: string): Promise<JsonApiResource[]> {
    const out: JsonApiResource[] = [];
    let next: string | null = path;
    for (let page = 0; next && page < MAX_PAGES; page++) {
      const body: JsonApiList = await this.request<JsonApiList>(next);
      out.push(...(body.data ?? []));
      next = body.links?.next ?? null;
    }
    return out;
  }

  /**
   * The store this key sells from. Read from LEMONSQUEEZY_STORE_ID, or looked
   * up once: a key that can see exactly one store needs no configuration.
   *
   * Orders are always filtered by it, so a key shared across stores can never
   * credit a purchase made in a different one.
   */
  async getStoreId(): Promise<string> {
    if (this.storeId) return this.storeId;
    this.storeLookup ??= (async () => {
      const stores = await this.list('/stores');
      if (stores.length !== 1) {
        this.storeLookup = null;
        throw new LemonSqueezyUnavailableError(
          `This API key sees ${stores.length} stores — set LEMONSQUEEZY_STORE_ID ` +
            `to one of: ${stores.map((s) => `${s.id} (${String(s.attributes.slug)})`).join(', ')}`,
        );
      }
      this.storeId = stores[0].id;
      this.logger.log(
        `Lemon Squeezy store ${this.storeId} (${String(stores[0].attributes.slug)})`,
      );
      return this.storeId;
    })();
    return this.storeLookup;
  }

  // ── Reads ─────────────────────────────────────────────────────────────────
  /**
   * Every order in this store placed with this email.
   *
   * LS filters on exact equality, so the address as stored and its lowercase
   * form are both asked for — a buyer whose account is `Ada@…` and who typed
   * `ada@…` at checkout is the same person.
   */
  async listOrdersByEmail(email: string): Promise<LsOrder[]> {
    const storeId = await this.getStoreId();
    const variants = [...new Set([email.trim(), email.trim().toLowerCase()])];
    const seen = new Map<string, LsOrder>();
    for (const e of variants) {
      const rows = await this.list(
        `/orders?filter[store_id]=${encodeURIComponent(storeId)}` +
          `&filter[user_email]=${encodeURIComponent(e)}&page[size]=100`,
      );
      for (const row of rows) seen.set(row.id, this.toOrder(row));
    }
    return [...seen.values()];
  }

  /** The subscription an order opened, if it was a subscription purchase. */
  async getSubscriptionForOrder(orderId: string): Promise<LsSubscription | null> {
    const rows = await this.list(
      `/subscriptions?filter[order_id]=${encodeURIComponent(orderId)}`,
    );
    return rows[0] ? this.toSubscription(rows[0]) : null;
  }

  async getSubscription(id: string): Promise<LsSubscription> {
    const body = await this.request<{ data: JsonApiResource }>(
      `/subscriptions/${encodeURIComponent(id)}`,
    );
    return this.toSubscription(body.data);
  }

  async listInvoices(subscriptionId: string): Promise<LsInvoice[]> {
    const rows = await this.list(
      `/subscription-invoices?filter[subscription_id]=${encodeURIComponent(subscriptionId)}&page[size]=100`,
    );
    return rows.map((r) => ({
      id: r.id,
      subscriptionId: String(r.attributes.subscription_id ?? subscriptionId),
      billingReason: String(r.attributes.billing_reason ?? ''),
      status: String(r.attributes.status ?? ''),
      total: num(r.attributes.total),
      totalUsd: num(r.attributes.total_usd),
      currency: String(r.attributes.currency ?? 'USD').toLowerCase(),
      createdAt: date(r.attributes.created_at) ?? new Date(0),
    }));
  }

  /**
   * Whether a variant belongs to TEST mode. Cached — the answer never changes
   * for a given variant, and the catalog asks on every pricing-page load. A
   * failed lookup is cached briefly too, so an LS outage does not make every
   * page load wait on it. Null means "could not tell".
   */
  async variantTestMode(variantId: string): Promise<boolean | null> {
    const hit = this.modeCache.get(variantId);
    if (hit && hit.until > Date.now()) return hit.value;
    let value: boolean | null = null;
    try {
      const body = await this.request<{ data: JsonApiResource }>(
        `/variants/${encodeURIComponent(variantId)}`,
      );
      value = body.data.attributes.test_mode === true;
    } catch {
      value = null;
    }
    this.modeCache.set(variantId, {
      value,
      until: Date.now() + (value === null ? 5 * 60_000 : 24 * 60 * 60_000),
    });
    return value;
  }

  // ── The one write ─────────────────────────────────────────────────────────
  /**
   * Cancel a subscription at LS. LS keeps it running to the end of the period
   * it was paid for, then stops billing — the same promise this API makes.
   */
  async cancelSubscription(id: string): Promise<LsSubscription> {
    const body = await this.request<{ data: JsonApiResource }>(
      `/subscriptions/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
    );
    return this.toSubscription(body.data);
  }

  // ── Shaping ───────────────────────────────────────────────────────────────
  private toOrder(row: JsonApiResource): LsOrder {
    const a = row.attributes;
    const item = (a.first_order_item ?? {}) as Record<string, unknown>;
    const status = String(a.status ?? '');
    return {
      id: row.id,
      identifier: String(a.identifier ?? row.id),
      orderNumber: num(a.order_number),
      status,
      paid: status === 'paid',
      variantId: str(item.variant_id),
      productName: str(item.product_name),
      variantName: str(item.variant_name),
      total: num(a.total),
      totalUsd: num(a.total_usd),
      currency: String(a.currency ?? 'USD').toLowerCase(),
      userEmail: String(a.user_email ?? ''),
      customerId: str(a.customer_id),
      testMode: a.test_mode === true,
      createdAt: date(a.created_at) ?? new Date(0),
    };
  }

  private toSubscription(row: JsonApiResource): LsSubscription {
    const a = row.attributes;
    return {
      id: row.id,
      orderId: str(a.order_id),
      status: String(a.status ?? ''),
      variantId: str(a.variant_id),
      renewsAt: date(a.renews_at),
      endsAt: date(a.ends_at),
      cancelled: a.cancelled === true,
    };
  }
}
