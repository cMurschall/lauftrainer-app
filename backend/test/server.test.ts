import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import server from '../src/server.ts'

const env = {
  ALLOWED_ORIGIN: 'http://localhost:5173', FRONTEND_URL: 'http://localhost:5173',
  POLAR_SESSIONS: { async get() { return null }, async put() {}, async delete() {} },
}

describe('worker routing', () => {
  it('returns health and CORS headers', async () => {
    const response = await server.fetch(new Request('http://worker.test/health', { headers: { Origin: 'http://localhost:5173' } }), env as never)
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { status: 'ok', version: '0.1.0' })
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'http://localhost:5173')
  })

  it('handles preflight and unknown routes', async () => {
    assert.equal((await server.fetch(new Request('http://worker.test/api/x', { method: 'OPTIONS' }), env as never)).status, 204)
    const missing = await server.fetch(new Request('http://worker.test/nope'), env as never)
    assert.equal(missing.status, 404)
    assert.deepEqual(await missing.json(), { detail: 'Not found' })
  })

  it('does not expose connector status without a session', async () => {
    const response = await server.fetch(new Request('http://worker.test/api/polar/status'), env as never)
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { connected: false })
  })
})
