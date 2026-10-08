// The purchase receipt email — plans, renewals and credit packs.
//
// Deliberately not the 8-bit shell the welcome emails use: a receipt is the
// one email people forward to accounting, so it reads like a quiet, editorial
// product email. Warm paper background, one white card, a serif headline, an
// itemised table, a single dark button, and the brand purple used only as an
// accent.
//
// Same email-client rules as mail.templates.ts: tables and inline styles only,
// no <style>, no web fonts. The logo is the hosted PNG; if images are blocked
// its alt text and the wordmark beside it still say who this is from.

export interface PaymentReceipt {
  /** What was bought: a new plan, a plan renewal, or a one-time credit pack. */
  kind: 'plan' | 'renewal' | 'pack';
  /** Line item as the buyer knows it, e.g. "Pro plan · monthly" or "500 credits". */
  item: string;
  creditsGranted: number;
  /** Credit balance after this purchase landed. */
  balance: number;
  amountCents: number;
  /** Order or invoice reference, quoted back if they write in. */
  reference: string;
  /** Lemon Squeezy's hosted receipt (tax, card details), when it gave one. */
  receiptUrl: string | null;
  paidAt: Date;
  /** End of the paid period, for plans. Next charge happens then. */
  renewsOn?: Date | null;
}

const C = {
  page: '#f5f4ef',
  card: '#ffffff',
  border: '#e6e3da',
  ink: '#1a1a1f',
  body: '#3d3d45',
  muted: '#7a7a85',
  brand: '#6d28d9',
  brandSoft: '#f3effd',
  button: '#1a1a1f',
};

const SERIF = "Georgia, 'Times New Roman', Times, serif";
const SANS =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const num = (n: number) => n.toLocaleString('en-US');
const day = (d: Date) =>
  d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });

function copyFor(name: string, p: PaymentReceipt) {
  switch (p.kind) {
    case 'plan':
      return {
        subject: `Your TH Labs ${p.item} is active`,
        heading: `Welcome to ${p.item.split(' plan')[0]}`,
        lead: `Thanks for subscribing, ${name}. Your plan is active and ${num(p.creditsGranted)} credits are already in your account.`,
      };
    case 'renewal':
      return {
        subject: `Your TH Labs ${p.item} has renewed`,
        heading: 'Your plan has renewed',
        lead: `Thanks for staying with us, ${name}. Your subscription renewed and ${num(p.creditsGranted)} fresh credits are in your account.`,
      };
    case 'pack':
      return {
        subject: `Receipt: ${num(p.creditsGranted)} credits added to your TH Labs account`,
        heading: 'Your credits are ready',
        lead: `Thanks for your purchase, ${name}. ${num(p.creditsGranted)} credits have been added to your account and are ready to use.`,
      };
  }
}

/** Subject, HTML and plain-text body for one receipt. */
export function renderPaymentReceipt(
  name: string,
  appUrl: string,
  p: PaymentReceipt,
): { subject: string; html: string; text: string } {
  const base = appUrl.replace(/\/+$/, '');
  const copy = copyFor(name, p);

  const rows: [string, string][] = [
    ['Item', p.item],
    ['Credits added', num(p.creditsGranted)],
    // LS reports epoch 0 when it omits the date.
    ['Date', day(p.paidAt.getTime() > 0 ? p.paidAt : new Date())],
    ['Reference', p.reference],
  ];
  if (p.renewsOn) rows.push(['Renews on', day(p.renewsOn)]);

  const row = ([label, value]: [string, string]) => `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid ${C.border};font-family:${SANS};font-size:14px;color:${C.muted};">${esc(label)}</td>
      <td align="right" style="padding:10px 0;border-bottom:1px solid ${C.border};font-family:${SANS};font-size:14px;color:${C.ink};">${esc(value)}</td>
    </tr>`;

  const receiptLine = p.receiptUrl
    ? `The official tax receipt is issued by Lemon Squeezy, our payment provider. <a href="${esc(p.receiptUrl)}" style="color:${C.brand};text-decoration:underline;">View your receipt</a>.`
    : 'The official tax receipt is emailed separately by Lemon Squeezy, our payment provider.';

  const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <meta name="supported-color-schemes" content="light" />
    <title>${esc(copy.subject)}</title>
  </head>
  <body style="margin:0;padding:0;background-color:${C.page};">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(copy.lead)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.page}" style="background-color:${C.page};">
      <tr>
        <td align="center" style="padding:40px 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;">

            <tr>
              <td style="padding:0 4px 24px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="padding-right:10px;vertical-align:middle;">
                      <img src="${esc(base)}/logo.png" width="28" height="28" alt="TH Labs" style="display:block;width:28px;height:28px;border:0;" />
                    </td>
                    <td style="vertical-align:middle;font-family:${SANS};font-size:16px;font-weight:600;letter-spacing:-0.2px;color:${C.ink};">TH Labs</td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td bgcolor="${C.card}" style="background-color:${C.card};border:1px solid ${C.border};border-radius:12px;padding:40px 40px 36px;">

                <h1 style="margin:0 0 16px;font-family:${SERIF};font-size:28px;line-height:1.25;font-weight:normal;color:${C.ink};">${esc(copy.heading)}</h1>
                <p style="margin:0 0 28px;font-family:${SANS};font-size:16px;line-height:1.6;color:${C.body};">${esc(copy.lead)}</p>

                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.brandSoft}" style="background-color:${C.brandSoft};border-radius:8px;margin:0 0 28px;">
                  <tr>
                    <td style="padding:18px 20px;font-family:${SANS};font-size:13px;color:${C.muted};">Amount paid<br /><span style="font-family:${SERIF};font-size:26px;line-height:1.4;color:${C.ink};">${usd(p.amountCents)}</span></td>
                    <td align="right" style="padding:18px 20px;font-family:${SANS};font-size:13px;color:${C.muted};">Credit balance<br /><span style="font-family:${SERIF};font-size:26px;line-height:1.4;color:${C.brand};">${num(p.balance)}</span></td>
                  </tr>
                </table>

                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 32px;border-top:1px solid ${C.border};">
                  ${rows.map(row).join('')}
                </table>

                <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 28px;">
                  <tr>
                    <td bgcolor="${C.button}" style="background-color:${C.button};border-radius:8px;">
                      <a href="${esc(base)}/studio" style="display:inline-block;padding:13px 24px;font-family:${SANS};font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">Open the Studio</a>
                    </td>
                  </tr>
                </table>

                <p style="margin:0;font-family:${SANS};font-size:14px;line-height:1.6;color:${C.muted};">${receiptLine}</p>
              </td>
            </tr>

            <tr>
              <td style="padding:28px 4px 0;font-family:${SANS};font-size:13px;line-height:1.6;color:${C.muted};">
                <p style="margin:0 0 12px;">Didn't make this purchase, or something looks wrong? Reply to this email and quote <span style="color:${C.ink};">${esc(p.reference)}</span>. A real person will help.</p>
                <p style="margin:0;">TH Labs &middot; AI video dubbing &middot; <a href="${esc(base)}" style="color:${C.muted};text-decoration:underline;">${esc(base.replace(/^https?:\/\//, ''))}</a></p>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = [
    copy.heading,
    '',
    copy.lead,
    '',
    `Amount paid:    ${usd(p.amountCents)}`,
    `Credit balance: ${num(p.balance)}`,
    '',
    ...rows.map(([l, v]) => `${(l + ':').padEnd(16)}${v}`),
    '',
    `Open the Studio: ${base}/studio`,
    '',
    p.receiptUrl
      ? `Official tax receipt (Lemon Squeezy): ${p.receiptUrl}`
      : 'The official tax receipt is emailed separately by Lemon Squeezy, our payment provider.',
    '',
    `Didn't make this purchase? Reply to this email and quote ${p.reference}.`,
    '',
    'TH Labs',
  ].join('\n');

  return { subject: copy.subject, html, text };
}
