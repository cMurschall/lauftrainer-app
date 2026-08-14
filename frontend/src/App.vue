<script lang="ts" setup>
import { onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from './i18n'
import { useTheme } from './composables/useTheme'
import { usePwaInstall } from './composables/usePwaInstall'
import { cachedBalance, getBalance } from './services/billingService'
import { API_ROOT } from './services/api'
import { diagnosticLog } from './services/logger'
import AppSidebar from './components/AppSidebar.vue'
import BackendStatus from './components/BackendStatus.vue'
import PwaInstallBanner from './components/PwaInstallBanner.vue'
import frontendPackage from '../package.json'
import { useUiStore } from './stores/ui'
import { useWorkoutStore } from './stores/workouts'
import { useSettingsStore } from './stores/settings'
import { usePlanStore } from './stores/plan'
import { useAnalysisStore } from './stores/analysis'

const ui = useUiStore()
const workouts = useWorkoutStore()
const settings = useSettingsStore()
const plan = usePlanStore()
const analysis = useAnalysisStore()
const { theme } = storeToRefs(settings)
const { t, formatTime } = useI18n()
const frontendLocalMode = ['mock', 'local'].includes(import.meta.env.VITE_TRAINING_PLAN_MODE)
const frontendVersion = frontendPackage.version
const frontendCommit = import.meta.env.VITE_COMMIT_SHA || ''
const { visible: pwaInstallVisible, ios: pwaInstallIos, install: installPwa, dismiss: dismissPwaInstall } = usePwaInstall()

useTheme(theme)

async function checkBackend() {
  try {
    const response = await fetch(`${API_ROOT}/health`, { signal: AbortSignal.timeout(8000) })
    if (!response.ok) throw new Error()
    const health = (await response.json()) as { status?: string; version?: string; commit?: string }
    ui.backendStatus = health.status === 'ok' ? 'online' : 'offline'
    ui.backendVersion = health.version || t.value.backendUnknown
    ui.backendCommit = health.commit || ''
  } catch {
    ui.backendStatus = 'offline'
    ui.backendVersion = '–'
  } finally {
    ui.backendCheckedAt = formatTime(new Date())
  }
}

onMounted(async () => {
  ui.credits = cachedBalance()
  if (!frontendLocalMode) void getBalance().then((value) => { ui.credits = value }).catch(() => undefined)
  diagnosticLog('theme.startup', {
    defaultPreference: settings.theme,
    localStoragePreference: localStorage.getItem('lauftrainer-theme'),
    domThemeBeforeSettings: document.documentElement.dataset.theme || '(unset)',
  })
  await settings.load()
  await workouts.reloadDeduplicated()
  await plan.load()
  await analysis.refreshAnalysis()
  await checkBackend()
  await settings.refreshConnectors()
})
</script>
<template>
  <div class="app-layout">
    <AppSidebar />
    <main class="main-content">
      <PwaInstallBanner
        :visible="pwaInstallVisible"
        :ios="pwaInstallIos"
        :title="t.installApp"
        :description="t.installAppDescription"
        :ios-description="t.installAppIos"
        :install-label="t.install"
        :dismiss-label="t.later"
        @install="installPwa"
        @dismiss="dismissPwaInstall"
      />
      <RouterView />
      <footer class="diagnostics-footer">
        <details>
          <summary>{{ t.technicalInformation }}</summary>
          <div class="diagnostics-content">
            <BackendStatus :check="checkBackend" :checked-at="ui.backendCheckedAt" :status="ui.backendStatus" :version="ui.backendVersion" />
            <span>{{ t.frontendVersion }} {{ frontendVersion }}<template v-if="frontendCommit"> · {{ frontendCommit }}</template></span>
            <span>{{ t.backendVersion }} {{ ui.backendVersion }}<template v-if="ui.backendCommit"> · {{ ui.backendCommit }}</template></span>
          </div>
        </details>
        <nav class="legal-links" :aria-label="t.imprint">
          <RouterLink to="/impressum">{{ t.imprint }}</RouterLink>
          <RouterLink to="/datenschutz">{{ t.privacy }}</RouterLink>
        </nav>
      </footer>
    </main>
  </div>
</template>
