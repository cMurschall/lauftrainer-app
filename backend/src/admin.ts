import { corsHeaders, json } from './http'
import { digest, token, walletBalance } from './billing'
import type { Env } from './types'

function unauthorized(request: Request, env: Env) {
  return json({ detail: 'Admin-Zugriff verweigert.' }, 401, request, env)
}

export function isAdminAuthorized(request: Request, env: Env) {
  if (request.headers.get('Cf-Access-Jwt-Assertion')) return true
  const secret = env.ADMIN_SECRET?.trim()
  if (secret && request.headers.get('X-Admin-Secret') === secret) return true
  return false
}

function requireAdmin(request: Request, env: Env) {
  if (!isAdminAuthorized(request, env)) return unauthorized(request, env)
  return null
}

function randomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(10))
  let code = 'BETA-'
  for (let i = 0; i < bytes.length; i++) {
    if (i === 5) code += '-'
    code += alphabet[bytes[i] % alphabet.length]
  }
  return code
}

/** HTML is edge-protected by Cloudflare Access; APIs enforce JWT or ADMIN_SECRET. */
export async function adminPage(request: Request, env: Env) {
  return new Response(ADMIN_HTML, {
    status: 200,
    headers: {
      ...corsHeaders(request, env),
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}

export async function createAdminVoucher(request: Request, env: Env) {
  const denied = requireAdmin(request, env)
  if (denied) return denied
  if (!env.DB) return json({ detail: 'Billing ist nicht konfiguriert.' }, 503, request, env)

  const body = (await request.json().catch(() => null)) as {
    amount?: number
    max_redemptions?: number
    expires_at?: string | null
    code?: string
  } | null

  const amount = Number(body?.amount)
  const maxRedemptions = Number(body?.max_redemptions ?? 1)
  if (!Number.isInteger(amount) || amount < 1)
    return json({ detail: 'amount muss eine positive Ganzzahl sein.' }, 400, request, env)
  if (!Number.isInteger(maxRedemptions) || maxRedemptions < 1)
    return json({ detail: 'max_redemptions muss eine positive Ganzzahl sein.' }, 400, request, env)

  const code = (body?.code?.trim() || randomCode()).toUpperCase()
  if (!/^[A-Z0-9-]{4,64}$/.test(code)) return json({ detail: 'Code-Format ungültig.' }, 400, request, env)

  const expiresAt = body?.expires_at?.trim() || null
  if (expiresAt && Number.isNaN(Date.parse(expiresAt)))
    return json({ detail: 'expires_at ist ungültig.' }, 400, request, env)

  const codeHash = await digest(code)
  try {
    await env.DB.prepare(
      'INSERT INTO vouchers(code_hash, amount, expires_at, max_redemptions, redeemed_count) VALUES(?,?,?,?,0)',
    )
      .bind(codeHash, amount, expiresAt, maxRedemptions)
      .run()
  } catch (error) {
    if (String(error).toLowerCase().includes('unique'))
      return json({ detail: 'Code existiert bereits.' }, 409, request, env)
    throw error
  }

  return json({ code, amount, max_redemptions: maxRedemptions, expires_at: expiresAt }, 201, request, env)
}

export async function createAdminRestore(request: Request, env: Env) {
  const denied = requireAdmin(request, env)
  if (denied) return denied
  if (!env.DB) return json({ detail: 'Billing ist nicht konfiguriert.' }, 503, request, env)

  const body = (await request.json().catch(() => null)) as { transaction_id?: string; wallet_id?: string } | null
  const transactionId = body?.transaction_id?.trim() || ''
  let walletId = body?.wallet_id?.trim() || ''

  if (!transactionId && !walletId)
    return json({ detail: 'transaction_id oder wallet_id erforderlich.' }, 400, request, env)

  if (transactionId) {
    const event = await env.DB.prepare('SELECT wallet_id FROM paddle_events WHERE transaction_id = ?')
      .bind(transactionId)
      .first<{ wallet_id: string }>()
    if (!event) return json({ detail: 'Transaktion nicht gefunden.' }, 404, request, env)
    if (walletId && walletId !== event.wallet_id)
      return json({ detail: 'wallet_id passt nicht zur Transaktion.' }, 400, request, env)
    walletId = event.wallet_id
  }

  const wallet = await env.DB.prepare('SELECT wallet_id FROM wallets WHERE wallet_id = ?')
    .bind(walletId)
    .first<{ wallet_id: string }>()
  if (!wallet) return json({ detail: 'Wallet nicht gefunden.' }, 404, request, env)

  const raw = token()
  const now = new Date().toISOString()
  await env.DB.prepare('UPDATE wallets SET token_hash = ?, updated_at = ? WHERE wallet_id = ?')
    .bind(await digest(raw), now, walletId)
    .run()

  const frontend = (env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '')
  const balance = await walletBalance(env.DB, walletId)
  return json(
    {
      wallet_id: walletId,
      balance,
      restore_url: `${frontend}/restore#token=${encodeURIComponent(raw)}`,
    },
    200,
    request,
    env,
  )
}

const ADMIN_HTML = `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>LaufTrainer Admin</title>
  <style>
    :root { color-scheme: dark; font-family: ui-sans-serif, system-ui, sans-serif; }
    body { margin: 0; background: #0D1117; color: #F0F6FC; }
    main { max-width: 640px; margin: 0 auto; padding: 1.5rem; }
    h1 { font-size: 1.25rem; margin: 0 0 1rem; }
    h2 { font-size: 0.95rem; letter-spacing: 0.04em; text-transform: uppercase; color: #8B949E; margin: 1.5rem 0 0.75rem; }
    section { background: #161B22; border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; padding: 1rem; }
    label { display: block; font-size: 0.8rem; color: #8B949E; margin: 0.75rem 0 0.25rem; }
    input { width: 100%; box-sizing: border-box; background: #0D1117; border: 1px solid rgba(255,255,255,0.12); color: #F0F6FC; border-radius: 8px; padding: 0.55rem 0.7rem; }
    button { margin-top: 1rem; background: #10B981; color: #04120c; border: 0; border-radius: 8px; padding: 0.6rem 0.9rem; font-weight: 600; cursor: pointer; }
    button:disabled { opacity: 0.5; cursor: wait; }
    pre { white-space: pre-wrap; word-break: break-all; background: #0D1117; border-radius: 8px; padding: 0.75rem; font-size: 0.85rem; border: 1px solid rgba(255,255,255,0.08); }
    .muted { color: #8B949E; font-size: 0.85rem; }
    .error { color: #f87171; }
    .ok { color: #34d399; }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
    @media (max-width: 560px) { .row { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <main>
    <h1>LaufTrainer Admin</h1>
    <p class="muted">Geschützt über Cloudflare Access oder <code>X-Admin-Secret</code> (lokal).</p>

    <h2>Auth (lokal)</h2>
    <section>
      <label for="secret">Admin-Secret</label>
      <input id="secret" type="password" autocomplete="off" placeholder="Nur für lokales Dev nötig" />
    </section>

    <h2>Voucher erstellen</h2>
    <section>
      <form id="voucher-form">
        <div class="row">
          <div>
            <label for="amount">Credits</label>
            <input id="amount" name="amount" type="number" min="1" step="1" value="10" required />
          </div>
          <div>
            <label for="max">Max. Einlösungen</label>
            <input id="max" name="max" type="number" min="1" step="1" value="1" required />
          </div>
        </div>
        <label for="expires">Ablauf (ISO, optional)</label>
        <input id="expires" name="expires" type="text" placeholder="2026-12-31T23:59:59.000Z" />
        <label for="code">Eigener Code (optional)</label>
        <input id="code" name="code" type="text" placeholder="BETA-XXXXX-XXXXX" />
        <button type="submit">Voucher anlegen</button>
      </form>
      <pre id="voucher-out" hidden></pre>
    </section>

    <h2>Wallet-Restore</h2>
    <section>
      <form id="restore-form">
        <label for="txn">Paddle Transaction ID</label>
        <input id="txn" name="txn" type="text" placeholder="txn_..." />
        <label for="wallet">oder Wallet ID</label>
        <input id="wallet" name="wallet" type="text" placeholder="wallet_..." />
        <button type="submit">Restore-Link erzeugen</button>
      </form>
      <pre id="restore-out" hidden></pre>
    </section>
  </main>
  <script>
    const secretInput = document.getElementById('secret')
    secretInput.value = sessionStorage.getItem('adminSecret') || ''
    secretInput.addEventListener('change', () => sessionStorage.setItem('adminSecret', secretInput.value))

    function headers() {
      const h = { 'Content-Type': 'application/json' }
      if (secretInput.value) h['X-Admin-Secret'] = secretInput.value
      return h
    }

    async function post(path, body, out) {
      out.hidden = false
      out.className = ''
      out.textContent = '…'
      try {
        const res = await fetch(path, { method: 'POST', headers: headers(), body: JSON.stringify(body) })
        const data = await res.json()
        out.className = res.ok ? 'ok' : 'error'
        out.textContent = JSON.stringify(data, null, 2)
      } catch (err) {
        out.className = 'error'
        out.textContent = String(err)
      }
    }

    document.getElementById('voucher-form').addEventListener('submit', (e) => {
      e.preventDefault()
      const expires = document.getElementById('expires').value.trim()
      const code = document.getElementById('code').value.trim()
      post('/api/admin/vouchers', {
        amount: Number(document.getElementById('amount').value),
        max_redemptions: Number(document.getElementById('max').value),
        expires_at: expires || null,
        ...(code ? { code } : {}),
      }, document.getElementById('voucher-out'))
    })

    document.getElementById('restore-form').addEventListener('submit', (e) => {
      e.preventDefault()
      const transaction_id = document.getElementById('txn').value.trim()
      const wallet_id = document.getElementById('wallet').value.trim()
      post('/api/admin/restore', {
        ...(transaction_id ? { transaction_id } : {}),
        ...(wallet_id ? { wallet_id } : {}),
      }, document.getElementById('restore-out'))
    })
  </script>
</body>
</html>
`
