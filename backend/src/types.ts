export interface Env {
  COMMIT_SHA?: string
  GEMINI_API_KEY?: string
  GEMINI_MODEL?: string
  ALLOWED_ORIGIN?: string
  FRONTEND_URL?: string
  POLAR_CLIENT_ID?: string
  POLAR_CLIENT_SECRET?: string
  POLAR_REDIRECT_URI?: string
  STRAVA_CLIENT_ID?: string
  STRAVA_CLIENT_SECRET?: string
  STRAVA_REFRESH_TOKEN?: string
  STRAVA_REDIRECT_URI?: string
  POLAR_SESSIONS: KVNamespace
  DB?: D1Database
  PADDLE_API_KEY?: string
  PADDLE_WEBHOOK_SECRET?: string
  PADDLE_ENVIRONMENT?: 'sandbox' | 'production'
  PADDLE_PRICE_BASIC?: string
  PADDLE_PRICE_PLUS?: string
  PADDLE_PRICE_PRO?: string
}
