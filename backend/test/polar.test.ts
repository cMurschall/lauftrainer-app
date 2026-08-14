import { afterEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as polar from '../src/polar.ts'
import type { Env } from '../src/types.ts'
import { MemoryKV } from './helpers/memoryKv.ts'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

function env(kv: MemoryKV, overrides: Partial<Env> = {}): Env {
  return {
    ALLOWED_ORIGIN: 'http://localhost:5173',
    FRONTEND_URL: 'http://localhost:5173',
    POLAR_CLIENT_ID: 'polar-client',
    POLAR_CLIENT_SECRET: 'polar-secret',
    POLAR_SESSIONS: kv as unknown as KVNamespace,
    ...overrides,
  } as Env
}

describe('polar oauth and sync', () => {
  it('stores oauth state on connect', async () => {
    const kv = new MemoryKV()
    const response = await polar.connect(new Request('http://worker.test/api/polar/connect'), env(kv))
    assert.equal(response.status, 302)
    const location = response.headers.get('Location') || ''
    assert.match(location, /flow\.polar\.com/)
    const state = new URL(location).searchParams.get('state')
    assert.ok(state)
    assert.equal(await kv.get(`oauth-state:${state}`), '1')
  })

  it('rejects callback with missing or unknown state', async () => {
    const kv = new MemoryKV()
    const response = await polar.callback(
      new Request('http://worker.test/api/polar/callback?code=abc&state=unknown'),
      env(kv),
    )
    assert.equal(response.status, 400)
  })

  it('exchanges code and stores polar session on valid callback', async () => {
    const kv = new MemoryKV()
    const state = '11111111-1111-4111-8111-111111111111'
    await kv.put(`oauth-state:${state}`, '1')
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ access_token: 'polar-token', x_user_id: '42' }), { status: 200 })) as typeof fetch

    const response = await polar.callback(
      new Request(`http://worker.test/api/polar/callback?code=abc&state=${state}`),
      env(kv),
    )
    assert.equal(response.status, 302)
    const location = response.headers.get('Location') || ''
    assert.match(location, /connector=polar/)
    const session = new URL(location).searchParams.get('connector_session')
    assert.ok(session)
    assert.match(session, /^[0-9a-f-]{36}$/i)
    assert.ok(await kv.get(`polar-session:${session}`))
    assert.equal(await kv.get(`oauth-state:${state}`), null)
  })

  it('maps polar exercises on sync and rejects invalid session ids', async () => {
    const kv = new MemoryKV()
    const session = '22222222-2222-4222-8222-222222222222'
    await kv.put(`polar-session:${session}`, JSON.stringify({ access_token: 'tok', x_user_id: '9' }))

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/v3/users')) return new Response(null, { status: 409 })
      if (url.includes('/v3/exercises')) {
        return new Response(
          JSON.stringify([
            {
              id: 'ex-1',
              name: 'Morning Run',
              sport: 'RUNNING',
              'start-time': '2026-08-10T10:00:00Z',
              duration: 'PT45M30S',
              distance: 7200,
              'average-heart-rate': 142,
              calories: 500,
              ascent: 80,
            },
          ]),
          { status: 200 },
        )
      }
      return new Response('unexpected', { status: 500 })
    }) as typeof fetch

    const bad = await polar.sync(
      new Request('http://worker.test/api/polar/sync', { headers: { 'X-Polar-Session': 'not-a-uuid' } }),
      env(kv),
    )
    assert.equal(bad.status, 401)

    const ok = await polar.sync(
      new Request('http://worker.test/api/polar/sync', {
        headers: { 'X-Connector-Sessions': JSON.stringify({ polar: session }) },
      }),
      env(kv),
    )
    assert.equal(ok.status, 200)
    const payload = await ok.json() as { workouts: Array<Record<string, unknown>>; count: number }
    assert.equal(payload.count, 1)
    assert.equal(payload.workouts[0].durationSeconds, 2730)
    assert.equal(payload.workouts[0].distanceKm, 7.2)
    assert.equal(payload.workouts[0].averageHeartRate, 142)
    assert.equal(payload.workouts[0].elevationGainM, 80)
  })
})
