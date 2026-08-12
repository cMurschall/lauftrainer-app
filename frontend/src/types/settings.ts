export type ThemePreference = 'system' | 'light' | 'dark'

export interface AppSettings {
  theme: ThemePreference
  locale: 'de' | 'en'
}

export const defaultAppSettings: AppSettings = {
  theme: 'system',
  locale: 'de'
}
