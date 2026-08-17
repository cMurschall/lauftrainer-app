import { API_URL } from './api'

/** Wallet identity lives in localStorage — never IndexedDB — so clearing athlete data does not mint a new wallet. */
const TOKEN_KEY = 'lauftrainer-wallet-token'
const WALLET_ID_KEY = 'lauftrainer-wallet-id'
const CREATED_KEY = 'lauftrainer-wallet-created'
const BALANCE_KEY = 'lauftrainer-wallet-balance'
const BALANCE_AT_KEY = 'lauftrainer-wallet-balance-at'

function cacheBalance(balance: number) {
  localStorage.setItem(BALANCE_KEY, String(balance))
  localStorage.setItem(BALANCE_AT_KEY, new Date().toISOString())
}

export function walletToken() {
  return localStorage.getItem(TOKEN_KEY) || ''
}

export async function ensureWallet() {
  if (walletToken()) return walletToken()
  // Marker survives partial clears of token keys and blocks a second welcome grant on this device.
  if (localStorage.getItem(CREATED_KEY) === '1') {
    throw new Error('Wallet auf diesem Gerät bereits angelegt. Bitte Wiederherstellungslink nutzen.')
  }
  const response = await fetch(`${API_URL}/billing/wallet`, { method: 'POST' })
  if (!response.ok) throw new Error('Wallet konnte nicht erstellt werden.')
  const data = (await response.json()) as { wallet_token: string; wallet_id: string; balance?: number }
  localStorage.setItem(TOKEN_KEY, data.wallet_token)
  localStorage.setItem(WALLET_ID_KEY, data.wallet_id)
  localStorage.setItem(CREATED_KEY, '1')
  if (typeof data.balance === 'number') cacheBalance(data.balance)
  return data.wallet_token
}

export function walletId() {
  return localStorage.getItem(WALLET_ID_KEY) || ''
}

export async function getBalance() {
  const token = await ensureWallet()
  const response = await fetch(`${API_URL}/billing/balance`, { headers: { 'X-Wallet-Token': token } })
  if (!response.ok) throw new Error('Guthaben konnte nicht geladen werden.')
  const data = (await response.json()) as { balance: number }
  cacheBalance(data.balance)
  return data.balance
}

export function cachedBalance() {
  return Number(localStorage.getItem(BALANCE_KEY) || 0)
}
export function idempotencyKey() {
  return crypto.randomUUID()
}

export async function redeemVoucher(code: string) {
  const token = await ensureWallet()
  const response = await fetch(`${API_URL}/billing/voucher/redeem`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Wallet-Token': token },
    body: JSON.stringify({ code: code.trim() }),
  })
  const data = (await response.json().catch(() => null)) as { balance?: number; detail?: string } | null
  if (!response.ok) throw new Error(data?.detail || 'Gutschein konnte nicht eingelöst werden.')
  const balance = Number(data?.balance ?? 0)
  cacheBalance(balance)
  return balance
}

/** Apply a rotated wallet token from a restore link (replaces any previous token on this device). */
export async function applyWalletToken(rawToken: string) {
  const token = rawToken.trim()
  if (!token) throw new Error('Wallet-Token fehlt.')
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.removeItem(WALLET_ID_KEY)
  const response = await fetch(`${API_URL}/billing/balance`, { headers: { 'X-Wallet-Token': token } })
  const data = (await response.json().catch(() => null)) as { balance?: number; detail?: string } | null
  if (!response.ok) {
    localStorage.removeItem(TOKEN_KEY)
    throw new Error(data?.detail || 'Wiederherstellung fehlgeschlagen.')
  }
  localStorage.setItem(CREATED_KEY, '1')
  const balance = Number(data?.balance ?? 0)
  cacheBalance(balance)
  return balance
}
