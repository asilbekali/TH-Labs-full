import { DEBUG } from '../config'

/** Debug-build logging. Callers must never pass tokens, wsUrls or audio. */
export function log(...args: unknown[]): void {
  if (DEBUG) console.log('[th-labs]', ...args)
}
