// HTML email templates — 8-bit / pixel-art styling.
//
// Two constraints shape everything here:
//
//   1. Email clients strip <style> blocks, ignore flexbox/grid, and Outlook
//      drops border-radius and box-shadow. So: tables, inline styles, square
//      corners, and a "shadow" faked with an offset background cell.
//   2. No external assets. Gmail blocks @font-face, so the retro look comes
//      from the one monospace stack every machine already has, and the logo is
//      real pixel art built from table cells — one <td> per pixel. Nothing to
//      download, nothing to block, sharp at any zoom.
//
// Keep it that way when editing.

const BRAND = {
  name: 'TH LABS',
  accent: '#7c5cff',
  accentSoft: '#a78bfa',
  screen: '#05050a',
  bg: '#0b0b12',
  card: '#14141f',
  shadow: '#000000',
  text: '#e9e9f0',
  muted: '#9a9ab0',
  cyan: '#5ce1ff',
};

// The only font stack that is both universally installed and unmistakably
// retro. A pixel webfont would be nicer and would not load in Gmail.
const MONO = "'Courier New', Courier, 'Lucida Console', Monaco, monospace";

// ── Pixel art ──────────────────────────────────────────────────────────────

/** A tiny CRT with a play button on it. One character per pixel. */
const LOGO_PIXELS = [
  '.FFFFFFFFFFF.',
  'FSSSSSSSSSSSF',
  'FSSSSSSSSSSSF',
  'FSSSPPSSSSSSF',
  'FSSSPPPSSSSSF',
  'FSSSPPPPSSSSF',
  'FSSSPPPSSSSSF',
  'FSSSPPSSSSSSF',
  'FSSSSSSSSSSSF',
  'FFFFFFFFFFFFF',
  '..FF.....FF..',
];

const PIXEL_COLORS: Record<string, string | null> = {
  F: BRAND.accent, // frame
  S: BRAND.screen, // screen
  P: BRAND.cyan, // play triangle
  '.': null, // transparent — falls through to the card colour
};

/**
 * Render a character grid as a table of coloured cells.
 *
 * `font-size:0;line-height:0` on every cell is load-bearing: without it clients
 * reserve space for the (empty) text node and the pixels stop being square.
 */
function renderPixelArt(rows: string[], size: number): string {
  const cells = rows
    .map((row) => {
      const tds = [...row]
        .map((char) => {
          const color = PIXEL_COLORS[char];
          const bg = color ? ` bgcolor="${color}"` : '';
          return `<td${bg} width="${size}" height="${size}" style="width:${size}px;height:${size}px;font-size:0;line-height:0;padding:0;${color ? `background-color:${color};` : ''}">&nbsp;</td>`;
        })
        .join('');
      return `<tr>${tds}</tr>`;
    })
    .join('');

  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;mso-table-lspace:0;mso-table-rspace:0;">${cells}</table>`;
}

/** A dithered checkerboard strip, used as a divider. */
function renderDitherBar(width: number, size: number): string {
  const tds = Array.from({ length: width }, (_, i) => {
    const color = i % 2 === 0 ? BRAND.accent : BRAND.card;
    return `<td bgcolor="${color}" width="${size}" height="${size}" style="width:${size}px;height:${size}px;font-size:0;line-height:0;padding:0;background-color:${color};">&nbsp;</td>`;
  }).join('');

  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;"><tr>${tds}</tr></table>`;
}

// ── Rendering ──────────────────────────────────────────────────────────────

/** Escape user-supplied values before they go anywhere near the markup. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Turn plain text into paragraphs, preserving blank-line breaks. */
function toParagraphs(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((block) => escapeHtml(block.trim()).replace(/\n/g, '<br />'))
    .filter(Boolean)
    .map(
      (block) =>
        `<p style="margin:0 0 18px;font-family:${MONO};font-size:15px;line-height:1.8;color:${BRAND.text};">${block}</p>`,
    )
    .join('');
}

export interface TemplateOptions {
  /** Recipient's display name, used for the greeting. */
  name: string;
  /** Body copy. Blank lines become separate paragraphs. */
  text: string;
  /** Big line above the body. Defaults to a greeting built from `name`. */
  heading?: string;
  /** Optional call-to-action button. */
  cta?: { label: string; url: string };
  /** Small print under the divider. */
  footnote?: string;
}

/**
 * The shared 8-bit shell every outgoing email uses. Pass any heading/body and
 * you get a consistent TH Labs-looking message back.
 */
export function renderEmail(options: TemplateOptions): string {
  const { name, text, cta, footnote } = options;
  const heading = options.heading ?? `HEY ${name.toUpperCase()}`;
  const year = new Date().getFullYear();

  // Square, thick-bordered, and typed in caps — a button from a 1992 menu
  // screen. Built as a table so Outlook renders the border at all.
  const button = cta
    ? `
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:10px 0 2px;">
          <tr>
            <td bgcolor="${BRAND.shadow}" style="padding:0 4px 4px 0;background-color:${BRAND.shadow};">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td bgcolor="${BRAND.accent}" style="background-color:${BRAND.accent};border:3px solid ${BRAND.text};">
                    <a href="${escapeHtml(cta.url)}"
                       style="display:inline-block;padding:13px 26px;font-family:${MONO};font-size:14px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase;color:#ffffff;text-decoration:none;">
                      &#9658;&nbsp; ${escapeHtml(cta.label)}
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>`
    : '';

  const footer = footnote
    ? `<p style="margin:0 0 12px;font-family:${MONO};font-size:12px;line-height:1.7;color:${BRAND.muted};">${escapeHtml(footnote)}</p>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <meta name="color-scheme" content="dark light" />
    <title>${escapeHtml(heading)}</title>
  </head>
  <body style="margin:0;padding:0;background-color:${BRAND.bg};">
    <!-- Preview text shown in the inbox list, hidden in the body itself. -->
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">
      ${escapeHtml(text.slice(0, 120))}
    </div>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
           style="background-color:${BRAND.bg};padding:36px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                 style="max-width:560px;width:100%;">

            <!-- Pixel logo + wordmark -->
            <tr>
              <td align="center" style="padding-bottom:14px;">
                ${renderPixelArt(LOGO_PIXELS, 7)}
              </td>
            </tr>
            <tr>
              <td align="center" style="padding-bottom:22px;">
                <span style="font-family:${MONO};font-size:17px;font-weight:bold;letter-spacing:5px;color:${BRAND.text};">
                  TH&nbsp;<span style="color:${BRAND.accentSoft};">LABS</span>
                </span>
              </td>
            </tr>

            <!-- Card, with a hard offset shadow instead of a soft one -->
            <tr>
              <td bgcolor="${BRAND.shadow}" style="padding:0 6px 6px 0;background-color:${BRAND.shadow};">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                       style="background-color:${BRAND.card};border:3px solid ${BRAND.accent};">
                  <tr>
                    <td style="padding:34px 32px 30px;">

                      <h1 style="margin:0 0 8px;font-family:${MONO};font-size:21px;line-height:1.45;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:#ffffff;">
                        ${escapeHtml(heading)}
                      </h1>

                      <!-- Dither strip under the headline -->
                      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px;">
                        <tr><td>${renderDitherBar(24, 5)}</td></tr>
                      </table>

                      ${toParagraphs(text)}
                      ${button}
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td align="center" style="padding:28px 20px 0;">
                ${footer}
                <p style="margin:0;font-family:${MONO};font-size:11px;line-height:1.7;letter-spacing:0.5px;color:${BRAND.muted};">
                  &copy; ${year} ${BRAND.name} &nbsp;&#9642;&nbsp; YOU SIGNED UP AT TH LABS
                </p>
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
  const heading = options.heading ?? `Hey ${options.name}`;
  const cta = options.cta ? `\n\n> ${options.cta.label}: ${options.cta.url}` : '';
  const footnote = options.footnote ? `\n\n${options.footnote}` : '';
  const rule = '='.repeat(46);

  return `${rule}\n  ${heading.toUpperCase()}\n${rule}\n\n${options.text}${cta}${footnote}\n\n-- ${BRAND.name} --`;
}

// ── The two automatic emails ──────────────────────────────────────────────
// Both fire as a side effect of something the user did, never from an API call.
// Edit the words here; the shell above takes care of how they look.

/** Sent when someone joins the community from the landing page. */
export function communityWelcomeTemplate(
  name: string,
  appUrl: string,
): TemplateOptions {
  return {
    name,
    heading: `Player 2 has entered, ${name}`,
    text:
      `You're in — welcome to the TH Labs community.\n\n` +
      `We're building the fastest way to dub and localise video with AI: upload once, ` +
      `ship in every language your audience speaks, with voices that actually sound like you.\n\n` +
      `We'll email you the moment your access is ready. No spam, no noise — just the good stuff.`,
    cta: { label: 'Explore TH Labs', url: appUrl },
    footnote: 'Questions? Just reply to this email — a real person reads it.',
  };
}

/** Sent when someone registers an account. */
export function signupWelcomeTemplate(
  name: string,
  appUrl: string,
): TemplateOptions {
  return {
    name,
    heading: `Insert coin — you're in, ${name}`,
    text:
      `Your TH Labs account is set up and you can start dubbing right now.\n\n` +
      `You've got free credits waiting. Upload a video, pick your target languages, ` +
      `and get back a dub that keeps your own voice.\n\n` +
      `Sign in and the Studio is yours.`,
    // Straight to /studio, not the root: they have an account, and the route
    // asks them to sign in if the session has since expired.
    cta: { label: 'Open the Studio', url: `${appUrl.replace(/\/+$/, '')}/studio` },
    footnote:
      "If you didn't create this account, just reply to this email and we'll sort it out.",
  };
}
