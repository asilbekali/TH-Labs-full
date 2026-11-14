// The order a live translation session starts in, and what happens if the
// page goes away part-way. Pulled out of pages/Realtime.tsx so it can be
// tested: node --test src/lib/live-start.test.ts
//
// Microphone first, so a blocked microphone spends none of the day's
// allowance. Then the session is minted, then started. Between each step the
// page may have been left (the user navigated away during the permission
// prompt or while connecting); `alive()` is asked after every wait, and a
// start that is no longer wanted is unwound — mic off, session stopped —
// instead of carrying on invisibly on a page nobody is looking at.
import type { RealtimeSessionGrant } from './realtime-api.ts'

export interface Startable {
  start(): Promise<void>
  stop(): void
}

export interface LiveStartDeps<S extends Startable> {
  getMic(): Promise<MediaStream>
  mint(): Promise<RealtimeSessionGrant>
  open(grant: RealtimeSessionGrant, stream: MediaStream): S
  alive(): boolean
}

export type LiveStartResult<S> =
  | { kind: 'started'; session: S; grant: RealtimeSessionGrant }
  | { kind: 'mic-blocked' }
  | { kind: 'failed'; message: string }
  | { kind: 'abandoned' }

function micOff(stream: MediaStream) {
  for (const track of stream.getTracks()) track.stop()
}

export async function startLive<S extends Startable>(
  deps: LiveStartDeps<S>,
): Promise<LiveStartResult<S>> {
  let stream: MediaStream
  try {
    stream = await deps.getMic()
  } catch {
    return { kind: 'mic-blocked' }
  }
  if (!deps.alive()) {
    micOff(stream)
    return { kind: 'abandoned' }
  }

  let grant: RealtimeSessionGrant
  try {
    grant = await deps.mint()
  } catch (err) {
    micOff(stream)
    return { kind: 'failed', message: err instanceof Error ? err.message : 'Could not start live translation.' }
  }
  if (!deps.alive()) {
    micOff(stream)
    return { kind: 'abandoned' }
  }

  const session = deps.open(grant, stream)
  await session.start()
  if (!deps.alive()) {
    session.stop()
    return { kind: 'abandoned' }
  }
  return { kind: 'started', session, grant }
}
