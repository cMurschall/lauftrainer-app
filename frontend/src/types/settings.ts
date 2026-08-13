export type ThemePreference = 'system' | 'light' | 'dark'

export type ConnectorId = 'polar' | 'strava'

export interface ConnectorSettings {
  id: ConnectorId
  name: string
  active: boolean
  connected: boolean
  lastSyncAt?: string
  lastError?: string
}

export interface AppSettings {
  theme: ThemePreference
  locale: 'de' | 'en'
  connectors: ConnectorSettings[]
}

export const defaultAppSettings: AppSettings = {
  theme: 'dark',
  locale: 'de',
  connectors: [{ id: 'polar', name: 'Polar', active: true, connected: false }, { id: 'strava', name: 'Strava', active: true, connected: false }],
}
