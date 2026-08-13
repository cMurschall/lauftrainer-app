<script lang="ts" setup>
import { onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { exportBackup, importBackup, workoutDb } from './db/database'
import { importWorkoutFile } from './services/importService'
import { requestTrainingPlan } from './services/aiService'
import {
  captureConnectorSession,
  connectorConnectUrl,
  connectorStatus,
  syncActiveConnectors,
} from './services/connectorService'
import { API_ROOT } from './services/api'
import { useI18n } from './i18n'
import { useTheme } from './composables/useTheme'
import { type AppSettings, type ConnectorSettings, defaultAppSettings, type ThemePreference } from './types/settings'
import AppSidebar from './components/AppSidebar.vue'
import BackendStatus from './components/BackendStatus.vue'
import type { AnalysisSummary, TrainingPlanDay, UserConfig, Workout } from './types/workout'
import { useAnalysis } from './analysis/analysisService'
import { diagnosticLog } from './services/logger'

const route = useRoute()
const { locale, t, setLocale, formatTime } = useI18n()
const workouts = ref<Workout[]>([]),
  plan = ref<TrainingPlanDay[]>([]),
  message = ref(''),
  loading = ref(false),
  consent = ref(false),
  search = ref('')
const backendStatus = ref<'checking' | 'online' | 'offline'>('checking'),
  backendVersion = ref('–'),
  backendCheckedAt = ref('')
const connectorLoading = ref(false)
const theme = ref<ThemePreference>(defaultAppSettings.theme)
const connectors = ref<ConnectorSettings[]>(structuredClone(defaultAppSettings.connectors))
const config = ref<UserConfig>({
  name: 'Athlet',
  trainingFocus: 'base_endurance',
  preferredTrainingDays: ['monday', 'wednesday', 'friday'],
  hrZones: { z1: [90, 106], z2: [107, 124], z3: [125, 142], z4: [143, 160], z5: [161, 179] },
  thresholds: { lthr: 160, hr_max: 186 },
})
const emptyAnalysis: AnalysisSummary = { totalDistanceKm: 0, totalDurationMinutes: 0, weekly: [], zoneMinutes: {} }
const analysis = ref<AnalysisSummary>(emptyAnalysis)
const importProgress = ref({ active: false, current: 0, total: 0, fileName: '', failed: 0 })
const { analysisResult, dashboardSummary, isCalculating, calculationError, loadAnalysis, invalidateAnalysis } =
  useAnalysis()
async function refreshAnalysis() {
  invalidateAnalysis()
  await loadAnalysis(workouts.value, config.value)
  if (dashboardSummary.value) analysis.value = dashboardSummary.value
}
useTheme(theme)
onMounted(async () => {
  workouts.value = await workoutDb.list()
  const stored = await workoutDb.getConfig()
  if (stored) config.value = stored
  await refreshAnalysis()
  const saved = await workoutDb.getAppSettings()
  if (saved) {
    theme.value = saved.theme
    localStorage.setItem('lauftrainer-theme', saved.theme)
    setLocale(saved.locale)
    connectors.value = saved.connectors || connectors.value
  } else {
    const old = localStorage.getItem('lauftrainer-locale')
    if (old === 'de' || old === 'en') setLocale(old)
    await saveSettings()
  }
  captureConnectorSession()
  await checkBackend()
  await refreshConnectors()
})

function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

async function saveSettings() {
  const settings: AppSettings = plain({ theme: theme.value, locale: locale.value, connectors: connectors.value })
  await workoutDb.saveAppSettings(settings)
  localStorage.setItem('lauftrainer-theme', theme.value)
}

function updateTheme(value: ThemePreference) {
  theme.value = value
  localStorage.setItem('lauftrainer-theme', value)
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

async function checkBackend() {
  try {
    const response = await fetch(`${API_ROOT}/health`, { signal: AbortSignal.timeout(8000) })
    if (!response.ok) throw new Error()
    const health = (await response.json()) as { status?: string; version?: string }
    backendStatus.value = health.status === 'ok' ? 'online' : 'offline'
    backendVersion.value = health.version || t.value.backendUnknown
  } catch {
    backendStatus.value = 'offline'
    backendVersion.value = '–'
  } finally {
    backendCheckedAt.value = formatTime(new Date())
  }
}

async function importFiles(event: Event) {
  const files = Array.from((event.target as HTMLInputElement).files || [])
  let imported = 0
  importProgress.value = { active: files.length > 0, current: 0, total: files.length, fileName: '', failed: 0 }
  for (const file of files) {
    importProgress.value.fileName = file.name
    try {
      await importWorkoutFile(file)
      imported++
    } catch (error) {
      diagnosticLog('import.error', {
        fileName: file.name,
        message: error instanceof Error ? error.message : String(error),
      })
      importProgress.value.failed++
      message.value = t.value.importFailed
    }
    importProgress.value.current++
  }
  workouts.value = await workoutDb.list()
  await refreshAnalysis()
  if (imported) message.value = t.value.importSuccess(imported)
  importProgress.value = { ...importProgress.value, active: false, fileName: '' }
  ;(event.target as HTMLInputElement).value = ''
}

async function createPlan() {
  if (!consent.value) {
    message.value = t.value.consent
    return
  }
  loading.value = true
  try {
    plan.value = await requestTrainingPlan(workouts.value, config.value)
    await workoutDb.savePlan(plan.value)
    message.value = t.value.planSaved
  } catch {
    message.value = t.value.aiFailed
  } finally {
    loading.value = false
  }
}

async function saveConfig() {
  await workoutDb.saveConfig(plain(config.value))
  await refreshAnalysis()
  message.value = t.value.configSaved
}

async function downloadBackup() {
  const blob = new Blob([JSON.stringify(await exportBackup(), null, 2)], { type: 'application/json' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = `lauftrainer-backup-${new Date().toISOString().slice(0, 10)}.json`
  link.click()
  URL.revokeObjectURL(link.href)
  message.value = t.value.backupExported
}

async function restoreBackup(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  try {
    await importBackup(JSON.parse(await file.text()))
    workouts.value = await workoutDb.list()
    await refreshAnalysis()
    message.value = t.value.backupRestored
  } catch {
    message.value = t.value.backupFailed
  }
}

async function clearData() {
  if (!window.confirm(t.value.confirmDelete)) return
  await workoutDb.deleteAll()
  workouts.value = []
  await refreshAnalysis()
  plan.value = []
  message.value = t.value.dataDeleted
}

function connectConnector(id: 'polar') {
  window.location.href = connectorConnectUrl(id)
}

async function syncConnectors() {
  connectorLoading.value = true
  try {
    const active = connectors.value.filter((item) => item.active && item.connected).map((item) => item.id)
    const results = await syncActiveConnectors(active)
    let imported = 0
    const errors: string[] = []
    for (const result of results) {
      for (const workout of result.workouts) {
        await workoutDb.put(workout)
        imported++
      }
      if (result.error) errors.push(`${result.connector}: ${result.error}`)
    }
    workouts.value = await workoutDb.list()
    await refreshAnalysis()
    message.value = errors.length
      ? `${imported} Training(s) gespeichert. ${errors.join(' ')}`
      : `${imported} Training(s) lokal gespeichert.`
  } catch (error) {
    message.value = error instanceof Error ? error.message : t.value.syncFailed
  } finally {
    connectorLoading.value = false
  }
}

async function saveWorkout(workout: Workout) {
  const rpe = workout.sessionRpe
  if (rpe !== undefined && (!Number.isFinite(rpe) || rpe < 1 || rpe > 10)) return
  await workoutDb.put(workout)
  workouts.value = await workoutDb.list()
  await refreshAnalysis()
}
</script>
<template>
  <div class="app-layout">
    <AppSidebar />
    <main class="main-content">
      <header class="topbar">
        <div>
          <span class="mobile-brand">LaufTrainer</span
          ><span class="route-label">{{
            route.name === 'settings' ? t.settingsNav : route.name === 'analysis' ? t.analysisNav : t.dashboard
          }}</span>
        </div>
        <div class="topbar-status">
          <span class="badge">{{ t.offlineReady }}</span
          ><BackendStatus
            :check="checkBackend"
            :checked-at="backendCheckedAt"
            :status="backendStatus"
            :version="backendVersion"
          />
        </div>
      </header>
      <RouterView v-slot="{ Component }">
        <component
          :is="Component"
          v-bind="
            route.name === 'settings'
              ? {
                  config,
                  theme,
                  connectors,
                  saveConfig,
                  saveSettings,
                  downloadBackup,
                  restoreBackup,
                  clearData,
                  connectConnector,
                }
              : route.name === 'analysis'
                ? {
                    workouts,
                    config,
                    saveWorkout,
                    results: analysisResult,
                    isCalculating,
                    calculationError,
                    retryAnalysis: refreshAnalysis,
                  }
                : {
                    workouts,
                    plan,
                    config,
                    analysis,
                    search,
                    message,
                    loading,
                    consent,
                    connectorLoading,
                    importFiles,
                    importProgress,
                    createPlan,
                    syncConnectors,
                  }
          "
          @update:search="search = $event"
          @update:consent="consent = $event"
          @update:theme="updateTheme($event)"
          @update:locale="setLocale($event)"
        />
      </RouterView>
    </main>
  </div>
</template>
