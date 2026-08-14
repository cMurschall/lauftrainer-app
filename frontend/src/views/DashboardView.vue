<script lang="ts" setup>
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from '../i18n'
import type { TrainingPlanDay } from '../types/workout'
import {
  formatSport,
  formatWeekLabel,
  formatWorkoutDate as formatDateValue,
  formatWorkoutDistance,
  formatWorkoutDuration,
} from '../utils/formatters'
import { workoutIdentity } from '../services/workoutIdentity'
import SportIcon from '../components/SportIcon.vue'
import { useWorkoutStore } from '../stores/workouts'
import { usePlanStore } from '../stores/plan'
import { useSettingsStore } from '../stores/settings'
import { useAnalysisStore } from '../stores/analysis'
import { useUiStore } from '../stores/ui'
import { syncConnectors } from '../stores/dataLifecycle'
import {
  canCreatePlan,
  connectorBannerKind,
  createPlanButtonMode,
  isTrainingPlanLocalMode,
} from '../utils/dashboardUi'

const workouts = useWorkoutStore()
const planStore = usePlanStore()
const settings = useSettingsStore()
const analysisStore = useAnalysisStore()
const ui = useUiStore()

const { summaries } = storeToRefs(workouts)
const { plan, completedPlanDays } = storeToRefs(planStore)
const { connectors } = storeToRefs(settings)
const { analysis } = storeToRefs(analysisStore)
const { notification, credits, loading, consent, connectorLoading } = storeToRefs(ui)

const { t } = useI18n()
const localMode = isTrainingPlanLocalMode()
const showWorkoutDebug = import.meta.env.DEV && localStorage.getItem('lauftrainer-debug') === '1'
const formatWorkoutDate = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) ? formatWeekLabel(value) : formatDateValue(value)
const recentWorkouts = computed(() =>
  [...summaries.value].sort((a, b) => b.date.localeCompare(a.date)),
)
const strongestWeekDistance = computed(() =>
  Math.max(...analysis.value.weekly.map((week) => week.distanceKm).filter(Number.isFinite), 0),
)
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
const completedCount = computed(() => plan.value.days.filter((day) => completedPlanDays.value.includes(day.day)).length)
const hasPlan = computed(() => plan.value.days.length > 0)
const buttonMode = computed(() => createPlanButtonMode({ hasPlan: hasPlan.value }))
const planDescription = (day: TrainingPlanDay) =>
  day.session_type === 'rest'
    ? t.value.restDayDescription
    : day.description.startsWith('TESTPLAN')
    ? day.total_duration_minutes === 0
      ? t.value.restDayDescriptionFallback
      : t.value.testPlanFocusDescription(day.target_focus)
    : day.description
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
const planDayLabel = (day: TrainingPlanDay) => t.value[day.day]
const planSportLabel = (day: TrainingPlanDay) => (day.session_type === 'rest' ? t.value.restDay : t.value[day.sport])
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
        <div>
          <p class="eyebrow">{{ t.aiPlan }}</p>
          <h3>{{ t.yourWeek }}</h3>
        </div>
        <div class="plan-summary">
          <strong>{{ planMinutes }} min</strong>
          <span>{{ completedCount }}/{{ plan.days.length }} {{ t.planCompleted }}</span>
        </div>
      </div>
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
        :key="`${day.day}-${index}`"
        class="plan-day"
        :class="{ completed: completedPlanDays.includes(day.day) }"
      >
        <label class="plan-check">
          <input
            :checked="completedPlanDays.includes(day.day)"
            type="checkbox"
            @change="planStore.togglePlanDay(day.day)"
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
        <ul v-if="day.session_type !== 'rest'" class="plan-steps">
          <li
            v-for="step in day.workout_steps"
            :key="`${day.day}-${step.step_duration}-${step.step_instruction}`"
          >
            <strong class="plan-step-duration">{{ step.step_duration }}</strong>
            <span class="plan-step-intensity">{{ step.step_intensity }}</span>
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
        <RouterLink class="button secondary credits-link" to="/pricing">{{ t.buyCredits }}</RouterLink>
      </div>
      <p class="eyebrow">{{ t.aiPlan }}</p>
      <p>{{ t.aiDescription }}</p>
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
        class="button full"
        :class="buttonMode === 'replace' ? 'secondary' : 'primary'"
        type="button"
        data-testid="create-plan-button"
        @click="planStore.createPlan()"
      >
        {{ loading ? t.creatingPlan : buttonMode === 'replace' ? t.replacePlan : t.createPlan }}
      </button>
      <p v-if="createHint" class="muted create-hint">{{ createHint }}</p>
    </section>

    <section class="grid dashboard-grid">
      <article class="card">
        <p class="eyebrow">{{ t.history }}</p>
        <ul class="workouts">
          <li v-for="workout in recentWorkouts.slice(0, 12)" :key="workout.id" class="workout-row">
            <SportIcon :sport="workout.sport" />
            <div>
              <strong>{{ formatWorkoutDate(workout.date) }}</strong>
              <span
                >{{ formatSport(workout.sport) }} · {{ formatWorkoutDuration(workout.durationSeconds) }} ·
                {{ formatWorkoutDistance(workout.distanceKm) }}</span
              >
              <details v-if="showWorkoutDebug" class="workout-debug">
                <summary>{{ t.debugDetails }}</summary>
                <code>{{ JSON.stringify(workoutDebug(workout), null, 2) }}</code>
              </details>
            </div>
          </li>
          <li v-if="!recentWorkouts.length">{{ t.noWorkouts }}</li>
        </ul>
      </article>
      <article class="card">
        <p class="eyebrow">{{ t.weekOverview }}</p>
        <div class="weeks">
          <div v-for="week in analysis.weekly.slice(-8).reverse()" :key="week.weekStart">
            <strong>{{ formatWorkoutDate(week.weekStart) }}</strong>
            <span
              >{{ Number.isFinite(week.distanceKm) ? week.distanceKm.toFixed(1) : '–' }} km · {{ week.workoutCount }}
              {{ t.units }}</span
            >
            <i
              :style="{
                width: `${strongestWeekDistance ? Math.min(100, Math.max(0, ((Number.isFinite(week.distanceKm) ? week.distanceKm : 0) / strongestWeekDistance) * 100)) : 0}%`,
              }"
            ></i>
          </div>
          <p v-if="!analysis.weekly.length">{{ t.noWeeks }}</p>
        </div>
      </article>
    </section>
  </div>
</template>
