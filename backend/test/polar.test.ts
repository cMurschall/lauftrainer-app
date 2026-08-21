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
      // Detail fetch: list endpoint never embeds route points even with route=true.
      if (/\/v3\/exercises\/[^/?]+/.test(url)) {
        return new Response(
          JSON.stringify({
            id: 'ex-1',
            name: 'Morning Run',
            sport: 'RUNNING',
            'start-time': '2026-08-10T10:00:00Z',
            duration: 'PT45M30S',
            distance: 7200,
            has_route: true,
            route: [
              { latitude: 52.52, longitude: 13.405, time: 'PT0S' },
              { latitude: 52.521, longitude: 13.406, time: 'PT5S' },
            ],
            samples: [
              { 'recording-rate': 5, 'sample-type': '0', data: '140,145' },
              { 'recording-rate': 5, 'sample-type': '1', data: '10,11' },
            ],
          }),
          { status: 200 },
        )
      }
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
              has_route: true,
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
    const payload = (await ok.json()) as { workouts: Array<Record<string, unknown>>; count: number }
    assert.equal(payload.count, 1)
    assert.equal(payload.workouts[0].durationSeconds, 2730)
    assert.equal(payload.workouts[0].distanceKm, 7.2)
    assert.equal(payload.workouts[0].averageHeartRate, 142)
    assert.equal(payload.workouts[0].elevationGainM, 80)
    const records = payload.workouts[0].records as Array<Record<string, unknown>>
    assert.equal(records.length, 2)
    assert.equal(records[0].latitude, 52.52)
    assert.equal(records[0].heartRateBpm, 140)
    assert.equal(records[1].longitude, 13.406)
    assert.equal(records[1].speedKmh, 11)
  })

  it('maps route+samples from list payload without a second request', async () => {
    const kv = new MemoryKV()
    const session = '33333333-3333-4333-8333-333333333333'
    await kv.put(`polar-session:${session}`, JSON.stringify({ access_token: 'tok' }))
    let detailCalls = 0

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (/\/v3\/exercises\/[^/?]+/.test(url)) {
        detailCalls += 1
        return new Response('should not be called', { status: 500 })
      }
      if (url.includes('/v3/exercises')) {
        return new Response(
          JSON.stringify([
            {
              id: 'ex-2',
              sport: 'RUNNING',
              'start-time': '2026-08-11T10:00:00Z',
              duration: 'PT10M',
              distance: 2000,
              route: [
                { lat: 48.1, lon: 11.5 },
                { lat: 48.11, lon: 11.51 },
              ],
              samples: [{ 'recording-rate': 1, 'sample-type': '0', data: '130,131' }],
            },
          ]),
          { status: 200 },
        )
      }
      return new Response('unexpected', { status: 500 })
    }) as typeof fetch

    const ok = await polar.sync(
      new Request('http://worker.test/api/polar/sync', {
        headers: { 'X-Polar-Session': session },
      }),
      env(kv),
    )
    assert.equal(ok.status, 200)
    assert.equal(detailCalls, 0)
    const payload = (await ok.json()) as {
      workouts: Array<{ records: Array<{ heartRateBpm?: number }> }>
    }
    assert.equal(payload.workouts[0].records.length, 2)
    assert.equal(payload.workouts[0].records[0].heartRateBpm, 130)
  })
})
