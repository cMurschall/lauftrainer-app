export interface Env {
  GEMINI_API_KEY: string
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
}
