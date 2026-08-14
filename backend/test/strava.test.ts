import { afterEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as strava from '../src/strava.ts'
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
    STRAVA_CLIENT_ID: 'strava-client',
    STRAVA_CLIENT_SECRET: 'strava-secret',
    POLAR_SESSIONS: kv as unknown as KVNamespace,
    ...overrides,
  } as Env
}

describe('strava oauth and sync', () => {
  it('stores oauth state on connect', async () => {
    const kv = new MemoryKV()
    const response = await strava.connect(new Request('http://worker.test/api/connectors/strava/connect'), env(kv))
    assert.equal(response.status, 302)
    const location = response.headers.get('Location') || ''
    assert.match(location, /strava\.com\/oauth\/authorize/)
    const state = new URL(location).searchParams.get('state')
    assert.ok(state)
    assert.equal(await kv.get(`strava-oauth-state:${state}`), '1')
  })

  it('redirects denied callbacks and rejects bad state', async () => {
    const kv = new MemoryKV()
    const denied = await strava.callback(
      new Request('http://worker.test/api/connectors/strava/callback?error=access_denied'),
      env(kv),
    )
    assert.equal(denied.status, 302)
    assert.match(denied.headers.get('Location') || '', /connector_error=denied/)

    const bad = await strava.callback(
      new Request('http://worker.test/api/connectors/strava/callback?code=x&state=missing'),
      env(kv),
    )
    assert.equal(bad.status, 400)
  })

  it('stores session on valid callback and maps sports on sync', async () => {
    const kv = new MemoryKV()
    const state = '33333333-3333-4333-8333-333333333333'
    await kv.put(`strava-oauth-state:${state}`, '1')
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/oauth/token')) {
        return new Response(
          JSON.stringify({
            access_token: 'strava-token',
            refresh_token: 'refresh',
            expires_at: Math.floor(Date.now() / 1000) + 3600,
          }),
          { status: 200 },
        )
      }
      if (url.includes('/athlete/activities')) {
        return new Response(
          JSON.stringify([
            {
              id: 99,
              name: 'Evening Ride',
              sport_type: 'Ride',
              start_date: '2026-08-10T18:00:00Z',
              moving_time: 3600,
              distance: 32000,
              average_heartrate: 132,
              total_elevation_gain: 400,
              average_speed: 8.8,
            },
          ]),
          { status: 200 },
        )
      }
      return new Response('unexpected', { status: 500 })
    }) as typeof fetch

    const callback = await strava.callback(
      new Request(`http://worker.test/api/connectors/strava/callback?code=abc&state=${state}`),
      env(kv),
    )
    assert.equal(callback.status, 302)
    const session = new URL(callback.headers.get('Location') || '').searchParams.get('connector_session')
    assert.ok(session)

    const sync = await strava.sync(
      new Request('http://worker.test/api/connectors/strava/sync', {
        headers: { 'X-Connector-Sessions': JSON.stringify({ strava: session }) },
      }),
      env(kv),
    )
    assert.equal(sync.status, 200)
    const payload = await sync.json() as { workouts: Array<Record<string, unknown>>; count: number }
    assert.equal(payload.count, 1)
    assert.equal(payload.workouts[0].sport, 'Cycling')
    assert.equal(payload.workouts[0].distanceKm, 32)
    assert.equal(payload.workouts[0].durationSeconds, 3600)
  })
})
