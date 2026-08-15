<script lang="ts" setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from '../i18n'
import type { TrainingPlanDay } from '../types/workout'
import {
  formatActivityDate,
  formatSport,
  formatTrainingMinutes,
  formatWeekStartShort,
  formatWorkoutDistance,
  formatWorkoutDuration,
} from '../utils/formatters'
import { isoWeekStart } from '../analysis/analysisEngine'
import { localDateKey } from '../utils/planDates'
import { workoutIdentity } from '../services/workoutIdentity'
import { useWorkoutStore } from '../stores/workouts'
import { usePlanStore } from '../stores/plan'
import { useSettingsStore } from '../stores/settings'
import { useAnalysisStore } from '../stores/analysis'
import { useUiStore } from '../stores/ui'
import { syncConnectors } from '../stores/dataLifecycle'
import {
  averageWeeklyMinutes,
  canCreatePlan,
  connectorBannerKind,
  createPlanButtonMode,
  isTrainingPlanLocalMode,
  shouldWarnPolarStravaOverlap,
  sportKind,
  weeklyTrend,
  type WeeklyTrendEntry,
} from '../utils/dashboardUi'

const workouts = useWorkoutStore()
const planStore = usePlanStore()
const settings = useSettingsStore()
const analysisStore = useAnalysisStore()
const ui = useUiStore()

const { summaries } = storeToRefs(workouts)
const { plan, completedPlanDates } = storeToRefs(planStore)
const { connectors } = storeToRefs(settings)
const { analysis } = storeToRefs(analysisStore)
const { notification, credits, loading, consent, connectorLoading } = storeToRefs(ui)

const { t, locale } = useI18n()
const localMode = isTrainingPlanLocalMode()
const showWorkoutDebug = import.meta.env.DEV && localStorage.getItem('lauftrainer-debug') === '1'
const DEFAULT_ACTIVITY_FIT = 6
const sortedActivities = computed(() =>
  [...summaries.value].sort((a, b) => b.date.localeCompare(a.date)),
)
const activityFit = ref(DEFAULT_ACTIVITY_FIT)
const recentActivities = computed(() =>
  sortedActivities.value.slice(0, Math.max(1, activityFit.value)),
)
const activitiesCardRef = ref<HTMLElement | null>(null)
const activitiesListRef = ref<HTMLElement | null>(null)
const trendCardRef = ref<HTMLElement | null>(null)
const trendContentRef = ref<HTMLElement | null>(null)

/**
 * Fill the recent-activities list to match the neighboring trend card height instead of a
 * fixed count. Measured against the trend card's natural content height (not the grid-stretched
 * card) so growing the list can never feed back into the available space.
 */
function recomputeActivityFit() {
  const total = sortedActivities.value.length
  if (!total) return
  const card = activitiesCardRef.value
  const list = activitiesListRef.value
  const trendCard = trendCardRef.value
  const trendContent = trendContentRef.value
  if (!card || !list || !trendCard || !trendContent) return

  const cardRect = card.getBoundingClientRect()
  const trendRect = trendCard.getBoundingClientRect()
  const sideBySide = Math.abs(cardRect.top - trendRect.top) < 4 && Math.abs(cardRect.left - trendRect.left) > 1
  if (!sideBySide) {
    activityFit.value = Math.min(DEFAULT_ACTIVITY_FIT, total)
    return
  }

  const row = list.querySelector<HTMLElement>('.activity-row')
  const rowHeight = row?.getBoundingClientRect().height ?? 0
  if (rowHeight <= 0) return

  const available = trendContent.getBoundingClientRect().bottom - list.getBoundingClientRect().top
  const fit = Math.floor((available + 1) / rowHeight)
  activityFit.value = Math.max(1, Math.min(total, fit))
}

let recomputeScheduled = false
function scheduleActivityFit() {
  if (recomputeScheduled) return
  recomputeScheduled = true
  requestAnimationFrame(() => {
    recomputeScheduled = false
    recomputeActivityFit()
  })
}

let activityFitObserver: ResizeObserver | undefined
onMounted(() => {
  if (typeof ResizeObserver !== 'undefined') {
    activityFitObserver = new ResizeObserver(scheduleActivityFit)
    if (trendContentRef.value) activityFitObserver.observe(trendContentRef.value)
    if (activitiesCardRef.value) activityFitObserver.observe(activitiesCardRef.value)
  }
  window.addEventListener('resize', scheduleActivityFit)
  scheduleActivityFit()
})
onBeforeUnmount(() => {
  activityFitObserver?.disconnect()
  window.removeEventListener('resize', scheduleActivityFit)
})
watch([sortedActivities, locale], () => nextTick(scheduleActivityFit))
const showPolarStravaOverlapWarning = computed(() => shouldWarnPolarStravaOverlap(connectors.value))
const currentWeekStart = computed(() => isoWeekStart(localDateKey()))
const trendWeeks = computed(() =>
  weeklyTrend({ weekly: analysis.value.weekly, currentWeekStart: currentWeekStart.value, limit: 6 }),
)
const currentWeek = computed(() => trendWeeks.value.find((week) => week.isCurrentWeek))
const averageMinutes = computed(() =>
  averageWeeklyMinutes({
    weekly: analysis.value.weekly,
    currentWeekStart: currentWeekStart.value,
    weeks: 4,
  }),
)
const activityMeta = (workout: (typeof summaries.value)[number]) =>
  [
    formatWorkoutDuration(workout.durationSeconds),
    workout.distanceKm && workout.distanceKm > 0 ? formatWorkoutDistance(workout.distanceKm) : '',
    workout.averageHeartRate ? `⌀ ${Math.round(workout.averageHeartRate)} bpm` : '',
  ]
    .filter(Boolean)
    .join(' · ')
const sessionsLabel = (count: number) => `${count} ${count === 1 ? t.value.unit : t.value.units}`
const weekVolumeMeta = (week: WeeklyTrendEntry) =>
  [sessionsLabel(week.workoutCount), week.distanceKm > 0 ? formatWorkoutDistance(week.distanceKm) : '']
    .filter(Boolean)
    .join(' · ')
const weekRowMeta = (week: WeeklyTrendEntry) =>
  [formatTrainingMinutes(week.durationMinutes), weekVolumeMeta(week)].join(' · ')
const workoutDebug = (workout: (typeof summaries.value)[number]) => ({
  source: workout.source,
  id: workout.id,
  date: workout.date,
  durationSeconds: workout.durationSeconds,
  distanceKm: workout.distanceKm,
  sport: workout.sport,
  identity: workoutIdentity(workout),
})
const planMinutes = computed(() => plan.value.days.reduce((sum, day) => sum + day.total_duration_minutes, 0))
const completedCount = computed(() =>
  plan.value.days.filter((day) => day.date && completedPlanDates.value.includes(day.date)).length,
)
const hasPlan = computed(() => plan.value.days.length > 0)
const buttonMode = computed(() => createPlanButtonMode({ hasPlan: hasPlan.value }))
const planDescription = (day: TrainingPlanDay) => {
  const description = day.description?.trim() || ''
  if (day.session_type === 'rest') {
    if (description && !description.startsWith('Converted to rest:') && !description.startsWith('TESTPLAN')) {
      return description
    }
    return t.value.restDayDescription
  }
  if (description.startsWith('TESTPLAN')) {
    return day.total_duration_minutes === 0
      ? t.value.restDayDescriptionFallback
      : t.value.testPlanFocusDescription(day.target_focus)
  }
  return description || t.value.restDayDescriptionFallback
}
const showPlanSteps = (day: TrainingPlanDay) =>
  day.workout_steps.some((step) => Boolean(step.step_instruction?.trim() || step.step_duration?.trim()))
const activeConnectedConnectors = computed(() =>
  connectors.value.filter((connector) => connector.active && connector.connected),
)
const bannerKind = computed(() =>
  connectorBannerKind({
    hasWorkouts: summaries.value.length > 0,
    hasActiveConnected: activeConnectedConnectors.value.length > 0,
  }),
)
const createEnabled = computed(() =>
  canCreatePlan({
    consent: consent.value,
    workoutCount: summaries.value.length,
    loading: loading.value,
    credits: credits.value,
    localMode,
  }),
)
const createHint = computed(() => {
  if (!summaries.value.length || loading.value) return ''
  if (!consent.value) return t.value.needConsent
  if (!localMode && credits.value < 1) return t.value.needCredits
  return ''
})
const planStepIndex = ref(0)
let planStepTimer: number | undefined
const planStepText = computed(() => {
  const steps = t.value.creatingPlanSteps
  return steps[Math.min(planStepIndex.value, steps.length - 1)]
})
watch(loading, (isLoading) => {
  window.clearInterval(planStepTimer)
  if (!isLoading) return
  planStepIndex.value = 0
  planStepTimer = window.setInterval(() => {
    const steps = t.value.creatingPlanSteps
    if (planStepIndex.value < steps.length - 1) planStepIndex.value += 1
  }, 1600)
})
onBeforeUnmount(() => window.clearInterval(planStepTimer))
const planDayLabel = (day: TrainingPlanDay) => {
  const weekday = t.value[day.day]
  if (!day.date) return weekday
  const formatted = new Intl.DateTimeFormat(locale.value, { day: '2-digit', month: '2-digit' }).format(
    new Date(`${day.date}T12:00:00`),
  )
  return `${weekday}, ${formatted}`
}
const planSportLabel = (day: TrainingPlanDay) => {
  if (day.session_type === 'rest') return t.value.restDay
  if (day.sport_label?.trim()) return day.sport_label.trim()
  return t.value[day.sport]
}
const planDayKey = (day: TrainingPlanDay, index: number) => day.date || `${day.day}-${index}`
const isPlanDayCompleted = (day: TrainingPlanDay) => Boolean(day.date && completedPlanDates.value.includes(day.date))

const showPlanNotesDialog = ref(false)
const planNotesDraft = ref('')

function openPlanNotesDialog() {
  if (!createEnabled.value) return
  planNotesDraft.value = ''
  showPlanNotesDialog.value = true
}

function closePlanNotesDialog() {
  showPlanNotesDialog.value = false
  planNotesDraft.value = ''
}

async function confirmPlanNotesDialog() {
  const notes = planNotesDraft.value
  showPlanNotesDialog.value = false
  planNotesDraft.value = ''
  await planStore.createPlan(notes)
}
</script>
<template>
  <Transition name="toast">
    <div
      v-if="notification.message"
      class="toast"
      :class="`toast-${notification.type}`"
      :role="notification.type === 'error' ? 'alert' : 'status'"
    >
      <span>{{ notification.message }}</span>
      <button type="button" aria-label="Meldung schließen" @click="ui.dismissNotification()">×</button>
    </div>
  </Transition>
  <div class="dashboard-flow" :class="{ 'has-plan': hasPlan }">
    <section v-if="summaries.length" class="stats dashboard-stats">
      <article class="card">
        <span>{{ t.workouts }}</span>
        <strong class="metric">{{ summaries.length }}</strong>
      </article>
      <article class="card">
        <span>{{ t.totalDistance }}</span>
        <strong class="metric"
          >{{ Number.isFinite(analysis.totalDistanceKm) ? analysis.totalDistanceKm.toFixed(1) : '–' }} km</strong
        >
      </article>
      <article class="card">
        <span>{{ t.trainingTime }}</span>
        <strong class="metric"
          >{{
            Number.isFinite(analysis.totalDurationMinutes) ? Math.round(analysis.totalDurationMinutes / 60) : '–'
          }}
          h</strong
        >
      </article>
    </section>

    <section v-if="!summaries.length" class="hero dashboard-empty-hero">
      <span class="hero-orb" aria-hidden="true">◉</span>
      <p>{{ t.heroText }}</p>
      <div class="empty-actions">
        <RouterLink class="button primary" to="/settings#connectors">{{ t.connectTrainingSource }}</RouterLink>
      </div>
    </section>

    <section v-if="bannerKind === 'sync'" class="card connector-card">
      <div class="card-heading">
        <div>
          <p class="eyebrow">{{ t.connectors }}</p>
          <h3>{{ t.syncAllConnectors }}</h3>
        </div>
        <span class="connection-dot"></span>
      </div>
      <p
        v-if="showPolarStravaOverlapWarning"
        class="notice notice-warning"
        role="status"
        data-banner="polarStravaOverlap"
      >
        {{ t.polarStravaOverlapWarning }}
      </p>
      <button :disabled="connectorLoading" class="button primary" type="button" @click="syncConnectors">
        {{ connectorLoading ? t.syncingConnectors : t.syncConnectors }}
      </button>
    </section>
    <p v-else-if="bannerKind === 'localData'" class="connector-empty-banner muted" :data-banner="bannerKind">
      <span>{{ t.noSyncSourceWithData }}</span>
      <RouterLink class="button secondary connector-connect-button" to="/settings#connectors">
        {{ t.connectTrainingSource }}
      </RouterLink>
    </p>

    <section v-if="hasPlan" class="card plan dashboard-plan">
      <div class="plan-heading">
        <div class="plan-heading-title">
          <h3>{{ t.nextSevenDays }}</h3>
          <span class="plan-badge">{{ t.aiPlanBadge }}</span>
        </div>
        <div class="plan-summary">
          <strong>{{ planMinutes }} min</strong>
          <span>{{ completedCount }}/{{ plan.days.length }} {{ t.planCompleted }}</span>
        </div>
      </div>
      <p class="muted plan-disclaimer">{{ t.aiDisclaimer }}</p>
      <div
        v-if="plan.week_summary?.focus_title || plan.week_summary?.goal_description"
        class="week-summary rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3"
      >
        <strong class="font-semibold text-emerald-600 dark:text-emerald-400">{{
          plan.week_summary?.focus_title || t.weekFocus
        }}</strong>
        <p v-if="plan.week_summary?.goal_description" class="text-xs italic text-zinc-600 dark:text-zinc-400">
          {{ plan.week_summary.goal_description }}
        </p>
      </div>
      <article
        v-for="(day, index) in plan.days"
        :key="planDayKey(day, index)"
        class="plan-day"
        :class="{ completed: isPlanDayCompleted(day) }"
      >
        <label class="plan-check">
          <input
            :checked="isPlanDayCompleted(day)"
            type="checkbox"
            @change="planStore.togglePlanDate(day.date)"
          />
          <span>
            <strong class="plan-day-name">{{ planDayLabel(day) }}</strong>
            <small>{{ day.target_focus }}</small>
          </span>
        </label>
        <div class="plan-day-meta">
          <span class="plan-sport">{{ planSportLabel(day) }}</span>
          <strong>{{ day.total_duration_minutes }} min</strong>
        </div>
        <p>{{ planDescription(day) }}</p>
        <ul v-if="showPlanSteps(day)" class="plan-steps">
          <li
            v-for="step in day.workout_steps"
            :key="`${planDayKey(day, index)}-${step.step_duration}-${step.step_instruction}`"
          >
            <div class="plan-step-meta">
              <strong class="plan-step-duration">{{ step.step_duration }}</strong>
              <span class="plan-step-intensity">{{ step.step_intensity }}</span>
            </div>
            <span class="plan-step-instruction">{{ step.step_instruction }}</span>
          </li>
        </ul>
      </article>
    </section>

    <section v-if="summaries.length" class="card ai-plan-card" :class="{ compact: hasPlan }">
      <div class="credits-summary">
        <p class="eyebrow">{{ t.creditLabel }}</p>
        <strong class="metric">{{ credits }}</strong>
        <span class="muted">{{ t.creditPerPlan }}</span>
        <RouterLink class="button primary credits-link" to="/pricing">{{ t.buyCredits }}</RouterLink>
        <p class="muted credits-device-note">{{ t.creditsDeviceNote }}</p>
      </div>
      <p class="eyebrow">{{ t.aiPlan }}</p>
      <p>{{ t.aiDescription }}</p>
      <p class="muted ai-disclaimer">{{ t.aiDisclaimer }}</p>
      <label class="consent">
        <input
          :checked="consent"
          type="checkbox"
          @change="ui.consent = ($event.target as HTMLInputElement).checked"
        />
        {{ t.consent }}
      </label>
      <button
        :disabled="!createEnabled"
        class="button full primary"
        type="button"
        data-testid="create-plan-button"
        @click="openPlanNotesDialog"
      >
        {{ loading ? t.creatingPlan : buttonMode === 'replace' ? t.replacePlan : t.createPlan }}
      </button>
      <div v-if="loading" class="plan-progress" role="status" aria-live="polite">
        <div class="plan-progress-bar" aria-hidden="true"><span></span></div>
        <p class="plan-progress-step">
          <span class="spinner" aria-hidden="true"></span>
          {{ planStepText }}
        </p>
      </div>
      <p v-else-if="createHint" class="muted create-hint">{{ createHint }}</p>
    </section>

    <section class="grid dashboard-grid">
      <article ref="activitiesCardRef" class="card">
        <p class="eyebrow">{{ t.recentActivities }}</p>
        <ul ref="activitiesListRef" class="activities">
          <li v-for="workout in recentActivities" :key="workout.id" class="activity-row">
            <span class="activity-accent" :class="`accent-${sportKind(workout.sport)}`" aria-hidden="true"></span>
            <div>
              <strong>{{ formatSport(workout.sport) }} · {{ formatActivityDate(workout.date, locale) }}</strong>
              <span>{{ activityMeta(workout) }}</span>
              <details v-if="showWorkoutDebug" class="workout-debug">
                <summary>{{ t.debugDetails }}</summary>
                <code>{{ JSON.stringify(workoutDebug(workout), null, 2) }}</code>
              </details>
            </div>
          </li>
          <li v-if="!recentActivities.length" class="activity-empty">{{ t.noWorkouts }}</li>
        </ul>
      </article>
      <article ref="trendCardRef" class="card">
        <div ref="trendContentRef" class="trend-content">
          <p class="eyebrow">{{ t.trainingTrend }}</p>
          <template v-if="analysis.weekly.length">
            <div class="trend-summary">
              <p class="trend-summary-label">{{ t.thisWeekToDate }}</p>
              <strong class="metric">{{ formatTrainingMinutes(currentWeek?.durationMinutes || 0) }}</strong>
              <span class="muted">{{ currentWeek ? weekVolumeMeta(currentWeek) : sessionsLabel(0) }}</span>
              <span class="muted">{{ t.weeklyAverage(formatTrainingMinutes(averageMinutes)) }}</span>
            </div>
            <div class="weeks trend-weeks">
              <div v-for="week in trendWeeks" :key="week.weekStart" :class="{ current: week.isCurrentWeek }">
                <strong>{{ week.isCurrentWeek ? t.thisWeek : t.weekFrom(formatWeekStartShort(week.weekStart, locale)) }}</strong>
                <span>{{ weekRowMeta(week) }}</span>
                <i :style="{ width: `${week.sharePercent}%` }"></i>
              </div>
            </div>
          </template>
          <p v-else class="muted">{{ t.noWeeks }}</p>
        </div>
      </article>
    </section>
  </div>

  <div
    v-if="showPlanNotesDialog"
    class="modal-backdrop"
    role="presentation"
    @click.self="closePlanNotesDialog"
  >
    <div
      class="modal-card"
      role="dialog"
      aria-modal="true"
      :aria-label="t.planContext"
    >
      <p class="eyebrow">{{ t.planContext }}</p>
      <p v-if="hasPlan" class="notice notice-warning" role="status">{{ t.confirmReplacePlan }}</p>
      <p class="field-help">{{ t.planContextHelp }}</p>
      <label>
        <textarea
          v-model="planNotesDraft"
          rows="4"
          :placeholder="t.planContextPlaceholder"
        ></textarea>
      </label>
      <div class="modal-actions">
        <button class="button secondary" type="button" @click="closePlanNotesDialog">{{ t.cancel }}</button>
        <button class="button primary" type="button" @click="confirmPlanNotesDialog">{{ t.createPlanConfirm }}</button>
      </div>
    </div>
  </div>
</template>
