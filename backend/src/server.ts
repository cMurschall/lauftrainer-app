import packageJson from '../package.json'
import { corsHeaders, json } from './http'
import { callback, connect, status, sync } from './polar'
import * as strava from './strava'
import { disconnect, listStatus, syncAll } from './connectors'
import { createTrainingPlan } from './training'
import type { Env } from './types'
import { balance, createCheckout, createWallet, paddleWebhook, redeemVoucher, cleanupReservations } from './billing'
import { adminPage, createAdminRestore, createAdminVoucher } from './admin'
import { mapContext } from './maps'

export default {
  async fetch(request: Request, env: Env, ctx: { waitUntil(promise: Promise<any>): void }): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request, env) })
    const path = new URL(request.url).pathname
    try {
      if (request.method === 'GET' && path === '/health') return json({ status: 'ok', version: packageJson.version, commit: env.COMMIT_SHA || '' }, 200, request, env)
      if (request.method === 'GET' && path === '/admin') return await adminPage(request, env)
      if (request.method === 'POST' && path === '/api/admin/vouchers') return await createAdminVoucher(request, env)
      if (request.method === 'POST' && path === '/api/admin/restore') return await createAdminRestore(request, env)
      if (request.method === 'GET' && path === '/api/polar/connect') return await connect(request, env)
      if (request.method === 'GET' && path === '/api/polar/callback') return await callback(request, env)
      if (request.method === 'GET' && path === '/api/polar/status') return await status(request, env)
      if (request.method === 'POST' && path === '/api/polar/sync') return await sync(request, env)
      if (request.method === 'GET' && path === '/api/connectors/status') return await listStatus(request, env)
      if (request.method === 'GET' && path === '/api/connectors/polar/connect') return await connect(request, env)
      if (request.method === 'GET' && path === '/api/connectors/polar/callback') return await callback(request, env)
      if (request.method === 'GET' && path === '/api/connectors/strava/connect') return await strava.connect(request, env)
      if (request.method === 'GET' && path === '/api/connectors/strava/callback') return await strava.callback(request, env)
      if (request.method === 'POST' && path === '/api/connectors/sync') return await syncAll(request, env)
      const disconnectMatch = path.match(/^\/api\/connectors\/(polar|strava)\/disconnect$/)
      if (request.method === 'POST' && disconnectMatch) return await disconnect(request, env, disconnectMatch[1])
      if (request.method === 'POST' && path === '/api/training-plan') return await createTrainingPlan(request, env)
      if (request.method === 'POST' && path === '/api/billing/wallet') return await createWallet(request, env)
      if (request.method === 'GET' && path === '/api/billing/balance') return await balance(request, env)
      if (request.method === 'POST' && path === '/api/billing/checkout') return await createCheckout(request, env)
      if (request.method === 'POST' && path === '/api/billing/voucher/redeem') return await redeemVoucher(request, env)
      if (request.method === 'POST' && path === '/api/billing/webhook') return await paddleWebhook(request, env)
      if (request.method === 'GET' && path === '/api/maps/context') return await mapContext(request, env, ctx)
      if (request.method === 'GET' && path === '/api/billing/region') {
        const country = request.headers.get('CF-IPCountry') || request.headers.get('x-vercel-ip-country')
        return json({ country: country && /^[A-Z]{2}$/.test(country.toUpperCase()) ? country.toUpperCase() : null }, 200, request, env)
      }
      return json({ detail: 'Not found' }, 404, request, env)
    } catch (error) {
      console.error('Worker error:', error)
      const detail = env.TRAINING_PLAN_MODE === 'local' && error instanceof Error
        ? `Lokaler KI-Fehler: ${error.message}`
        : path.startsWith('/api/polar/')
          ? 'Polar-OAuth konnte nicht verarbeitet werden.'
          : 'KI-Aufruf konnte nicht verarbeitet werden.'
      return json({ detail }, 502, request, env)
    }
  },
  async scheduled(_event: ScheduledEvent, env: Env) { await cleanupReservations(env) }
}
