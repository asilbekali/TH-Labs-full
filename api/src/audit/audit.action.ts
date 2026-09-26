// Turning a request into a stable action name and a sentence a human reads.
//
// The panel groups and filters on `action`, so it must be stable and must not
// embed ids — `billing.plan.update`, never `billing.plan.clx123.update`. The
// id goes in `resource`, which is what you filter by when chasing one object.

/** What an action was done TO. */
export interface AuditTarget {
  type: string;
  id: string;
}

export interface ActionRule {
  method: string;
  /** Matched against the path with `:param` standing for one segment. */
  pattern: string;
  action: string;
  /**
   * Human sentence for the feed. `:param` values are substituted in, and
   * `:target` is replaced by the resolved label (an email, `PRO/MONTHLY`, a
   * pack slug) — or by `type id` when nothing better can be found.
   */
  summary: string;
  /** Which route param identifies the thing acted on. */
  target?: (params: Record<string, string>) => AuditTarget | undefined;
}

// Every route worth a line in the feed. A request that matches nothing still
// gets logged (see fallbackAction) — this table only makes the common ones
// readable.
const RULES: ActionRule[] = [
  // ── Auth ────────────────────────────────────────────────────────────────
  {
    method: 'POST',
    pattern: '/auth/login',
    action: 'auth.login',
    summary: 'Signed in',
  },
  {
    method: 'POST',
    pattern: '/auth/logout',
    action: 'auth.logout',
    summary: 'Signed out',
  },
  {
    method: 'POST',
    pattern: '/auth/refresh',
    action: 'auth.refresh',
    summary: 'Refreshed session',
  },
  {
    method: 'POST',
    pattern: '/auth/handoff',
    action: 'auth.handoff.issue',
    summary: 'Issued a Studio handoff code',
  },
  {
    method: 'POST',
    pattern: '/auth/handoff/exchange',
    action: 'auth.handoff.exchange',
    summary: 'Redeemed a Studio handoff code',
  },

  // ── Users ───────────────────────────────────────────────────────────────
  {
    method: 'POST',
    pattern: '/users/create-user',
    action: 'user.register',
    summary: 'Registered an account',
  },
  {
    method: 'PATCH',
    pattern: '/users/:id',
    action: 'user.update',
    summary: 'Updated the account :target',
    target: (p) => ({ type: 'user', id: p.id }),
  },
  {
    method: 'PATCH',
    pattern: '/users/:id/role',
    action: 'user.role.change',
    summary: 'Changed the role of :target',
    target: (p) => ({ type: 'user', id: p.id }),
  },
  {
    method: 'DELETE',
    pattern: '/users/:id',
    action: 'user.delete',
    summary: 'Deleted the account :target',
    target: (p) => ({ type: 'user', id: p.id }),
  },

  // ── Admin accounts ──────────────────────────────────────────────────────
  {
    method: 'POST',
    pattern: '/admin',
    action: 'admin.create',
    summary: 'Created an admin account',
  },
  {
    method: 'PATCH',
    pattern: '/admin/:id',
    action: 'admin.update',
    summary: 'Updated the admin account :target',
    target: (p) => ({ type: 'admin', id: p.id }),
  },
  {
    method: 'DELETE',
    pattern: '/admin/:id',
    action: 'admin.delete',
    summary: 'Deleted the admin account :target',
    target: (p) => ({ type: 'admin', id: p.id }),
  },

  // ── Billing: what a customer does ───────────────────────────────────────
  {
    method: 'GET',
    pattern: '/payments/checkout',
    action: 'billing.checkout.plan',
    summary: 'Started checkout for a plan',
  },
  {
    method: 'GET',
    pattern: '/payments/checkout/credits',
    action: 'billing.checkout.credits',
    summary: 'Started checkout for a credit pack',
  },
  {
    method: 'GET',
    pattern: '/payments/portal',
    action: 'billing.portal.open',
    summary: 'Opened the billing portal',
  },
  {
    method: 'POST',
    pattern: '/payments/subscription/cancel',
    action: 'billing.subscription.cancel',
    summary: 'Cancelled their subscription',
  },
  {
    method: 'POST',
    pattern: '/payments/webhook',
    action: 'billing.webhook',
    summary: 'Dodo Payments webhook',
  },
  {
    method: 'POST',
    pattern: '/payments/commit-dub',
    action: 'dub.commit',
    summary: 'Charged a dub',
  },

  // ── Billing: what staff do ──────────────────────────────────────────────
  {
    method: 'PATCH',
    pattern: '/admin/billing/plans/:id',
    action: 'billing.plan.update',
    summary: 'Updated the :target plan',
    target: (p) => ({ type: 'plan', id: p.id }),
  },
  {
    method: 'POST',
    pattern: '/admin/billing/credit-packs',
    action: 'billing.pack.create',
    summary: 'Created a credit pack',
  },
  {
    method: 'PATCH',
    pattern: '/admin/billing/credit-packs/:id',
    action: 'billing.pack.update',
    summary: 'Updated the :target credit pack',
    target: (p) => ({ type: 'creditPack', id: p.id }),
  },
  {
    method: 'DELETE',
    pattern: '/admin/billing/credit-packs/:id',
    action: 'billing.pack.delete',
    summary: 'Deleted the :target credit pack',
    target: (p) => ({ type: 'creditPack', id: p.id }),
  },

  // ── Catalog ─────────────────────────────────────────────────────────────
  {
    method: 'POST',
    pattern: '/languages',
    action: 'language.create',
    summary: 'Added a language',
  },
  {
    method: 'PATCH',
    pattern: '/languages/:id',
    action: 'language.update',
    summary: 'Updated the :target language',
    target: (p) => ({ type: 'language', id: p.id }),
  },
  {
    method: 'DELETE',
    pattern: '/languages/:id',
    action: 'language.delete',
    summary: 'Removed the :target language',
    target: (p) => ({ type: 'language', id: p.id }),
  },
  {
    method: 'POST',
    pattern: '/community',
    action: 'community.join',
    summary: 'Joined the community list',
  },

  // ── Feedback ────────────────────────────────────────────────────────────
  // The POST is anonymous-or-not, so its row usually has no actor — that is
  // correct and is what makes the feed show feedback arriving as an event
  // rather than as something an admin did.
  {
    method: 'POST',
    pattern: '/feedback',
    action: 'feedback.create',
    summary: 'Left feedback',
  },
  {
    method: 'PATCH',
    pattern: '/feedback/:id',
    action: 'feedback.triage',
    summary: 'Triaged the feedback from :target',
    target: (p) => ({ type: 'feedback', id: p.id }),
  },
  {
    method: 'DELETE',
    pattern: '/feedback/:id',
    action: 'feedback.delete',
    summary: 'Deleted the feedback from :target',
    target: (p) => ({ type: 'feedback', id: p.id }),
  },
];

export interface ResolvedAction {
  action: string;
  /** Still contains `:target` — the caller substitutes the resolved label. */
  summary: string;
  target?: AuditTarget;
}

/** Strip the `/v1` version prefix and any query string. */
export function normalizePath(url: string): string {
  const path = url.split('?')[0];
  return path.replace(/^\/v\d+/, '') || '/';
}

function matchPattern(
  pattern: string,
  path: string,
): Record<string, string> | null {
  const want = pattern.split('/').filter(Boolean);
  const got = path.split('/').filter(Boolean);
  if (want.length !== got.length) return null;

  const params: Record<string, string> = {};
  for (let i = 0; i < want.length; i++) {
    if (want[i].startsWith(':')) {
      params[want[i].slice(1)] = got[i];
    } else if (want[i] !== got[i]) {
      return null;
    }
  }
  return params;
}

function substitute(text: string, params: Record<string, string>): string {
  // `:target` is resolved later, so leave it alone here.
  return text.replace(/:(\w+)/g, (match, key: string) =>
    key === 'target' ? match : (params[key] ?? match),
  );
}

/** Put the resolved label into a summary that asked for one. */
export function withTargetLabel(
  summary: string,
  label: string | null | undefined,
  target: AuditTarget | undefined,
): string {
  if (!summary.includes(':target')) return summary;
  const shown = label ?? (target ? `${target.type} ${target.id}` : 'unknown');
  return summary.replace(':target', shown);
}

/**
 * The action name for a request, or a generic one derived from the path.
 *
 * Falling back rather than returning null is deliberate: a route added later
 * and never added here still shows up in the feed, just with a duller name.
 * Silence would be the worse failure for an audit log.
 */
export function resolveAction(method: string, url: string): ResolvedAction {
  const path = normalizePath(url);

  for (const rule of RULES) {
    if (rule.method !== method) continue;
    const params = matchPattern(rule.pattern, path);
    if (!params) continue;
    return {
      action: rule.action,
      // `:target` is deliberately left in place: the label needs a lookup the
      // caller does, so it is substituted once that has happened.
      summary: substitute(rule.summary, params),
      target: rule.target?.(params),
    };
  }

  // e.g. POST /something/:id → "something.post"
  const segments = path.split('/').filter(Boolean);
  const name = segments.filter((s) => !/^\d+$/.test(s)).join('.') || 'root';
  return {
    action: `${name}.${method.toLowerCase()}`,
    summary: `${method} ${path}`,
  };
}

/** Whether a request is worth a row at all. */
export function isAuditable(
  method: string,
  url: string,
  logReads: boolean,
): boolean {
  const path = normalizePath(url);

  // Health and docs are polled by uptime checks and would drown the feed.
  if (path === '/' || path.startsWith('/health') || path.startsWith('/docs')) {
    return false;
  }
  // Reading the audit log must not write to it — that is an infinite feed.
  if (path.startsWith('/admin/logs')) return false;

  if (method !== 'GET') return true;

  // The GETs that are actions rather than reads: they start a payment or open
  // a billing session, and belong in the feed even though nothing changed here.
  const NOTABLE_GETS = ['/payments/checkout', '/payments/portal'];
  if (NOTABLE_GETS.some((p) => path.startsWith(p))) return true;

  return logReads;
}
