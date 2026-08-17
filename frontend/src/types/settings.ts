import type { CoachStyle } from './workout'

export type ThemePreference = 'system' | 'light' | 'dark'
export type MapDetailsConsent = 'unset' | 'allowed' | 'denied'

export type ConnectorId = 'polar' | 'strava'
export type { CoachStyle }

export interface ConnectorSettings {
  id: ConnectorId
  name: string
  active: boolean
  connected: boolean
  lastSyncAt?: string
  lastError?: string
}

export type GoalType = 'personal' | 'race'

export interface TrainingGoal {
  id: string
  type: GoalType
  title: string
  date?: string
  sport?: string
  distanceKm?: number
  target?: string
  targetTime?: string
  targetPace?: string
  priority?: 'A' | 'B' | 'C'
  notes?: string
  createdAt: string
}

export interface AppSettings {
  theme: ThemePreference
  locale: 'de' | 'en'
  connectors: ConnectorSettings[]
  coachStyle: CoachStyle
  /** Whether basemap tiles (approx. location via R2 Range reads) may be loaded. */
  mapDetailsConsent: MapDetailsConsent
}

export const MAP_DETAILS_CONSENT_KEY = 'lauftrainer-map-details-consent'

export const defaultAppSettings: AppSettings = {
  theme: 'system',
  locale: 'de',
  connectors: [
    { id: 'polar', name: 'Polar', active: true, connected: false },
    { id: 'strava', name: 'Strava', active: true, connected: false },
  ],
  coachStyle: 'pragmatist',
  mapDetailsConsent: 'unset',
}

export function normalizeMapDetailsConsent(value: unknown): MapDetailsConsent {
  return value === 'allowed' || value === 'denied' || value === 'unset' ? value : 'unset'
}

export function normalizeAppSettings(stored: Partial<AppSettings> | undefined): AppSettings {
  const style = stored?.coachStyle
  return {
    ...defaultAppSettings,
    ...stored,
    connectors: stored?.connectors?.length ? stored.connectors : defaultAppSettings.connectors,
    coachStyle: style === 'mentor' || style === 'pragmatist' || style === 'performance' ? style : 'pragmatist',
    mapDetailsConsent: normalizeMapDetailsConsent(stored?.mapDetailsConsent),
  }
}
