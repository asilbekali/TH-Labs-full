// Pure rules behind POST /v1/realtime/session: how much of the one-time free
// trial a user has left, what their real-time minutes buy after that, which Google
// language code a catalog code becomes, and the ephemeral-token request that
// locks a session to one model and one target language. Kept free of Nest and Prisma so it can be tested directly.

/** A session shorter than this is not worth handing out. */
export const MIN_GRANT_SECONDS = 30;

/**
 * Whether `email` is on the comma-separated list of accounts with no daily
 * allowance (REALTIME_UNLIMITED_EMAILS) — testers and staff. Case and spacing
 * do not matter; an empty list matches nobody.
 */
export function isUnlimited(
  email: string | undefined,
  list: string | undefined,
): boolean {
  const me = email?.trim().toLowerCase();
  if (!me || !list) return false;
  return list
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .includes(me);
}

/** How long a minted token may be used to OPEN a session. */
const OPEN_WINDOW_SECONDS = 60;

/** Grace past the granted seconds before Google cuts the socket. */
const EXPIRY_SLACK_SECONDS = 15;

/**
 * Longest paid session. The charge is for granted time and is never handed
 * back, so a session stopped early can lose at most one minute; clients carry
 * on by starting the next one.
 */
const PAID_SESSION_SECONDS = 60;

export interface Allowance {
  ok: boolean;
  remainingSeconds: number;
  grantSeconds: number;
}

/**
 * What a user who has been granted `usedSeconds` of free time, ever, may start
 * next out of a `trialSeconds` trial. The trial is once per account: it never
 * resets. Granted, not measured: the browser talks to Google directly, so the
 * server never sees how long a session really ran, and the grant is the bound.
 */
export function allowance(
  usedSeconds: number,
  trialSeconds: number,
  sessionSeconds: number,
): Allowance {
  const remainingSeconds = Math.max(0, trialSeconds - usedSeconds);
  // TODO(human): decide what happens to a trial tail under MIN_GRANT_SECONDS
  // (e.g. 20 s left). Today it is refused below and never used, so the next
  // session is paid in full.
  const grant = Math.min(sessionSeconds, remainingSeconds);
  const ok = grant >= MIN_GRANT_SECONDS;
  return { ok, remainingSeconds, grantSeconds: ok ? grant : 0 };
}

export interface PaidGrant {
  ok: boolean;
  grantSeconds: number;
  /** Seconds taken from the real-time wallet: always the grant itself. */
  cost: number;
}

/**
 * What `balanceSeconds` left in the real-time wallet buys next, once the free
 * trial is used up. The wallet holds time, so a grant costs exactly its own
 * length and there is no rounding to lose.
 */
export function paidGrant(
  balanceSeconds: number,
  sessionSeconds: number,
): PaidGrant {
  const balance = Number.isFinite(balanceSeconds)
    ? Math.max(0, Math.floor(balanceSeconds))
    : 0;
  const grant = Math.min(sessionSeconds, PAID_SESSION_SECONDS, balance);
  const ok = grant >= MIN_GRANT_SECONDS;
  return { ok, grantSeconds: ok ? grant : 0, cost: ok ? grant : 0 };
}

// The app's 32 catalog languages (backend/app/languages.py). Google takes
// BCP-47; all but two of ours are already valid there.
const CATALOG = [
  'en',
  'uz',
  'ru',
  'es',
  'fr',
  'de',
  'it',
  'pt',
  'nl',
  'pl',
  'tr',
  'ar',
  'fa',
  'hi',
  'bn',
  'ur',
  'zh',
  'ja',
  'ko',
  'vi',
  'id',
  'th',
  'uk',
  'kk',
  'az',
  'sv',
  'cs',
  'el',
  'he',
  'ro',
  'hu',
  'fi',
] as const;
const GOOGLE_SPELLING: Record<string, string> = {
  zh: 'zh-Hans', // Google lists Simplified and Traditional; NLLB's zho_Hans
  pt: 'pt-BR', //  Google lists pt-BR and pt-PT; pt-BR is the larger market
};

/** The Live Translate code for an app language, or null if we don't offer it. */
export function toGoogleLanguage(code: string): string | null {
  if (!(CATALOG as readonly string[]).includes(code)) return null;
  return GOOGLE_SPELLING[code] ?? code;
}

export interface TokenRequest {
  uses: number;
  newSessionExpireTime: string;
  expireTime: string;
  bidiGenerateContentSetup: {
    model: string;
    generationConfig: {
      responseModalities: string[];
      translationConfig: { targetLanguageCode: string };
    };
    inputAudioTranscription: Record<string, never>;
    outputAudioTranscription: Record<string, never>;
  };
}

/**
 * Body of POST /v1beta/auth_tokens. `bidiGenerateContentSetup` is the REST
 * name for what the SDKs call liveConnectConstraints — REST rejects the SDK
 * name with 400 "Unknown name" (verified in api/scripts/gemini-live-smoke.mjs).
 * Locking the setup means a token minted for Uzbek cannot be used for anything
 * but translating into Uzbek with this model.
 */
export function tokenRequestBody(
  now: Date,
  model: string,
  targetLanguage: string,
  grantSeconds: number,
): TokenRequest {
  const at = (s: number) => new Date(now.getTime() + s * 1000).toISOString();
  return {
    uses: 1,
    newSessionExpireTime: at(OPEN_WINDOW_SECONDS),
    expireTime: at(grantSeconds + EXPIRY_SLACK_SECONDS),
    bidiGenerateContentSetup: {
      model: `models/${model}`,
      generationConfig: {
        responseModalities: ['AUDIO'],
        translationConfig: { targetLanguageCode: targetLanguage },
      },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
    },
  };
}
