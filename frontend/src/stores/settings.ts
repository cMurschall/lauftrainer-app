import { defineStore } from 'pinia'
import { ref } from 'vue'
import { workoutDb } from '../db/database'
import { useI18n, type Locale } from '../i18n'
import {
  type AppSettings,
  type ConnectorId,
  type ConnectorSettings,
  defaultAppSettings,
  type ThemePreference,
  type TrainingGoal,
} from '../types/settings'
import type { UserConfig } from '../types/workout'
import { defaultUserConfig, normalizeUserConfig } from '../types/defaults'
import { plain } from '../utils/clone'
import { diagnosticLog } from '../services/logger'
import {
  captureConnectorSession,
  connectorConnectUrl,
  connectorStatus,
  disconnectConnector,
} from '../services/connectorService'
import { useUiStore } from './ui'

export const useSettingsStore = defineStore('settings', () => {
  const persistedTheme = localStorage.getItem('lauftrainer-theme')
  const initialTheme: ThemePreference =
    persistedTheme === 'system' || persistedTheme === 'light' || persistedTheme === 'dark'
      ? persistedTheme
      : defaultAppSettings.theme

  const theme = ref<ThemePreference>(initialTheme)
  const connectors = ref<ConnectorSettings[]>(structuredClone(defaultAppSettings.connectors))
  const goals = ref<TrainingGoal[]>([])
  const config = ref<UserConfig>(defaultUserConfig())

  async function load() {
    const { setLocale } = useI18n()
    captureConnectorSession()
    goals.value = await workoutDb.listGoals()
    const stored = await workoutDb.getConfig()
    if (stored) config.value = normalizeUserConfig(stored)
    const saved = await workoutDb.getAppSettings()
    if (saved) {
      diagnosticLog('theme.settings-loaded', {
        savedPreference: saved.theme,
        currentPreference: theme.value,
      })
      theme.value = saved.theme
      localStorage.setItem('lauftrainer-theme', saved.theme)
      setLocale(saved.locale)
      connectors.value = saved.connectors || connectors.value
    } else {
      const old = localStorage.getItem('lauftrainer-locale')
      if (old === 'de' || old === 'en') setLocale(old)
      await saveSettings()
    }
  }

  async function saveSettings() {
    const { locale } = useI18n()
    const settings: AppSettings = plain({ theme: theme.value, locale: locale.value, connectors: connectors.value })
    await workoutDb.saveAppSettings(settings)
    localStorage.setItem('lauftrainer-theme', theme.value)
  }

  function updateTheme(value: ThemePreference) {
    diagnosticLog('theme.user-change', { previousPreference: theme.value, nextPreference: value })
    theme.value = value
    localStorage.setItem('lauftrainer-theme', value)
  }

  function updateLocale(value: Locale) {
    const { setLocale } = useI18n()
    setLocale(value)
  }

  async function saveConfig() {
    const ui = useUiStore()
    const { t } = useI18n()
    const nextConfig = plain(config.value)
    nextConfig.maxWeeklyTrainingMinutes =
      typeof nextConfig.maxWeeklyTrainingMinutes === 'number' && nextConfig.maxWeeklyTrainingMinutes > 0
        ? nextConfig.maxWeeklyTrainingMinutes
        : undefined
    nextConfig.maxTrainingMinutesPerDay = Object.fromEntries(
      Object.entries(nextConfig.maxTrainingMinutesPerDay || {}).map(([day, value]) => [
        day,
        typeof value === 'number' && value > 0 ? value : undefined,
      ]),
    )
    config.value = nextConfig
    await workoutDb.saveConfig(nextConfig)
    ui.notify(t.value.configSaved, 'success')
  }

  async function saveGoal(goal: TrainingGoal) {
    await workoutDb.saveGoal(plain(goal))
    goals.value = await workoutDb.listGoals()
  }

  async function deleteGoal(id: string) {
    await workoutDb.deleteGoal(id)
    goals.value = goals.value.filter((goal) => goal.id !== id)
  }

  async function refreshConnectors() {
    try {
      const statuses = await connectorStatus()
      connectors.value = statuses.map((status) => ({
        ...status,
        active: connectors.value.find((item) => item.id === status.id)?.active ?? status.active,
      }))
      await saveSettings()
    } catch {
      /* retain local settings while offline */
    }
  }

  function connectConnector(id: ConnectorId) {
    window.location.href = connectorConnectUrl(id)
  }

  async function removeConnector(id: ConnectorId) {
    const ui = useUiStore()
    try {
      await disconnectConnector(id)
      const connector = connectors.value.find((item) => item.id === id)
      if (connector) {
        connector.connected = false
        connector.active = false
      }
      await saveSettings()
      ui.notify(`${id === 'polar' ? 'Polar' : 'Strava'} getrennt.`, 'success')
    } catch (error) {
      ui.notify(error instanceof Error ? error.message : 'Connector konnte nicht getrennt werden.', 'error')
    }
  }

  function setConnectorActive(id: ConnectorId, active: boolean) {
    const connector = connectors.value.find((item) => item.id === id)
    if (connector) connector.active = active
  }

  function resetAthleteData() {
    config.value = defaultUserConfig()
    goals.value = []
  }

  return {
    theme,
    connectors,
    goals,
    config,
    load,
    saveSettings,
    updateTheme,
    updateLocale,
    saveConfig,
    saveGoal,
    deleteGoal,
    refreshConnectors,
    connectConnector,
    removeConnector,
    setConnectorActive,
    resetAthleteData,
  }
})
