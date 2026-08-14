import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  balance,
  createWallet,
  finishReservation,
  paddleWebhook,
  redeemVoucher,
  reserveCredit,
} from '../src/billing.ts'
import type { Env } from '../src/types.ts'
import { MemoryD1, seedVoucher } from './helpers/memoryD1.ts'

const baseEnv = {
  ALLOWED_ORIGIN: 'http://localhost:5173',
  FRONTEND_URL: 'http://localhost:5173',
  POLAR_SESSIONS: { async get() { return null }, async put() {}, async delete() {} },
  PADDLE_WEBHOOK_SECRET: 'whsec_test_secret',
}

function envWithDb(db: MemoryD1): Env {
  return { ...baseEnv, DB: db as unknown as D1Database } as Env
}

async function signPaddle(body: string, secret: string, timestamp = '1700000000') {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}:${body}`))
  const h1 = [...new Uint8Array(mac)].map((v) => v.toString(16).padStart(2, '0')).join('')
  return `ts=${timestamp};h1=${h1}`
}

async function createTestWallet(db: MemoryD1) {
  const env = envWithDb(db)
  const response = await createWallet(new Request('http://worker.test/api/billing/wallet', { method: 'POST' }), env)
  assert.equal(response.status, 201)
  const payload = await response.json() as { wallet_token: string; wallet_id: string; balance: number }
  return { env, ...payload }
}

describe('billing', () => {
  it('creates a wallet and rejects balance without token', async () => {
    const db = new MemoryD1()
    const { env, wallet_token, balance: initial } = await createTestWallet(db)
    assert.equal(initial, 0)
    assert.ok(wallet_token)

    const unauthorized = await balance(new Request('http://worker.test/api/billing/balance'), env)
    assert.equal(unauthorized.status, 401)
  })

  it('redeems vouchers and rejects expired or duplicate codes', async () => {
    const db = new MemoryD1()
    const { env, wallet_token } = await createTestWallet(db)
    await seedVoucher(db, 'GOODCODE', 3, { max: 2 })
    await seedVoucher(db, 'EXPIRED', 5, { expiresAt: '2000-01-01T00:00:00.000Z' })

    const headers = { 'Content-Type': 'application/json', 'X-Wallet-Token': wallet_token }
    const ok = await redeemVoucher(new Request('http://worker.test/api/billing/voucher', { method: 'POST', headers, body: JSON.stringify({ code: 'goodcode' }) }), env)
    assert.equal(ok.status, 200)
    assert.deepEqual(await ok.json(), { balance: 3 })

    const duplicate = await redeemVoucher(new Request('http://worker.test/api/billing/voucher', { method: 'POST', headers, body: JSON.stringify({ code: 'GOODCODE' }) }), env)
    assert.equal(duplicate.status, 409)

    const expired = await redeemVoucher(new Request('http://worker.test/api/billing/voucher', { method: 'POST', headers, body: JSON.stringify({ code: 'EXPIRED' }) }), env)
    assert.equal(expired.status, 400)
  })

  it('reserves credits, replays request ids, and finishes success/failure', async () => {
    const db = new MemoryD1()
    const { env, wallet_token, wallet_id } = await createTestWallet(db)
    db.credit_ledger.push({
      ledger_id: 'ledger_seed',
      wallet_id,
      amount: 2,
      kind: 'voucher',
      reference_id: 'seed',
      created_at: new Date().toISOString(),
    })

    const request = new Request('http://worker.test/api/training-plan', { headers: { 'X-Wallet-Token': wallet_token } })
    const emptyWallet = new MemoryD1()
    const empty = await createTestWallet(emptyWallet)
    const denied = await reserveCredit(new Request('http://worker.test/x', { headers: { 'X-Wallet-Token': empty.wallet_token } }), empty.env, 'req-empty')
    assert.ok(denied.error)
    assert.equal(denied.error.status, 402)

    const first = await reserveCredit(request, env, 'req-1')
    assert.ok(first.reservationId)
    assert.equal(db.balanceFor(wallet_id), 1)

    const replay = await reserveCredit(request, env, 'req-1')
    assert.equal(replay.reservationId, null)
    assert.ok(replay.replay)

    await finishReservation(env, first.reservationId!, { ok: true }, true)
    assert.equal(db.plan_reservations[0].status, 'plan_generation')
    assert.equal(db.balanceFor(wallet_id), 1)

    const second = await reserveCredit(request, env, 'req-2')
    assert.ok(second.reservationId)
    await finishReservation(env, second.reservationId!, null, false)
    assert.equal(db.plan_reservations[1].status, 'released')
    assert.equal(db.balanceFor(wallet_id), 1)
  })

  it('verifies paddle webhook signatures and credits wallets idempotently', async () => {
    const db = new MemoryD1()
    const { env, wallet_id } = await createTestWallet(db)
    const body = JSON.stringify({
      event_id: 'evt_1',
      event_type: 'transaction.completed',
      data: { id: 'txn_1', custom_data: { wallet_id, credits: 10 } },
    })

    const bad = await paddleWebhook(
      new Request('http://worker.test/api/billing/webhook', {
        method: 'POST',
        headers: { 'Paddle-Signature': 'ts=1;h1=00' },
        body,
      }),
      env,
    )
    assert.equal(bad.status, 401)

    const signature = await signPaddle(body, env.PADDLE_WEBHOOK_SECRET!)
    const ok = await paddleWebhook(
      new Request('http://worker.test/api/billing/webhook', {
        method: 'POST',
        headers: { 'Paddle-Signature': signature },
        body,
      }),
      env,
    )
    assert.equal(ok.status, 200)
    assert.equal(db.balanceFor(wallet_id), 10)

    const dupSignature = await signPaddle(body, env.PADDLE_WEBHOOK_SECRET!)
    const dup = await paddleWebhook(
      new Request('http://worker.test/api/billing/webhook', {
        method: 'POST',
        headers: { 'Paddle-Signature': dupSignature },
        body,
      }),
      env,
    )
    assert.equal(dup.status, 200)
    assert.equal(db.balanceFor(wallet_id), 10)
    assert.equal(db.paddle_events.length, 1)

    const ignoredBody = JSON.stringify({
      event_id: 'evt_2',
      event_type: 'transaction.updated',
      data: { id: 'txn_2', custom_data: { wallet_id, credits: 5 } },
    })
    const ignoredSig = await signPaddle(ignoredBody, env.PADDLE_WEBHOOK_SECRET!)
    const ignored = await paddleWebhook(
      new Request('http://worker.test/api/billing/webhook', {
        method: 'POST',
        headers: { 'Paddle-Signature': ignoredSig },
        body: ignoredBody,
      }),
      env,
    )
    assert.equal(ignored.status, 200)
    assert.equal(db.balanceFor(wallet_id), 10)
  })
})
