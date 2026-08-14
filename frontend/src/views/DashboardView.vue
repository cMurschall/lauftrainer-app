<script lang="ts" setup>
import { computed } from 'vue'
import { useI18n } from '../i18n'
import type { TrainingPlan, TrainingPlanDay, UserConfig, Workout } from '../types/workout'
import type { ConnectorSettings } from '../types/settings'
import {
  formatSport,
  formatWeekLabel,
  formatWorkoutDate as formatDateValue,
  formatWorkoutDistance,
  formatWorkoutDuration,
} from '../utils/formatters'
import { workoutIdentity } from '../services/workoutIdentity'
import SportIcon from '../components/SportIcon.vue'

const props = defineProps<{
  workouts: Workout[]
  connectors: ConnectorSettings[]
  plan: TrainingPlan
  completedPlanDays: string[]
  config: UserConfig
  analysis: {
    totalDistanceKm: number
    totalDurationMinutes: number
    weekly: Array<{ weekStart: string; distanceKm: number; workoutCount: number }>
  }
  message: string
  aiError: string
  credits: number
  loading: boolean
  consent: boolean
  connectorLoading: boolean
  syncConnectors: () => void
  createPlan: () => void
  togglePlanDay: (day: string) => void
}>()
const emit = defineEmits<{ 'update:consent': [value: boolean] }>()
const { t } = useI18n()
const showWorkoutDebug = import.meta.env.DEV
const formatWorkoutDate = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) ? formatWeekLabel(value) : formatDateValue(value)
const recentWorkouts = computed(() =>
  [...props.workouts]
    .sort((a, b) => b.date.localeCompare(a.date)),
)
const strongestWeekDistance = computed(() =>
  Math.max(...props.analysis.weekly.map((week) => week.distanceKm).filter(Number.isFinite), 0),
)
const workoutDebug = (workout: Workout) => ({
  source: workout.source,
  id: workout.id,
  date: workout.date,
  durationSeconds: workout.durationSeconds,
  distanceKm: workout.distanceKm,
  sport: workout.sport,
  identity: workoutIdentity(workout),
})
const planMinutes = computed(() => props.plan.days.reduce((sum, day) => sum + day.total_duration_minutes, 0))
const completedCount = computed(() => props.plan.days.filter((day) => props.completedPlanDays.includes(day.day)).length)
const planDescription = (day: TrainingPlanDay) =>
  day.session_type === 'rest'
    ? t.value.restDayDescription
    : day.description.startsWith('TESTPLAN')
    ? day.total_duration_minutes === 0
      ? 'Erholungstag.'
      : `${day.target_focus} mit kontrollierter Belastung.`
    : day.description
const activeConnectedConnectors = computed(() => props.connectors.filter((connector) => connector.active && connector.connected))
const planDayLabel = (day: TrainingPlanDay) => t.value[day.day]
const planSportLabel = (day: TrainingPlanDay) => day.session_type === 'rest' ? t.value.restDay : t.value[day.sport]
</script>
<template>
  <p v-if="message" class="notice">{{ message }}</p>
  <Transition name="toast">
    <p v-if="aiError" class="toast toast-error" role="alert">{{ aiError }}</p>
  </Transition>
  <div class="dashboard-flow">
  <section class="stats dashboard-stats">
    <article class="card">
      <span>{{ t.workouts }}</span
      ><strong class="metric">{{ workouts.length }}</strong>
    </article>
    <article class="card">
      <span>{{ t.totalDistance }}</span
      ><strong class="metric"
        >{{ Number.isFinite(analysis.totalDistanceKm) ? analysis.totalDistanceKm.toFixed(1) : '–' }} km</strong
      >
    </article>
    <article class="card">
      <span>{{ t.trainingTime }}</span
      ><strong class="metric"
        >{{
          Number.isFinite(analysis.totalDurationMinutes) ? Math.round(analysis.totalDurationMinutes / 60) : '–'
        }}
        h</strong
      >
    </article>
  </section>
  <section v-if="!workouts.length" class="hero dashboard-empty-hero">
    <span class="hero-orb" aria-hidden="true">◉</span>
    <p>{{ t.heroText }}</p>
    <div class="empty-actions">
      <RouterLink class="button primary" to="/settings#connectors">{{ t.connectTrainingSource }}</RouterLink>
    </div>
  </section>
  <section v-if="activeConnectedConnectors.length" class="card connector-card">
    <div class="card-heading">
      <div>
        <p class="eyebrow">{{ t.connectors }}</p>
        <h3>{{ t.syncAllConnectors }}</h3>
      </div>
      <span class="connection-dot"></span>
    </div>
    <button :disabled="connectorLoading" class="button primary" @click="syncConnectors">
      {{ connectorLoading ? t.syncingConnectors : t.syncConnectors }}
    </button>
  </section>
  <p v-else class="connector-empty-banner muted">
    <span>{{ t.noConnectedSource }}</span>
    <RouterLink class="button secondary connector-connect-button" to="/settings#connectors">
      {{ t.connectTrainingSource }}
    </RouterLink>
  </p>
  <section class="card ai-plan-card">
    <div class="credits-summary">
      <p class="eyebrow">{{ t.creditLabel }}</p>
      <strong class="metric">{{ credits }}</strong>
      <span class="muted">{{ t.creditPerPlan }}</span>
      <RouterLink class="button secondary credits-link" to="/pricing">{{ t.buyCredits }}</RouterLink>
    </div>
    <p class="eyebrow">{{ t.aiPlan }}</p>
    <p>{{ t.aiDescription }}</p>
    <label class="consent"
      ><input
        :checked="consent"
        type="checkbox"
        @change="emit('update:consent', ($event.target as HTMLInputElement).checked)"
      />{{ t.consent }}</label
    ><button :disabled="loading || !workouts.length" class="button primary full" @click="createPlan">
      {{ loading ? t.creatingPlan : t.createPlan }}
    </button>
    <div v-if="false && plan.days.length" class="plan">
      <div v-for="day in plan.days" :key="day.day">
        <strong>{{ day.day }}</strong
        ><span>{{ day.description }} · {{ day.total_duration_minutes }} min</span>
      </div>
    </div>
  </section>
    <section v-if="plan.days.length" class="card plan dashboard-plan">
      <div class="plan-heading">
        <div>
          <p class="eyebrow">{{ t.aiPlan }}</p>
          <h3>Deine Woche</h3>
        </div>
        <div class="plan-summary">
        <strong>{{ planMinutes }} min</strong>
        <span>{{ completedCount }}/{{ plan.days.length }} {{ t.planCompleted }}</span>
        </div>
      </div>
      <div v-if="plan.week_summary?.focus_title || plan.week_summary?.goal_description" class="week-summary rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3">
        <strong class="font-semibold text-emerald-600 dark:text-emerald-400">{{ plan.week_summary?.focus_title || 'Wochenfokus' }}</strong>
        <p v-if="plan.week_summary?.goal_description" class="text-xs italic text-zinc-600 dark:text-zinc-400">{{ plan.week_summary.goal_description }}</p>
      </div>
      <article v-for="(day, index) in plan.days" :key="`${day.day}-${index}`" class="plan-day" :class="{ completed: completedPlanDays.includes(day.day) }">
        <label class="plan-check">
          <input :checked="completedPlanDays.includes(day.day)" type="checkbox" @change="togglePlanDay(day.day)" />
          <span>
            <strong class="plan-day-name">{{ planDayLabel(day) }}</strong>
            <strong>{{ planDayLabel(day) }} · {{ planSportLabel(day) }} · {{ day.total_duration_minutes }} min</strong>
            <small>{{ day.target_focus }}</small>
          </span>
        </label>
        <div class="plan-day-meta">
          <span class="plan-sport">{{ planSportLabel(day) }}</span>
          <strong>{{ day.total_duration_minutes }} min</strong>
        </div>
        <p>{{ planDescription(day) }}</p>
        <ul v-if="day.session_type !== 'rest'" class="plan-steps">
          <li v-for="step in day.workout_steps" :key="`${day.day}-${step.step_duration}-${step.step_instruction}`">
            <strong class="plan-step-duration">{{ step.step_duration }}</strong>
            <span class="plan-step-intensity">{{ step.step_intensity }}</span>
            <span class="plan-step-instruction">{{ step.step_instruction }}</span>
            <strong>{{ step.step_duration }}</strong> Â· {{ step.step_intensity }} Â· {{ step.step_instruction }}
          </li>
        </ul>
      </article>
    </section>
  <section class="grid dashboard-grid">
    <article class="card">
      <p class="eyebrow">{{ t.history }}</p><!--
        <span aria-hidden="true">⌕</span
      --><ul class="workouts">
        <li v-for="workout in recentWorkouts.slice(0, 12)" :key="workout.id" class="workout-row">
          <SportIcon :sport="workout.sport" />
          <div>
            <strong>{{ formatWorkoutDate(workout.date) }}</strong
            ><span
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
          <strong>{{ formatWorkoutDate(week.weekStart) }}</strong
          ><span
            >{{ Number.isFinite(week.distanceKm) ? week.distanceKm.toFixed(1) : '–' }} km · {{ week.workoutCount }}
            {{ t.units }}</span
          ><i
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
