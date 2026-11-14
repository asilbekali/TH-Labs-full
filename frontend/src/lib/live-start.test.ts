// Run with: node --test src/lib/live-start.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { startLive } from './live-start.ts'
import type { RealtimeSessionGrant } from './realtime-api.ts'

const grant = { maxSeconds: 300 } as RealtimeSessionGrant

function harness(opts: { aliveAfter?: 'mic' | 'mint' | 'start'; micDenied?: boolean; mintError?: string } = {}) {
  const log: string[] = []
  let alive = true
  const stream = { getTracks: () => [{ stop: () => log.push('mic off') }] } as unknown as MediaStream
  const session = {
    start: async () => {
      log.push('session start')
      if (opts.aliveAfter === 'start') alive = false
    },
    stop: () => log.push('session stop'),
  }
  const deps = {
    getMic: async () => {
      if (opts.micDenied) throw new Error('denied')
      log.push('mic on')
      if (opts.aliveAfter === 'mic') alive = false
      return stream
    },
    mint: async () => {
      log.push('mint')
      if (opts.mintError) throw new Error(opts.mintError)
      if (opts.aliveAfter === 'mint') alive = false
      return grant
    },
    open: () => {
      log.push('open')
      return session
    },
    alive: () => alive,
  }
  return { deps, log, session }
}

test('a normal start opens the mic, mints, then starts the session', async () => {
  const { deps, log, session } = harness()
  const r = await startLive(deps)
  assert.equal(r.kind, 'started')
  assert.equal(r.kind === 'started' && r.session, session)
  assert.deepEqual(log, ['mic on', 'mint', 'open', 'session start'])
})

test('a blocked microphone spends nothing', async () => {
  const { deps, log } = harness({ micDenied: true })
  assert.equal((await startLive(deps)).kind, 'mic-blocked')
  assert.deepEqual(log, [])
})

test('leaving the page during the mic prompt mints nothing and turns the mic off', async () => {
  const { deps, log } = harness({ aliveAfter: 'mic' })
  assert.equal((await startLive(deps)).kind, 'abandoned')
  assert.deepEqual(log, ['mic on', 'mic off'])
})

test('leaving the page while minting never opens a hidden session', async () => {
  const { deps, log } = harness({ aliveAfter: 'mint' })
  assert.equal((await startLive(deps)).kind, 'abandoned')
  assert.deepEqual(log, ['mic on', 'mint', 'mic off'])
})

test('leaving the page while connecting stops the session', async () => {
  const { deps, log } = harness({ aliveAfter: 'start' })
  assert.equal((await startLive(deps)).kind, 'abandoned')
  assert.deepEqual(log, ['mic on', 'mint', 'open', 'session start', 'session stop'])
})

test('a refused session reports why and turns the mic off', async () => {
  const { deps, log } = harness({ mintError: 'Daily live translation limit reached' })
  const r = await startLive(deps)
  assert.deepEqual(r, { kind: 'failed', message: 'Daily live translation limit reached' })
  assert.deepEqual(log, ['mic on', 'mint', 'mic off'])
})
