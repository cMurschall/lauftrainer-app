<script lang="ts" setup>
import { computed, ref } from 'vue'
import { useI18n } from '../i18n'
import { type AnalysisResult, toDateKey } from '../analysis/analysisEngine'
import type { UserConfig, Workout } from '../types/workout'
import MiniChart from '../components/MiniChart.vue'
import { formatChartDate, formatSport, formatWorkoutDate } from '../utils/formatters'

const props = defineProps<{
  workouts: Workout[]
  config: UserConfig
  saveWorkout: (workout: Workout) => Promise<void>
  results: AnalysisResult | null
  isCalculating: boolean
  calculationError: string
  retryAnalysis: () => Promise<void>
}>()
const { t } = useI18n()
const range = ref(90)
const weeklyMetric = ref<'minutes' | 'distance'>('minutes')
const results = computed<AnalysisResult>(
  () =>
    props.results || { weekly: [], load: [], foster: [], fosterRpe: [], polarization: [], hrZones: [], efficiency: [], sports: [], triathlonGroups: [] },
)
const latest = computed(
  () =>
    props.workouts
      .map((w) => w.date)
      .map((x) => new Date(x.match(/^\d{2}-\d{2}-\d{4}$/) ? x.split('-').reverse().join('-') : x).getTime())
      .filter(Number.isFinite)
      .sort((a, b) => b - a)[0],
)
const cutoff = computed(() =>
  range.value === 0 || !latest.value ? '' : new Date(latest.value - range.value * 86400000).toISOString().slice(0, 10),
)

function inRange(date: string) {
  const key = toDateKey(date)
  return !cutoff.value || (!!key && key >= cutoff.value)
}

const weekly = computed(() => results.value.weekly.filter((x) => inRange(x.weekStart)))
const load = computed(() => results.value.load.filter((x) => inRange(x.date)))
const foster = computed(() => results.value.foster.filter((x) => inRange(x.weekStart)))
const polarization = computed(() => results.value.polarization.filter((x) => inRange(x.weekStart)))
const zones = computed(() => results.value.hrZones.filter((x) => inRange(x.weekStart)))
const efficiency = computed(() => results.value.efficiency.filter((x) => inRange(x.date)))
const efficiencyTrend = computed(() =>
  efficiency.value.map((_, index, values) => {
    const window = values.slice(Math.max(0, index - 9), index + 1)
    return window.reduce((sum, item) => sum + item.efficiency, 0) / window.length
  }),
)
const lastLoad = computed(() => [...load.value].at(-1))
const tsbContext = computed(() => (lastLoad.value && lastLoad.value.tsb < 0 ? t.value.tsbFatigue : t.value.tsbFresh))
const lastEfficiency = computed(() => efficiency.value.at(-1))
const rpeWorkouts = computed(() =>
  props.workouts
    .filter((w) => inRange(w.date))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 30),
)
const rpeFoster = computed(() => results.value.fosterRpe.filter((x) => inRange(x.weekStart)))
const weeklyChart = computed(() =>
  weeklyMetric.value === 'minutes'
    ? {
        unit: 'min',
        series: [
          { name: 'Total min', values: weekly.value.map((x) => x.totalMinutes), color: 'var(--accent)' },
          { name: 'Running min', values: weekly.value.map((x) => x.runningMinutes), color: 'var(--chart-blue)' },
          { name: 'Cycling min', values: weekly.value.map((x) => x.cyclingMinutes), color: 'var(--chart-gold)' },
        ],
      }
    : {
        unit: 'km',
        series: [
          { name: 'Running km', values: weekly.value.map((x) => x.runningDistanceKm), color: 'var(--chart-blue)' },
          { name: 'Cycling km', values: weekly.value.map((x) => x.cyclingDistanceKm), color: 'var(--chart-gold)' },
        ],
      },
)

function chartLabels(items: Array<{ weekStart?: string; date?: string }>) {
  return items.map((x) => formatChartDate(x.weekStart || x.date || ''))
}

async function saveRpe(workout: Workout, value: string) {
  const numeric = value === '' ? undefined : Number(value)
  if (numeric !== undefined && (!Number.isInteger(numeric) || numeric < 1 || numeric > 10)) return
  await props.saveWorkout({ ...workout, sessionRpe: numeric })
}
</script>
<template>
  <div v-if="isCalculating" class="card" role="status">Analyse wird berechnet …</div>
  <div v-if="calculationError" class="card" role="alert">
    {{ calculationError }} <button class="button secondary" @click="retryAnalysis">Erneut versuchen</button>
  </div>
  <div class="page-heading">
    <div>
      <p class="eyebrow">{{ t.analysisNav }}</p>
      <h1>{{ t.analysisTitle }}</h1>
      <p class="analysis-intro">{{ t.analysisIntro }}</p>
    </div>
    <div class="range-switch">
      <button
        v-for="item in [
          { value: 30, label: t.range30 },
          { value: 90, label: t.range90 },
          { value: 365, label: t.range365 },
          { value: 0, label: t.rangeAll },
        ]"
        :key="item.value"
        :class="range === item.value ? 'primary' : 'secondary'"
        class="button"
        @click="range = item.value"
      >
        {{ item.label }}
      </button>
    </div>
  </div>
  <section class="stats analysis-stats">
    <article class="card">
      <span>{{ t.ctl }}</span
      ><small>{{ t.ctlContext }}</small
      ><strong class="metric">{{ lastLoad ? lastLoad.ctl.toFixed(1) : '–' }}</strong>
    </article>
    <article class="card">
      <span>{{ t.atl }}</span
      ><small>{{ t.atlContext }}</small
      ><strong class="metric">{{ lastLoad ? lastLoad.atl.toFixed(1) : '–' }}</strong>
    </article>
    <article class="card">
      <span>{{ t.tsb }}</span
      ><small>{{ lastLoad ? tsbContext : t.tsbContext }}</small
      ><strong class="metric">{{ lastLoad ? lastLoad.tsb.toFixed(1) : '–' }}</strong>
    </article>
    <article class="card">
      <span>{{ t.acwr }}</span
      ><strong class="metric">{{ lastLoad?.acwr?.toFixed(2) || '–' }}</strong
      ><small v-if="lastLoad">{{ lastLoad.risk }} · {{ t.acwrContext }}</small>
    </article>
    <article class="card">
      <span>{{ t.trainingTime }}</span
      ><strong class="metric">{{ (weekly.reduce((sum, x) => sum + x.totalMinutes, 0) / 60).toFixed(1) }} h</strong
      ><small>{{ t.trainingTimeContext }}</small>
    </article>
    <article class="card">
      <span>{{ t.totalDistance }}</span
      ><strong class="metric"
        >{{ weekly.reduce((sum, x) => sum + x.runningDistanceKm + x.cyclingDistanceKm, 0).toFixed(1) }} km</strong
      ><small>{{ t.distanceContext }}</small>
    </article>
  </section>
  <section class="card">
    <div class="chart-heading">
      <p class="eyebrow">{{ t.weeklyLoad }}</p>
      <div class="chart-toggle">
        <button
          class="button"
          :class="weeklyMetric === 'minutes' ? 'primary' : 'secondary'"
          @click="weeklyMetric = 'minutes'"
        >
          MIN</button
        ><button
          class="button"
          :class="weeklyMetric === 'distance' ? 'primary' : 'secondary'"
          @click="weeklyMetric = 'distance'"
        >
          KM
        </button>
      </div>
    </div>
    <MiniChart
      v-if="weekly.length"
      :y-unit="weeklyChart.unit"
      :labels="chartLabels(weekly)"
      :series="weeklyChart.series"
    />
    <p v-if="!weekly.length">{{ t.noData }}</p>
  </section>
  <section v-if="results.sports.length" class="card">
    <p class="eyebrow">Sportarten</p>
    <div class="stats">
      <article v-for="sport in results.sports" :key="sport.sport" class="card">
        <span>{{ sport.sport }}</span>
        <strong class="metric">{{ sport.durationMinutes.toFixed(0) }} min</strong>
        <small>{{ sport.workoutCount }} Einheiten · {{ sport.distanceKm.toFixed(1) }} km<span v-if="sport.elevationGainM"> · {{ sport.elevationGainM.toFixed(0) }} m</span></small>
        <small v-if="sport.averagePowerW">Ø {{ sport.averagePowerW.toFixed(0) }} W</small>
        <small v-if="sport.swimmingDistanceM">{{ (sport.swimmingDistanceM / 1000).toFixed(2) }} km Schwimmen</small>
      </article>
    </div>
  </section>
  <section class="card">
    <p class="eyebrow">{{ t.loadChart }}</p>
    <MiniChart
      v-if="load.length"
      y-unit="load"
      :labels="chartLabels(load)"
      :series="[
        { name: 'CTL', values: load.map((x) => x.ctl), color: 'var(--accent)' },
        { name: 'ATL', values: load.map((x) => x.atl), color: 'var(--chart-gold)' },
        { name: 'TSB', values: load.map((x) => x.tsb), color: 'var(--chart-blue)' },
      ]"
    />
    <p v-else>{{ t.noHr }}</p>
  </section>
  <div class="analysis-grid">
    <section class="card">
      <p class="eyebrow">{{ t.foster }}</p>
      <MiniChart
        v-if="foster.length"
        y-unit="load"
        :labels="chartLabels(foster)"
        :series="[
          { name: 'Load', values: foster.map((x) => x.load), color: 'var(--accent)' },
          { name: 'Strain', values: foster.map((x) => x.strain), color: 'var(--chart-gold)' },
        ]"
      />
      <p v-else>{{ t.noData }}</p>
    </section>
    <section class="card">
      <p class="eyebrow">{{ t.polarization }}</p>
      <MiniChart
        v-if="polarization.length"
        y-unit="%"
        :labels="chartLabels(polarization)"
        :series="[
          { name: 'Z1 %', values: polarization.map((x) => x.z1Pct), color: 'var(--accent)' },
          { name: 'Z2 %', values: polarization.map((x) => x.z2Pct), color: 'var(--chart-gold)' },
          { name: 'Z3 %', values: polarization.map((x) => x.z3Pct), color: 'var(--chart-rose)' },
        ]"
      />
      <p v-else>{{ t.noHr }}</p>
    </section>
  </div>
  <section class="card">
    <p class="eyebrow">{{ t.hrDistribution }}</p>
    <div class="zone-legend">
      <span v-for="zone in ['Z1', 'Z2', 'Z3', 'Z4', 'Z5']" :key="zone"
        ><i :class="zone.toLowerCase()"></i>{{ zone }}</span
      >
    </div>
    <div v-if="zones.length" class="zone-bars">
      <div v-for="week in zones" :key="week.weekStart" class="zone-week">
        <small>{{ week.weekStart }}</small>
        <div class="stacked">
          <i
            v-for="(pct, index) in week.percentages"
            :key="index"
            :class="`z${index + 1}`"
            :style="{ width: `${pct}%` }"
          ></i>
        </div>
      </div>
    </div>
    <p v-else>{{ t.noHr }}</p>
  </section>
  <div class="analysis-grid">
    <section class="card">
      <p class="eyebrow">{{ t.efficiency }}</p>
      <MiniChart
        v-if="efficiency.length"
        y-unit="efficiency"
        :labels="chartLabels(efficiency)"
        :series="[
          { name: 'Workouts', values: efficiency.map((x) => x.efficiency), color: 'var(--accent)' },
          { name: '10-workout trend', values: efficiencyTrend, color: 'var(--chart-blue)' },
        ]"
      />
      <p v-else>{{ t.noData }}</p>
    </section>
    <section class="card">
      <p class="eyebrow">{{ t.fosterRpe }}</p>
      <MiniChart
        v-if="rpeFoster.length"
        y-unit="load"
        :labels="chartLabels(rpeFoster)"
        :series="[
          { name: 'Load', values: rpeFoster.map((x) => x.load), color: 'var(--chart-blue)' },
          { name: 'Strain', values: rpeFoster.map((x) => x.strain), color: 'var(--chart-gold)' },
        ]"
      />
      <p v-else>{{ t.missingRpe }}</p>
    </section>
  </div>
  <section class="card">
    <p class="eyebrow">{{ t.rpe }}</p>
    <div class="rpe-list">
      <label v-for="workout in rpeWorkouts" :key="workout.id"
        ><span>{{ formatWorkoutDate(workout.date) }} · {{ formatSport(workout.sport) }}</span
        ><span class="rpe-control"
          ><input
          :aria-label="`${t.rpe}: ${formatWorkoutDate(workout.date)}`"
          :value="workout.sessionRpe ?? 5"
          max="10"
          min="1"
          step="1"
          type="range"
          @change="saveRpe(workout, ($event.target as HTMLInputElement).value)"
        /><output>{{ workout.sessionRpe ?? '–' }}</output></span></label>
    </div>
  </section>
</template>
