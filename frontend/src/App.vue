<script lang="ts" setup>
import {computed, onMounted, ref} from 'vue'
import {useRoute} from 'vue-router'
import {calculateAnalysis as calculateDashboardAnalysis} from './analysis/localAnalysis'
import {exportBackup, importBackup, workoutDb} from './db/database'
import {importWorkoutFile} from './services/importService'
import {requestTrainingPlan} from './services/aiService'
import {
  captureConnectorSession,
  connectorConnectUrl,
  connectorStatus,
  syncActiveConnectors
} from './services/connectorService'
import {API_ROOT} from './services/api'
import {useI18n} from './i18n'
import {useTheme} from './composables/useTheme'
import {type AppSettings, type ConnectorSettings, defaultAppSettings, type ThemePreference} from './types/settings'
import AppSidebar from './components/AppSidebar.vue'
import BackendStatus from './components/BackendStatus.vue'
import type {TrainingPlanDay, UserConfig, Workout} from './types/workout'

const route = useRoute();
const {locale, t, setLocale, formatTime} = useI18n()
const workouts = ref<Workout[]>([]), plan = ref<TrainingPlanDay[]>([]), message = ref(''), loading = ref(false),
    consent = ref(false), search = ref('')
const backendStatus = ref<'checking' | 'online' | 'offline'>('checking'), backendVersion = ref('–'),
    backendCheckedAt = ref('');
const connectorLoading = ref(false);
const theme = ref<ThemePreference>(defaultAppSettings.theme);
const connectors = ref<ConnectorSettings[]>(structuredClone(defaultAppSettings.connectors))
const config = ref<UserConfig>({
  name: 'Athlet',
  trainingFocus: 'base_endurance',
  preferredTrainingDays: ['monday', 'wednesday', 'friday'],
  hrZones: {z1: [90, 106], z2: [107, 124], z3: [125, 142], z4: [143, 160], z5: [161, 179]},
  thresholds: {lthr: 160, hr_max: 186}
})
const analysis = computed(() => calculateDashboardAnalysis(workouts.value, config.value));
useTheme(theme)
onMounted(async () => {
  workouts.value = await workoutDb.list();
  const stored = await workoutDb.getConfig();
  if (stored) config.value = stored;
  const saved = await workoutDb.getAppSettings();
  if (saved) {
    theme.value = saved.theme;
    setLocale(saved.locale);
    connectors.value = saved.connectors || connectors.value
  } else {
    const old = localStorage.getItem('lauftrainer-locale');
    if (old === 'de' || old === 'en') setLocale(old);
    await saveSettings()
  }
  ;captureConnectorSession();
  await checkBackend();
  await refreshConnectors()
})

function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

async function saveSettings() {
  const settings: AppSettings = plain({theme: theme.value, locale: locale.value, connectors: connectors.value});
  await workoutDb.saveAppSettings(settings)
}

async function refreshConnectors() {
  try {
    const statuses = await connectorStatus();
    connectors.value = statuses.map(status => ({
      ...status,
      active: connectors.value.find(item => item.id === status.id)?.active ?? status.active
    }));
    await saveSettings()
  } catch { /* retain local settings while offline */
  }
}

async function checkBackend() {
  try {
    const response = await fetch(`${API_ROOT}/health`, {signal: AbortSignal.timeout(8000)});
    if (!response.ok) throw new Error();
    const health = await response.json() as { status?: string; version?: string };
    backendStatus.value = health.status === 'ok' ? 'online' : 'offline';
    backendVersion.value = health.version || t.value.backendUnknown
  } catch {
    backendStatus.value = 'offline';
    backendVersion.value = '–'
  } finally {
    backendCheckedAt.value = formatTime(new Date())
  }
}

async function importFiles(event: Event) {
  const files = Array.from((event.target as HTMLInputElement).files || []);
  let imported = 0;
  for (const file of files) {
    try {
      await importWorkoutFile(file);
      imported++
    } catch {
      message.value = t.value.importFailed
    }
  }
  workouts.value = await workoutDb.list();
  if (imported) message.value = t.value.importSuccess(imported)
}

async function createPlan() {
  if (!consent.value) {
    message.value = t.value.consent;
    return
  }
  loading.value = true;
  try {
    plan.value = await requestTrainingPlan(workouts.value, config.value);
    await workoutDb.savePlan(plan.value);
    message.value = t.value.planSaved
  } catch {
    message.value = t.value.aiFailed
  } finally {
    loading.value = false
  }
}

async function saveConfig() {
  await workoutDb.saveConfig(plain(config.value));
  message.value = t.value.configSaved
}

async function downloadBackup() {
  const blob = new Blob([JSON.stringify(await exportBackup(), null, 2)], {type: 'application/json'});
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `lauftrainer-backup-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
  message.value = t.value.backupExported
}

async function restoreBackup(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  try {
    await importBackup(JSON.parse(await file.text()));
    workouts.value = await workoutDb.list();
    message.value = t.value.backupRestored
  } catch {
    message.value = t.value.backupFailed
  }
}

async function clearData() {
  if (!window.confirm(t.value.confirmDelete)) return;
  await workoutDb.deleteAll();
  workouts.value = [];
  plan.value = [];
  message.value = t.value.dataDeleted
}

function connectConnector(id: 'polar') {
  window.location.href = connectorConnectUrl(id)
}

async function syncConnectors() {
  connectorLoading.value = true;
  try {
    const active = connectors.value.filter(item => item.active && item.connected).map(item => item.id);
    const results = await syncActiveConnectors(active);
    let imported = 0;
    const errors: string[] = [];
    for (const result of results) {
      for (const workout of result.workouts) {
        await workoutDb.put(workout);
        imported++
      }
      if (result.error) errors.push(`${result.connector}: ${result.error}`)
    }
    workouts.value = await workoutDb.list();
    message.value = errors.length ? `${imported} Training(s) gespeichert. ${errors.join(' ')}` : `${imported} Training(s) lokal gespeichert.`
  } catch (error) {
    message.value = error instanceof Error ? error.message : t.value.syncFailed
  } finally {
    connectorLoading.value = false
  }
}

async function saveWorkout(workout: Workout) {
  const rpe = workout.sessionRpe;
  if (rpe !== undefined && (!Number.isFinite(rpe) || rpe < 1 || rpe > 10)) return;
  await workoutDb.put(workout);
  workouts.value = await workoutDb.list()
}
</script>
<template>
  <div class="app-layout">
    <AppSidebar/>
    <main class="main-content">
      <header class="topbar">
        <div><span class="mobile-brand">LaufTrainer</span><span class="route-label">{{
            route.name === 'settings' ? t.settingsNav : route.name === 'analysis' ? t.analysisNav : t.dashboard
          }}</span></div>
        <span class="badge">{{ t.offlineReady }}</span></header>
      <RouterView v-slot="{ Component }">
        <component :is="Component"
                   v-bind="route.name === 'settings' ? { config, theme, connectors, saveConfig, saveSettings, downloadBackup, restoreBackup, clearData, connectConnector } : route.name === 'analysis' ? { workouts, config, saveWorkout } : { workouts, plan, config, analysis, search, message, loading, consent, connectorLoading, importFiles, createPlan, syncConnectors }"
                   @update:search="search = $event" @update:consent="consent = $event" @update:theme="theme = $event"
                   @update:locale="setLocale($event)"/>
      </RouterView>
      <footer><span>{{ t.localUpload }}</span>
        <BackendStatus :check="checkBackend" :checked-at="backendCheckedAt" :status="backendStatus"
                       :version="backendVersion"/>
      </footer>
    </main>
  </div>
</template>
