import { initializePaddle, type Paddle, type PricePreviewResponse } from '@paddle/paddle-js'
import { API_URL } from './api'
import { walletId } from './billingService'

export interface Tier {
  name: 'Starter'
  description: string
  features: string[]
  priceId: string
}

export const tiers: Tier[] = [
  { name: 'Starter', description: '10 Credits für die persönliche Trainingsplanung.', features: ['10 KI-Trainingspläne', 'Lokale Trainingsanalyse', 'Einmaliger Kauf, kein Abo'], priceId: import.meta.env.VITE_PADDLE_STARTER_PRICE },
]

const environment = import.meta.env.VITE_PADDLE_ENVIRONMENT as 'sandbox' | 'production' | undefined
const token = import.meta.env.VITE_PADDLE_CLIENT_TOKEN

function requireConfig() {
  const configured: Array<[string, string | undefined]> = [
    ['VITE_PADDLE_ENVIRONMENT', environment],
    ['VITE_PADDLE_CLIENT_TOKEN', token],
    ['VITE_PADDLE_STARTER_PRICE', tiers[0].priceId],
  ]
  const missing = [...configured].filter(([, value]) => !value).map(([name]) => name)
  if (missing.length) throw new Error(`Paddle-Konfiguration fehlt: ${missing.join(', ')}`)
  if (environment !== 'sandbox' && environment !== 'production') {
    throw new Error('VITE_PADDLE_ENVIRONMENT muss sandbox oder production sein.')
  }
}

let paddlePromise: Promise<Paddle | undefined> | undefined
async function getPaddle() {
  requireConfig()
  paddlePromise ||= initializePaddle({ environment: environment!, token })
  const instance = await paddlePromise
  if (!instance) throw new Error('Paddle.js konnte nicht initialisiert werden.')
  return instance
}

export async function detectCountry() {
  const response = await fetch(`${API_URL}/billing/region`)
  if (!response.ok) return undefined
  const data = await response.json() as { country?: string | null }
  return data.country || undefined
}

export async function previewTier(tier: Tier, country?: string): Promise<PricePreviewResponse> {
  const paddle = await getPaddle()
  return paddle.PricePreview({ items: [{ priceId: tier.priceId, quantity: 1 }], ...(country ? { address: { countryCode: country } } : {}) })
}

export async function openTierCheckout(tier: Tier, email?: string) {
  const paddle = await getPaddle()
  paddle.Checkout.open({
    items: [{ priceId: tier.priceId, quantity: 1 }],
    ...(email ? { customer: { email } } : {}),
    customData: { wallet_id: walletId(), credits: 10 },
    settings: { displayMode: 'overlay', variant: 'one-page', successUrl: `${window.location.origin}/welcome` },
  })
}
