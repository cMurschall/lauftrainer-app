import { json } from './http'
import type { Env } from './types'

const RESERVATION_MINUTES = 5
const encoder = new TextEncoder()

export function id(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`
}
export async function digest(value: string) {
  const hash = await crypto.subtle.digest('SHA-256', encoder.encode(value))
  return [...new Uint8Array(hash)].map((v) => v.toString(16).padStart(2, '0')).join('')
}
export function token() {
  return crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '')
}
function db(env: Env): D1Database | null {
  return env.DB || null
}
export async function walletBalance(database: D1Database, walletId: string) {
  const row = await database
    .prepare(
      "SELECT COALESCE((SELECT SUM(amount) FROM credit_ledger WHERE wallet_id = ?) - (SELECT COALESCE(SUM(amount),0) FROM plan_reservations WHERE wallet_id = ? AND status = 'pending_plan_generation'), 0) AS balance",
    )
    .bind(walletId, walletId)
    .first<{ balance: number }>()
  return Math.max(0, row?.balance || 0)
}
function walletToken(request: Request) {
  return request.headers.get('X-Wallet-Token') || ''
}
async function wallet(request: Request, env: Env) {
  const database = db(env)
  const raw = walletToken(request)
  if (!database || !raw) return null
  return database
    .prepare('SELECT * FROM wallets WHERE token_hash = ?')
    .bind(await digest(raw))
    .first<{ wallet_id: string }>()
}
async function cleanup(env: Env) {
  const database = db(env)
  if (!database) return
  await database
    .prepare(
      "UPDATE plan_reservations SET status = 'released', completed_at = ? WHERE status = 'pending_plan_generation' AND expires_at <= ?",
    )
    .bind(new Date().toISOString(), new Date().toISOString())
    .run()
}
function welcomeCredits(env: Env) {
  const parsed = Number.parseInt(String(env.WELCOME_CREDITS ?? '0'), 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return 0
  return Math.min(parsed, 100)
}

export async function createWallet(request: Request, env: Env) {
  const database = db(env)
  if (!database) return json({ detail: 'Billing ist nicht konfiguriert.' }, 503, request, env)
  const raw = token(),
    now = new Date().toISOString(),
    walletId = id('wallet')
  const grant = welcomeCredits(env)
  const statements = [
    database
      .prepare('INSERT INTO wallets(wallet_id, token_hash, created_at, updated_at) VALUES(?,?,?,?)')
      .bind(walletId, await digest(raw), now, now),
  ]
  if (grant > 0) {
    statements.push(
      database
        .prepare(
          'INSERT INTO credit_ledger(ledger_id,wallet_id,amount,kind,reference_id,created_at) VALUES(?,?,?,?,?,?)',
        )
        .bind(id('ledger'), walletId, grant, 'welcome', walletId, now),
    )
  }
  await database.batch(statements)
  return json({ wallet_token: raw, wallet_id: walletId, balance: grant }, 201, request, env)
}
export async function balance(request: Request, env: Env) {
  const database = db(env)
  const found = await wallet(request, env)
  await cleanup(env)
  if (!database) return json({ detail: 'Billing ist nicht konfiguriert.' }, 503, request, env)
  if (!found) return json({ detail: 'Wallet-Token fehlt oder ist ungültig.' }, 401, request, env)
  const row = await database
    .prepare(
      "SELECT COALESCE((SELECT SUM(amount) FROM credit_ledger WHERE wallet_id = ?) - (SELECT COALESCE(SUM(amount),0) FROM plan_reservations WHERE wallet_id = ? AND status = 'pending_plan_generation'), 0) AS balance",
    )
    .bind(found.wallet_id, found.wallet_id)
    .first<{ balance: number }>()
  return json({ balance: Math.max(0, row?.balance || 0) }, 200, request, env)
}
export async function redeemVoucher(request: Request, env: Env) {
  const database = db(env)
  const found = await wallet(request, env)
  if (!database) return json({ detail: 'Billing ist nicht konfiguriert.' }, 503, request, env)
  if (!found) return json({ detail: 'Wallet-Token fehlt oder ist ungültig.' }, 401, request, env)
  const body = (await request.json().catch(() => null)) as { code?: string } | null
  const code = body?.code?.trim().toUpperCase()
  if (!code) return json({ detail: 'Gutschein-Code fehlt.' }, 400, request, env)
  const codeHash = await digest(code),
    voucher = await database
      .prepare('SELECT * FROM vouchers WHERE code_hash = ?')
      .bind(codeHash)
      .first<{ amount: number; expires_at: string | null; max_redemptions: number; redeemed_count: number }>()
  if (
    !voucher ||
    (voucher.expires_at && voucher.expires_at <= new Date().toISOString()) ||
    voucher.redeemed_count >= voucher.max_redemptions
  )
    return json({ detail: 'Gutschein ist ungültig oder aufgebraucht.' }, 400, request, env)
  const redemption = await database
    .prepare('SELECT 1 FROM voucher_redemptions WHERE code_hash = ? AND wallet_id = ?')
    .bind(codeHash, found.wallet_id)
    .first()
  if (redemption) return json({ detail: 'Gutschein wurde bereits eingelöst.' }, 409, request, env)
  const now = new Date().toISOString()
  await database.batch([
    database
      .prepare('INSERT INTO voucher_redemptions(code_hash,wallet_id,created_at) VALUES(?,?,?)')
      .bind(codeHash, found.wallet_id, now),
    database
      .prepare(
        'UPDATE vouchers SET redeemed_count = redeemed_count + 1 WHERE code_hash = ? AND redeemed_count < max_redemptions',
      )
      .bind(codeHash),
    database
      .prepare('INSERT INTO credit_ledger(ledger_id,wallet_id,amount,kind,reference_id,created_at) VALUES(?,?,?,?,?,?)')
      .bind(id('ledger'), found.wallet_id, voucher.amount, 'voucher', `${codeHash}:${found.wallet_id}`, now),
  ])
  return balance(request, env)
}
export async function createCheckoutInternal(request: Request, env: Env) {
  const found = await wallet(request, env)
  if (!env.PADDLE_API_KEY) return json({ detail: 'Paddle ist nicht konfiguriert.' }, 503, request, env)
  if (!found) return json({ detail: 'Wallet-Token fehlt oder ist ungültig.' }, 401, request, env)
  const body = (await request.json().catch(() => null)) as { package?: 'basic' | 'plus' | 'pro' } | null
  const credits = body?.package === 'pro' ? 30 : body?.package === 'plus' ? 10 : 3
  const priceId =
    body?.package === 'pro'
      ? env.PADDLE_PRICE_PRO
      : body?.package === 'plus'
        ? env.PADDLE_PRICE_PLUS
        : env.PADDLE_PRICE_BASIC
  if (!priceId) return json({ detail: 'Credit-Paket ist nicht konfiguriert.' }, 400, request, env)
  const response = await fetch(
    `${env.PADDLE_ENVIRONMENT === 'sandbox' ? 'https://sandbox-api.paddle.com' : 'https://api.paddle.com'}/transactions`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.PADDLE_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [{ price_id: priceId, quantity: 1 }],
        custom_data: { wallet_id: found.wallet_id, credits },
      }),
    },
  )
  if (!response.ok) return json({ detail: 'Paddle-Checkout konnte nicht erstellt werden.' }, 502, request, env)
  const result = (await response.json()) as { data?: { id?: string; checkout?: { url?: string } } }
  return json({ transaction_id: result.data?.id, checkout_url: result.data?.checkout?.url }, 200, request, env)
}
export async function createCheckout(request: Request, env: Env) {
  const found = await wallet(request, env)
  if (!env.PADDLE_API_KEY) return json({ detail: 'Paddle ist nicht konfiguriert.' }, 503, request, env)
  if (!found) return json({ detail: 'Wallet-Token fehlt oder ist ungültig.' }, 401, request, env)
  const body = (await request.json().catch(() => null)) as { package?: 'basic' | 'plus' | 'pro' } | null
  const credits = body?.package === 'pro' ? 30 : body?.package === 'plus' ? 10 : 3
  const priceId =
    body?.package === 'pro'
      ? env.PADDLE_PRICE_PRO
      : body?.package === 'plus'
        ? env.PADDLE_PRICE_PLUS
        : env.PADDLE_PRICE_BASIC
  if (!priceId) return json({ detail: 'Credit-Paket ist nicht konfiguriert.' }, 400, request, env)
  const response = await fetch(
    `${env.PADDLE_ENVIRONMENT === 'sandbox' ? 'https://sandbox-api.paddle.com' : 'https://api.paddle.com'}/transactions`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.PADDLE_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [{ price_id: priceId, quantity: 1 }],
        custom_data: { wallet_id: found.wallet_id, credits },
      }),
    },
  )
  if (!response.ok) return json({ detail: 'Paddle-Checkout konnte nicht erstellt werden.' }, 502, request, env)
  const result = (await response.json()) as { data?: { id?: string; checkout?: { url?: string } } }
  return json({ transaction_id: result.data?.id, checkout_url: result.data?.checkout?.url }, 200, request, env)
}
export async function reserveCredit(request: Request, env: Env, requestId: string) {
  const database = db(env)
  const found = await wallet(request, env)
  await cleanup(env)
  if (!database) return { error: json({ detail: 'Billing ist nicht konfiguriert.' }, 503, request, env) }
  if (!found) return { error: json({ detail: 'Wallet-Token fehlt oder ist ungültig.' }, 401, request, env) }
  const existing = await database
    .prepare('SELECT * FROM plan_reservations WHERE request_id = ?')
    .bind(requestId)
    .first<{ status: string; result_json: string | null }>()
  if (existing) return { walletId: found.wallet_id, reservationId: null, replay: existing }
  const row = await database
    .prepare(
      "SELECT COALESCE((SELECT SUM(amount) FROM credit_ledger WHERE wallet_id = ?) - (SELECT COALESCE(SUM(amount),0) FROM plan_reservations WHERE wallet_id = ? AND status = 'pending_plan_generation'), 0) AS balance",
    )
    .bind(found.wallet_id, found.wallet_id)
    .first<{ balance: number }>()
  if ((row?.balance || 0) < 1) return { error: json({ detail: 'Nicht genügend Credits.' }, 402, request, env) }
  const now = new Date(),
    reservationId = id('reservation')
  const inserted = await database
    .prepare(
      "INSERT INTO plan_reservations(reservation_id,wallet_id,status,amount,created_at,expires_at,request_id) SELECT ?,?,'pending_plan_generation',1,?,?,? WHERE (SELECT COALESCE(SUM(amount),0) FROM credit_ledger WHERE wallet_id=?) - (SELECT COALESCE(SUM(amount),0) FROM plan_reservations WHERE wallet_id=? AND status='pending_plan_generation') >= 1",
    )
    .bind(
      reservationId,
      found.wallet_id,
      now.toISOString(),
      new Date(now.getTime() + RESERVATION_MINUTES * 60000).toISOString(),
      requestId,
      found.wallet_id,
      found.wallet_id,
    )
    .run()
  if (!inserted.meta.changes) return { error: json({ detail: 'Nicht genügend Credits.' }, 402, request, env) }
  return { walletId: found.wallet_id, reservationId }
}
export async function finishReservation(env: Env, reservationId: string, plan: unknown, success: boolean) {
  if (!env.DB) return
  if (success)
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE plan_reservations SET status='plan_generation', completed_at=?, result_json=? WHERE reservation_id=? AND status='pending_plan_generation'",
      ).bind(new Date().toISOString(), JSON.stringify(plan), reservationId),
      env.DB.prepare(
        "INSERT INTO credit_ledger(ledger_id,wallet_id,amount,kind,reference_id,created_at) SELECT ?,wallet_id,-amount,'plan_generation',reservation_id,? FROM plan_reservations WHERE reservation_id=?",
      ).bind(id('ledger'), new Date().toISOString(), reservationId),
    ])
  else
    await env.DB.prepare(
      "UPDATE plan_reservations SET status='released', completed_at=? WHERE reservation_id=? AND status='pending_plan_generation'",
    )
      .bind(new Date().toISOString(), reservationId)
      .run()
}
export async function paddleWebhook(request: Request, env: Env) {
  if (!env.DB || !env.PADDLE_WEBHOOK_SECRET)
    return json({ detail: 'Webhook ist nicht konfiguriert.' }, 503, request, env)
  const raw = await request.text(),
    signature = request.headers.get('Paddle-Signature') || ''
  const timestamp = signature.match(/ts=([^;]+)/)?.[1],
    h1 = signature.match(/h1=([^;]+)/)?.[1]
  if (!timestamp || !h1 || !(await verifyHmac(`${timestamp}:${raw}`, env.PADDLE_WEBHOOK_SECRET, h1)))
    return json({ detail: 'Ungültige Webhook-Signatur.' }, 401, request, env)
  const event = JSON.parse(raw) as {
    event_id?: string
    event_type?: string
    data?: {
      id?: string
      custom_data?: { wallet_id?: string; credits?: number }
      items?: Array<{ price?: { custom_data?: { credits?: number } } }>
    }
  }
  if (
    !event.event_id ||
    !event.data?.custom_data?.wallet_id ||
    !['transaction.paid', 'transaction.completed'].includes(event.event_type || '')
  )
    return json({ received: true }, 200, request, env)
  const amount = Number(
    (event.data.custom_data as Record<string, unknown> | undefined)?.credits ||
      event.data.items?.[0]?.price?.custom_data?.credits ||
      0,
  )
  if (!amount) return json({ received: true }, 200, request, env)
  const now = new Date().toISOString()
  try {
    await env.DB.batch([
      env.DB.prepare(
        'INSERT INTO paddle_events(event_id,transaction_id,wallet_id,amount,created_at) VALUES(?,?,?,?,?)',
      ).bind(event.event_id, event.data.id || null, event.data.custom_data.wallet_id, amount, now),
      env.DB.prepare(
        'INSERT INTO credit_ledger(ledger_id,wallet_id,amount,kind,reference_id,created_at) VALUES(?,?,?,?,?,?)',
      ).bind(id('ledger'), event.data.custom_data.wallet_id, amount, 'paddle', event.data.id || event.event_id, now),
    ])
  } catch (error) {
    if (!String(error).toLowerCase().includes('unique')) throw error
  }
  return json({ received: true }, 200, request, env)
}
async function verifyHmac(message: string, secret: string, expected: string) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'verify',
  ])
  const bytes = Uint8Array.from(expected.match(/.{2}/g) || [], (v) => parseInt(v, 16))
  return crypto.subtle.verify('HMAC', key, bytes, encoder.encode(message))
}
export async function cleanupReservations(env: Env) {
  await cleanup(env)
}
