<script lang="ts" setup>
import { computed } from 'vue'
import { useI18n } from '../i18n'
import type { TrainingPlanDay, UserConfig, Workout } from '../types/workout'
import {
  formatSport,
  formatWeekLabel,
  formatWorkoutDate as formatDateValue,
  formatWorkoutDistance,
  formatWorkoutDuration,
} from '../utils/formatters'
import { workoutIdentity } from '../services/workoutIdentity'

const props = defineProps<{
  workouts: Workout[]
  plan: TrainingPlanDay[]
  completedPlanDays: string[]
  config: UserConfig
  analysis: {
    totalDistanceKm: number
    totalDurationMinutes: number
    weekly: Array<{ weekStart: string; distanceKm: number; workoutCount: number }>
  }
  message: string
  loading: boolean
  consent: boolean
  connectorLoading: boolean
  syncConnectors: () => void
  importFiles: (event: Event) => void
  importProgress: { active: boolean; current: number; total: number; fileName: string; failed: number }
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
const planMinutes = computed(() => props.plan.reduce((sum, day) => sum + day.total_duration_minutes, 0))
const completedCount = computed(() => props.plan.filter((day) => props.completedPlanDays.includes(day.day)).length)
</script>
<template>
  <section v-if="!workouts.length" class="hero">
    <span class="hero-orb" aria-hidden="true">◉</span>
    <p>{{ t.heroText }}</p>
  </section>
  <p v-if="message" class="notice">{{ message }}</p>
  <section class="card connector-card">
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
  <section class="stats">
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
  <section class="card ai-plan-card">
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
    <div v-if="false && plan.length" class="plan">
      <div v-for="day in plan" :key="day.day">
        <strong>{{ day.day }}</strong
        ><span>{{ day.description }} · {{ day.total_duration_minutes }} min</span>
      </div>
    </div>
  </section>
    <div v-if="plan.length" class="plan">
      <div class="plan-summary">
        <strong>{{ planMinutes }} min</strong>
        <span>{{ completedCount }}/{{ plan.length }} {{ t.planCompleted }}</span>
      </div>
      <article v-for="(day, index) in plan" :key="`${day.day}-${index}`" class="plan-day" :class="{ completed: completedPlanDays.includes(day.day) }">
        <label class="plan-check">
          <input :checked="completedPlanDays.includes(day.day)" type="checkbox" @change="togglePlanDay(day.day)" />
          <span>
            <strong>{{ day.day }} Â· {{ day.sport }} Â· {{ day.total_duration_minutes }} min</strong>
            <small>{{ day.target_focus }}</small>
          </span>
        </label>
        <p>{{ day.description }}</p>
        <ul class="plan-steps">
          <li v-for="step in day.workout_steps" :key="`${day.day}-${step.step_duration}-${step.step_instruction}`">
            <strong>{{ step.step_duration }}</strong> Â· {{ step.step_intensity }} Â· {{ step.step_instruction }}
          </li>
        </ul>
      </article>
    </div>
  <section class="grid">
    <article class="card">
      <p class="eyebrow">{{ t.history }}</p><!--
        <span aria-hidden="true">⌕</span
      --><ul class="workouts">
        <li v-for="workout in recentWorkouts.slice(0, 12)" :key="workout.id" class="workout-row">
          <span class="sport-icon" aria-hidden="true">⌁</span>
          <div>
            <strong>{{ formatWorkoutDate(workout.date) }}</strong
            ><span
              >{{ formatSport(workout.sport) }} · {{ formatWorkoutDuration(workout.durationSeconds) }} ·
              {{ formatWorkoutDistance(workout.distanceKm) }}</span
            >
            <details v-if="showWorkoutDebug" class="workout-debug">
              <summary>Debug-Details</summary>
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
  <section class="card import-card">
    <div class="card-heading">
      <div>
        <p class="eyebrow">{{ t.localUpload }}</p>
        <h3>{{ t.importFiles }}</h3>
      </div>
    </div>
    <label class="button secondary"
      >{{ t.importFiles }}<input
        :disabled="importProgress.active"
        accept=".csv,.json,.tcx,.gpx,.fit"
        multiple
        type="file"
        @change="importFiles"
    /></label>
    <div v-if="importProgress.active" class="import-progress" aria-live="polite" aria-busy="true">
      <div class="card-heading">
        <p class="eyebrow">{{ t.importProgressLabel }}</p>
        <strong>{{ importProgress.current }} / {{ importProgress.total }}</strong>
      </div>
      <progress :max="importProgress.total" :value="importProgress.current"></progress>
      <small>{{ importProgress.fileName }}</small>
    </div>
  </section>
</template>
