import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createTrainingPlan } from '../src/training.ts'
import type { Env } from '../src/types.ts'
import { MemoryD1 } from './helpers/memoryD1.ts'
import { createWallet } from '../src/billing.ts'

const kv = { async get() { return null }, async put() {}, async delete() {} }

function mockEnv(overrides: Partial<Env> = {}): Env {
  return {
    ALLOWED_ORIGIN: 'http://localhost:5173',
    FRONTEND_URL: 'http://localhost:5173',
    POLAR_SESSIONS: kv as never,
    TRAINING_PLAN_MODE: 'mock',
    ...overrides,
  } as Env
}

function validBody(start = '2026-08-14') {
  return JSON.stringify({
    locale: 'de',
    plan_start_date: start,
    profile: { available_sports: ['running'] },
    metrics: {},
    recent_workouts: [],
  })
}

function planRequest(headers: Record<string, string>, body: string) {
  return new Request('http://worker.test/api/training-plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body,
  })
}

describe('createTrainingPlan HTTP', () => {
  it('requires an idempotency key', async () => {
    const response = await createTrainingPlan(planRequest({}, validBody()), mockEnv())
    assert.equal(response.status, 400)
    assert.match((await response.json() as { detail: string }).detail, /Idempotency/)
  })

  it('rejects invalid JSON and schema payloads', async () => {
    const env = mockEnv()
    const badJson = await createTrainingPlan(
      planRequest({ 'X-Idempotency-Key': 'k1' }, '{not-json'),
      env,
    )
    assert.equal(badJson.status, 400)

    const badSchema = await createTrainingPlan(
      planRequest({ 'X-Idempotency-Key': 'k2' }, JSON.stringify({ plan_start_date: '14-08-2026' })),
      env,
    )
    assert.equal(badSchema.status, 400)
  })

  it('returns a 7-day mock plan without billing', async () => {
    const response = await createTrainingPlan(
      planRequest({ 'X-Idempotency-Key': 'mock-plan-1' }, validBody()),
      mockEnv(),
    )
    assert.equal(response.status, 200)
    const payload = await response.json() as { plan: { days: unknown[]; start_date?: string }; debug?: boolean }
    assert.equal(payload.debug, true)
    assert.equal(payload.plan.days.length, 7)
    assert.equal(payload.plan.start_date, '2026-08-14')
  })

  it('reserves credits when not in local/mock mode and finishes on success', async () => {
    const db = new MemoryD1()
    const env = mockEnv({
      TRAINING_PLAN_MODE: 'gemini',
      GEMINI_API_KEY: undefined,
      DB: db as unknown as D1Database,
    })
    const walletResponse = await createWallet(new Request('http://worker.test/wallet', { method: 'POST' }), env)
    const { wallet_token, wallet_id } = await walletResponse.json() as { wallet_token: string; wallet_id: string }

    const denied = await createTrainingPlan(
      planRequest({ 'X-Idempotency-Key': 'credit-0', 'X-Wallet-Token': wallet_token }, validBody()),
      env,
    )
    assert.equal(denied.status, 402)

    db.credit_ledger.push({
      ledger_id: 'ledger_seed',
      wallet_id,
      amount: 1,
      kind: 'voucher',
      reference_id: 'seed',
      created_at: new Date().toISOString(),
    })

    const ok = await createTrainingPlan(
      planRequest({ 'X-Idempotency-Key': 'credit-1', 'X-Wallet-Token': wallet_token }, validBody()),
      env,
    )
    assert.equal(ok.status, 200)
    const payload = await ok.json() as { plan: { days: unknown[] } }
    assert.equal(payload.plan.days.length, 7)
    assert.equal(db.plan_reservations[0].status, 'plan_generation')
    assert.equal(db.balanceFor(wallet_id), 0)
  })
})
