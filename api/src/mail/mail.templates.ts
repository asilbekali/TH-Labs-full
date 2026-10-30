// HTML email templates — the shared shell for every non-receipt email.
//
// Same look as th-labs.uz and the receipt email (receipt.template.ts): warm
// paper page, one white card with a hairline border, the logo and wordmark
// above it, a serif headline, sans-serif body, one dark button, and the brand
// violet used only for links. Quiet and editorial, like a product email from a
// company you trust, so it reads the same whether it is a welcome, a reply to
// feedback, or a warning about an account.
//
// Email-client rules shape the markup:
//
//   1. Clients strip <style> blocks and ignore flexbox/grid, and Outlook drops
//      border-radius. So: tables and inline styles only; rounded corners are a
//      nice-to-have that degrades to square.
//   2. No web fonts (Gmail blocks @font-face). Georgia and the system sans
//      stack stand in for the site's serif display face and Inter.
//   3. The logo is the PNG hosted on the site. If images are blocked, its alt
//      text and the wordmark beside it still say who this is from.
//
// Keep it that way when editing.

export const DEFAULT_APP_URL = 'https://th-labs.uz';

const C = {
  page: '#f5f4ef',
  card: '#ffffff',
  border: '#e6e3da',
  ink: '#1a1a1f',
  body: '#3d3d45',
  muted: '#7a7a85',
  brand: '#6d28d9',
  button: '#1a1a1f',
};

const SERIF = "Georgia, 'Times New Roman', Times, serif";
const SANS =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const SIGNOFF = 'The TH Labs team';

/** Escape user-supplied values before they go anywhere near the markup. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const paragraph = (html: string, margin = '0 0 16px') =>
  `<p style="margin:${margin};font-family:${SANS};font-size:16px;line-height:1.6;color:${C.body};">${html}</p>`;

/** Turn plain text into paragraphs, preserving blank-line breaks. */
function toParagraphs(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((block) => escapeHtml(block.trim()).replace(/\n/g, '<br />'))
    .filter(Boolean)
    .map((block) => paragraph(block))
    .join('');
}

/** The site's origin without a trailing slash, falling back when unset. */
function baseUrl(appUrl: string | undefined): string {
  return (appUrl || DEFAULT_APP_URL).replace(/\/+$/, '');
}

export interface TemplateOptions {
  /** Recipient's display name, used for the greeting. */
  name: string;
  /** Body copy. Blank lines become separate paragraphs. */
  text: string;
  /** Serif headline above the greeting. Omitted, the email opens on "Hi name,". */
  heading?: string;
  /** Optional call-to-action button. */
  cta?: { label: string; url: string };
  /** Small print under the card. */
  footnote?: string;
  /** Where the logo and footer link point. Defaults to th-labs.uz. */
  appUrl?: string;
}

/**
 * The shared shell every outgoing email uses. Pass any heading/body and you
 * get a consistent TH Labs message back: greeting, body, optional button,
 * sign-off.
 */
export function renderEmail(options: TemplateOptions): string {
  const { name, text, heading, cta, footnote } = options;
  const base = baseUrl(options.appUrl);
  const host = base.replace(/^https?:\/\//, '');
  const year = new Date().getFullYear();
  const title = heading ?? `A message from TH Labs`;

  const headline = heading
    ? `<h1 style="margin:0 0 24px;font-family:${SERIF};font-size:28px;line-height:1.25;font-weight:normal;color:${C.ink};">${escapeHtml(heading)}</h1>`
    : '';

  const button = cta
    ? `
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:12px 0 28px;">
                  <tr>
                    <td bgcolor="${C.button}" style="background-color:${C.button};border-radius:8px;">
                      <a href="${escapeHtml(cta.url)}" style="display:inline-block;padding:13px 24px;font-family:${SANS};font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">${escapeHtml(cta.label)}</a>
                    </td>
                  </tr>
                </table>`
    : '';

  const smallPrint = footnote
    ? `<p style="margin:0 0 12px;">${escapeHtml(footnote)}</p>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <meta name="supported-color-schemes" content="light" />
    <title>${escapeHtml(title)}</title>
  </head>
  <body style="margin:0;padding:0;background-color:${C.page};">
    <!-- Preview text shown in the inbox list, hidden in the body itself. -->
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(text.slice(0, 140))}</div>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.page}" style="background-color:${C.page};">
      <tr>
        <td align="center" style="padding:40px 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;">

            <!-- Logo + wordmark -->
            <tr>
              <td style="padding:0 4px 24px;">
                <a href="${escapeHtml(base)}" style="text-decoration:none;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td style="padding-right:10px;vertical-align:middle;">
                        <img src="${escapeHtml(base)}/logo.png" width="28" height="28" alt="TH Labs" style="display:block;width:28px;height:28px;border:0;" />
                      </td>
                      <td style="vertical-align:middle;font-family:${SANS};font-size:16px;font-weight:600;letter-spacing:-0.2px;color:${C.ink};">TH Labs</td>
                    </tr>
                  </table>
                </a>
              </td>
            </tr>

            <!-- Card -->
            <tr>
              <td bgcolor="${C.card}" style="background-color:${C.card};border:1px solid ${C.border};border-radius:12px;padding:40px 40px 36px;">
                ${headline}
                ${paragraph(`Hi ${escapeHtml(name)},`)}
                ${toParagraphs(text)}
                ${button}
                ${paragraph(`Best,<br />${SIGNOFF}`, '8px 0 0')}
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td style="padding:28px 4px 0;font-family:${SANS};font-size:13px;line-height:1.6;color:${C.muted};">
                ${smallPrint}
                <p style="margin:0;">&copy; ${year} TH Labs &middot; AI video dubbing &middot; <a href="${escapeHtml(base)}" style="color:${C.muted};text-decoration:underline;">${escapeHtml(host)}</a></p>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/** Plain-text fallback for clients that refuse HTML. */
export function renderText(options: TemplateOptions): string {
  const base = baseUrl(options.appUrl);
  return [
    ...(options.heading ? [options.heading, ''] : []),
    `Hi ${options.name},`,
    '',
    options.text,
    ...(options.cta ? ['', `${options.cta.label}: ${options.cta.url}`] : []),
    '',
    'Best,',
    SIGNOFF,
    '',
    '--',
    ...(options.footnote ? [options.footnote] : []),
    `TH Labs · ${base.replace(/^https?:\/\//, '')}`,
  ].join('\n');
}

// ── The automatic emails ──────────────────────────────────────────────────
// Each fires as a side effect of something the user did, never from an API call.
// Edit the words here; the shell above takes care of how they look.

/** Sent when someone joins the community from the landing page. */
export function communityWelcomeTemplate(
  name: string,
  appUrl: string,
): TemplateOptions {
  return {
    name,
    heading: 'Welcome to the TH Labs community',
    text:
      `Thanks for joining. We're building the fastest way to dub and localise video ` +
      `with AI: upload once, publish in every language your audience speaks, with ` +
      `voices that still sound like you.\n\n` +
      `We'll email you as soon as your access is ready. Only updates that matter — no spam.`,
    cta: { label: 'Explore TH Labs', url: appUrl },
    footnote: 'Questions? Reply to this email and a real person will answer.',
  };
}

/** Sent when someone registers an account. */
export function signupWelcomeTemplate(
  name: string,
  appUrl: string,
): TemplateOptions {
  return {
    name,
    heading: 'Your TH Labs account is ready',
    text:
      `Your account is set up and you can start dubbing right away.\n\n` +
      `There are free credits waiting for you. Upload a video, choose your target ` +
      `languages, and get back a dub that keeps your own voice.`,
    // Straight to /studio, not the root: they have an account, and the route
    // asks them to sign in if the session has since expired.
    cta: {
      label: 'Open the Studio',
      url: `${appUrl.replace(/\/+$/, '')}/studio`,
    },
    footnote:
      "If you didn't create this account, just reply to this email and we'll sort it out.",
  };
}

/**
 * Sent when someone leaves feedback from inside the app.
 *
 * Deliberately short and makes no promise about a reply date — the one thing a
 * receipt has to do is prove the message was not swallowed by a form.
 */
export function feedbackReceiptTemplate(
  name: string,
  appUrl: string,
): TemplateOptions {
  return {
    name,
    heading: 'We received your feedback',
    text:
      `Thank you for writing to us. A real person on the team reads every message.\n\n` +
      `If it was a bug, we may reply from this address to ask which clip and which ` +
      `settings you used. If it was an idea, it goes on the list we actually build from.`,
    cta: { label: 'Back to TH Labs', url: appUrl },
    footnote: 'Reply to this email to add anything you forgot to mention.',
  };
}
