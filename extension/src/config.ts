// Every URL and tunable the extension uses. The backend contract behind these
// values is in BACKEND_CONTRACT.md.

export const SITE_URL = 'https://th-labs.uz'
/** The NestJS account API: auth, plan, credits, live sessions. */
export const API_BASE = `${SITE_URL}/v1`

/** Registration is a modal on the landing page; there is no /register route. */
export const SIGNUP_URL = `${SITE_URL}/`
export const PRICING_URL = `${SITE_URL}/#pricing`

export const DEFAULT_LANGUAGE = 'en'
/** How loud the original tab audio stays under the dub, 0..1. */
export const DEFAULT_ORIGINAL_VOLUME = 0.15

// Wire format of Gemini Live Translate (contract section 3).
export const INPUT_RATE = 16_000
export const OUTPUT_RATE = 24_000
export const INPUT_MIME = 'audio/pcm;rate=16000'
export const CHUNK_SECONDS = 0.1

/** Socket open but no setupComplete by then: treat the attempt as failed. */
export const CONNECT_TIMEOUT_MS = 15_000
/** Start the next session this long before the current one hits its cap. */
export const ROLLOVER_LEAD_SECONDS = 10
/** How long a replaced socket stays open to deliver what it still owes. */
export const DRAIN_MS = 4_000
export const MAX_RECONNECTS = 5
export const RECONNECT_BASE_MS = 500
/** The server will not grant a session shorter than this (MIN_GRANT_SECONDS). */
export const MIN_GRANT_SECONDS = 30

/** Lead before the first dubbed chunk plays, so it is never scheduled in the past. */
export const PLAYBACK_LEAD_SECONDS = 0.05

/** Debug logging only in `npm run build:debug`. Never logs tokens or audio. */
export const DEBUG = import.meta.env.DEV
