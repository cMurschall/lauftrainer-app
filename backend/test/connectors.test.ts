import { afterEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as connectors from '../src/connectors.ts'
import type { Env } from '../src/types.ts'
import { MemoryKV } from './helpers/memoryKv.ts'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

function env(kv: MemoryKV): Env {
  return {
    ALLOWED_ORIGIN: 'http://localhost:5173',
    FRONTEND_URL: 'http://localhost:5173',
    POLAR_CLIENT_ID: 'polar-client',
    POLAR_CLIENT_SECRET: 'polar-secret',
    STRAVA_CLIENT_ID: 'strava-client',
    STRAVA_CLIENT_SECRET: 'strava-secret',
    POLAR_SESSIONS: kv as unknown as KVNamespace,
  } as Env
}

describe('connectors orchestration', () => {
  it('aggregates sync errors while keeping successful connectors', async () => {
    const kv = new MemoryKV()
    const polarSession = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const stravaSession = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    await kv.put(`polar-session:${polarSession}`, JSON.stringify({ access_token: 'polar' }))
    await kv.put(
      `strava-session:${stravaSession}`,
      JSON.stringify({
        access_token: 'strava',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      }),
    )

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('polaraccesslink.com')) {
        return new Response(JSON.stringify({ detail: 'boom' }), { status: 502 })
      }
      if (url.includes('strava.com/api')) {
        return new Response(
          JSON.stringify([
            {
              id: 1,
              name: 'Run',
              sport_type: 'Run',
              start_date: '2026-08-10T10:00:00Z',
              moving_time: 1800,
              distance: 5000,
            },
          ]),
          { status: 200 },
        )
      }
      return new Response('unexpected', { status: 500 })
    }) as typeof fetch

    const response = await connectors.syncAll(
      new Request('http://worker.test/api/connectors/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Connector-Sessions': JSON.stringify({ polar: polarSession, strava: stravaSession }),
        },
        body: JSON.stringify({ active: ['polar', 'strava'] }),
      }),
      env(kv),
    )
    assert.equal(response.status, 200)
    const payload = (await response.json()) as {
      results: Array<{ connector: string; workouts: unknown[]; error?: string }>
    }
    const polar = payload.results.find((item) => item.connector === 'polar')
    const strava = payload.results.find((item) => item.connector === 'strava')
    assert.ok(polar?.error)
    assert.equal(polar?.workouts.length, 0)
    assert.equal(strava?.error, undefined)
    assert.equal(strava?.workouts.length, 1)
  })

  it('disconnect deletes a valid session from KV', async () => {
    const kv = new MemoryKV()
    const session = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    await kv.put(`polar-session:${session}`, JSON.stringify({ access_token: 'x' }))
    const response = await connectors.disconnect(
      new Request('http://worker.test/api/connectors/polar/disconnect', {
        method: 'POST',
        headers: { 'X-Connector-Sessions': JSON.stringify({ polar: session }) },
      }),
      env(kv),
      'polar',
    )
    assert.equal(response.status, 200)
    assert.equal(await kv.get(`polar-session:${session}`), null)
  })
})
