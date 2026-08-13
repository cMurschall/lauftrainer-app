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

const props = defineProps<{
  workouts: Workout[]
  plan: TrainingPlanDay[]
  config: UserConfig
  analysis: {
    totalDistanceKm: number
    totalDurationMinutes: number
    weekly: Array<{ weekStart: string; distanceKm: number; workoutCount: number }>
  }
  search: string
  message: string
  loading: boolean
  consent: boolean
  connectorLoading: boolean
  syncConnectors: () => void
  importFiles: (event: Event) => void
  createPlan: () => void
}>()
const emit = defineEmits<{ 'update:search': [value: string]; 'update:consent': [value: boolean] }>()
const { t } = useI18n()
const formatWorkoutDate = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) ? formatWeekLabel(value) : formatDateValue(value)
const filteredWorkouts = computed(() =>
  props.workouts
    .filter((workout) =>
      `${workout.name} ${workout.sport} ${workout.date}`.toLowerCase().includes(props.search.toLowerCase()),
    )
    .sort((a, b) => b.date.localeCompare(a.date)),
)
const strongestWeekDistance = computed(() =>
  Math.max(...props.analysis.weekly.map((week) => week.distanceKm).filter(Number.isFinite), 0),
)
</script>
<template>
  <div class="page-heading">
    <label class="button primary"
      >{{ t.importFiles }}<input accept=".csv,.json,.tcx,.gpx,.fit" multiple type="file" @change="importFiles"
    /></label>
  </div>
  <section v-if="!workouts.length" class="hero">
    <span class="hero-orb" aria-hidden="true">◉</span>
    <p>{{ t.heroText }}</p>
  </section>
  <p v-if="message" class="notice">{{ message }}</p>
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
    <div v-if="plan.length" class="plan">
      <div v-for="day in plan" :key="day.day">
        <strong>{{ day.day }}</strong
        ><span>{{ day.description }} · {{ day.total_duration_minutes }} min</span>
      </div>
    </div>
  </section>
  <section class="grid">
    <article class="card">
      <p class="eyebrow">{{ t.history }}</p>
      <div class="search-wrap">
        <span aria-hidden="true">⌕</span
        ><input
          :placeholder="t.search"
          :value="search"
          class="search"
          @input="emit('update:search', ($event.target as HTMLInputElement).value)"
        />
      </div>
      <ul class="workouts">
        <li v-for="workout in filteredWorkouts.slice(0, 12)" :key="workout.id" class="workout-row">
          <span class="sport-icon" aria-hidden="true">⌁</span>
          <div>
            <strong>{{ formatWorkoutDate(workout.date) }}</strong
            ><span
              >{{ formatSport(workout.sport) }} · {{ formatWorkoutDuration(workout.durationSeconds) }} ·
              {{ formatWorkoutDistance(workout.distanceKm) }}</span
            >
          </div>
        </li>
        <li v-if="!filteredWorkouts.length">{{ t.noWorkouts }}</li>
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
  <section class="card">
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
</template>
