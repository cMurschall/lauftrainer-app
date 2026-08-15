import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createAdminRestore, createAdminVoucher, isAdminAuthorized } from '../src/admin.ts'
import { balance, createWallet } from '../src/billing.ts'
import type { Env } from '../src/types.ts'
import { MemoryD1 } from './helpers/memoryD1.ts'

const baseEnv = {
  ALLOWED_ORIGIN: 'http://localhost:5173',
  FRONTEND_URL: 'http://localhost:5173',
  POLAR_SESSIONS: { async get() { return null }, async put() {}, async delete() {} },
  ADMIN_SECRET: 'test-admin-secret',
}

function envWithDb(db: MemoryD1, overrides: Partial<Env> = {}): Env {
  return { ...baseEnv, DB: db as unknown as D1Database, ...overrides } as Env
}

function adminHeaders(extra: Record<string, string> = {}) {
  return { 'Content-Type': 'application/json', 'X-Admin-Secret': 'test-admin-secret', ...extra }
}

async function createTestWallet(db: MemoryD1) {
  const env = envWithDb(db)
  const response = await createWallet(new Request('http://worker.test/api/billing/wallet', { method: 'POST' }), env)
  assert.equal(response.status, 201)
  return { env, ...(await response.json() as { wallet_token: string; wallet_id: string }) }
}

describe('admin', () => {
  it('authorizes via Access JWT or admin secret', () => {
    const env = envWithDb(new MemoryD1())
    assert.equal(isAdminAuthorized(new Request('http://worker.test/x'), env), false)
    assert.equal(
      isAdminAuthorized(new Request('http://worker.test/x', { headers: { 'X-Admin-Secret': 'wrong' } }), env),
      false,
    )
    assert.equal(
      isAdminAuthorized(new Request('http://worker.test/x', { headers: { 'X-Admin-Secret': 'test-admin-secret' } }), env),
      true,
    )
    assert.equal(
      isAdminAuthorized(new Request('http://worker.test/x', { headers: { 'Cf-Access-Jwt-Assertion': 'jwt' } }), env),
      true,
    )
  })

  it('rejects voucher create without auth', async () => {
    const db = new MemoryD1()
    const env = envWithDb(db)
    const denied = await createAdminVoucher(
      new Request('http://worker.test/api/admin/vouchers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 5 }),
      }),
      env,
    )
    assert.equal(denied.status, 401)
  })

  it('creates vouchers and returns plaintext code once', async () => {
    const db = new MemoryD1()
    const env = envWithDb(db)
    const created = await createAdminVoucher(
      new Request('http://worker.test/api/admin/vouchers', {
        method: 'POST',
        headers: adminHeaders(),
        body: JSON.stringify({ amount: 7, max_redemptions: 3, code: 'beta-test-01' }),
      }),
      env,
    )
    assert.equal(created.status, 201)
    const payload = await created.json() as { code: string; amount: number; max_redemptions: number }
    assert.equal(payload.code, 'BETA-TEST-01')
    assert.equal(payload.amount, 7)
    assert.equal(payload.max_redemptions, 3)
    assert.equal(db.vouchers.length, 1)

    const dup = await createAdminVoucher(
      new Request('http://worker.test/api/admin/vouchers', {
        method: 'POST',
        headers: adminHeaders(),
        body: JSON.stringify({ amount: 1, code: 'BETA-TEST-01' }),
      }),
      env,
    )
    assert.equal(dup.status, 409)
  })

  it('restores wallet by transaction id and rotates token', async () => {
    const db = new MemoryD1()
    const { env, wallet_id, wallet_token } = await createTestWallet(db)
    db.credit_ledger.push({
      ledger_id: 'ledger_seed',
      wallet_id,
      amount: 10,
      kind: 'paddle',
      reference_id: 'txn_abc',
      created_at: new Date().toISOString(),
    })
    db.paddle_events.push({
      event_id: 'evt_1',
      transaction_id: 'txn_abc',
      wallet_id,
      amount: 10,
      created_at: new Date().toISOString(),
    })

    const restored = await createAdminRestore(
      new Request('http://worker.test/api/admin/restore', {
        method: 'POST',
        headers: adminHeaders(),
        body: JSON.stringify({ transaction_id: 'txn_abc' }),
      }),
      env,
    )
    assert.equal(restored.status, 200)
    const payload = await restored.json() as { wallet_id: string; balance: number; restore_url: string }
    assert.equal(payload.wallet_id, wallet_id)
    assert.equal(payload.balance, 10)
    assert.match(payload.restore_url, /^http:\/\/localhost:5173\/restore#token=/)

    const oldToken = await balance(new Request('http://worker.test/api/billing/balance', {
      headers: { 'X-Wallet-Token': wallet_token },
    }), env)
    assert.equal(oldToken.status, 401)

    const token = decodeURIComponent(payload.restore_url.split('#token=')[1] || '')
    const newToken = await balance(new Request('http://worker.test/api/billing/balance', {
      headers: { 'X-Wallet-Token': token },
    }), env)
    assert.equal(newToken.status, 200)
    assert.deepEqual(await newToken.json(), { balance: 10 })
  })

  it('restores by wallet_id when no transaction is given', async () => {
    const db = new MemoryD1()
    const { env, wallet_id } = await createTestWallet(db)
    const restored = await createAdminRestore(
      new Request('http://worker.test/api/admin/restore', {
        method: 'POST',
        headers: adminHeaders(),
        body: JSON.stringify({ wallet_id }),
      }),
      env,
    )
    assert.equal(restored.status, 200)
    const payload = await restored.json() as { restore_url: string }
    assert.ok(payload.restore_url.includes('/restore#token='))
  })
})
