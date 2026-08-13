import { API_URL } from './api'

const TOKEN_KEY = 'lauftrainer-wallet-token'
const WALLET_ID_KEY = 'lauftrainer-wallet-id'
const BALANCE_KEY = 'lauftrainer-wallet-balance'
const BALANCE_AT_KEY = 'lauftrainer-wallet-balance-at'
export function walletToken() { return localStorage.getItem(TOKEN_KEY) || '' }
export async function ensureWallet() {
  if (walletToken()) return walletToken()
  const response = await fetch(`${API_URL}/billing/wallet`, { method: 'POST' })
  if (!response.ok) throw new Error('Wallet konnte nicht erstellt werden.')
  const data = await response.json() as { wallet_token: string; wallet_id: string }
  localStorage.setItem(TOKEN_KEY, data.wallet_token)
  localStorage.setItem(WALLET_ID_KEY, data.wallet_id)
  return data.wallet_token
}
export function walletId() { return localStorage.getItem(WALLET_ID_KEY) || '' }
export async function getBalance() {
  const token = await ensureWallet()
  const response = await fetch(`${API_URL}/billing/balance`, { headers: { 'X-Wallet-Token': token } })
  if (!response.ok) throw new Error('Guthaben konnte nicht geladen werden.')
  const data = await response.json() as { balance: number }
  localStorage.setItem(BALANCE_KEY, String(data.balance)); localStorage.setItem(BALANCE_AT_KEY, new Date().toISOString())
  return data.balance
}
export function cachedBalance() { return Number(localStorage.getItem(BALANCE_KEY) || 0) }
export function idempotencyKey() { return crypto.randomUUID() }
