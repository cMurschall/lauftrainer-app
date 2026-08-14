<script lang="ts" setup>
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from '../i18n'
import { type AnalysisResult, toDateKey } from '../analysis/analysisEngine'
import type { Workout } from '../types/workout'
import MiniChart from '../components/MiniChart.vue'
import ChartHelp from '../components/ChartHelp.vue'
import { formatChartDate, formatWorkoutDate } from '../utils/formatters'
import { useWorkoutStore } from '../stores/workouts'
import { useAnalysisStore } from '../stores/analysis'

const workoutsStore = useWorkoutStore()
const analysisStore = useAnalysisStore()
const { summaries } = storeToRefs(workoutsStore)
const { analysisResult, isCalculating, calculationError } = storeToRefs(analysisStore)

const { locale, t } = useI18n()
const range = ref(90)
const weeklyMetric = ref<'minutes' | 'distance'>('minutes')
const results = computed<AnalysisResult>(
  () =>
    analysisResult.value || {
      weekly: [],
      load: [],
      foster: [],
      fosterRpe: [],
      polarization: [],
      hrZones: [],
      efficiency: [],
      sports: [],
      triathlonGroups: [],
    },
)
const latest = computed(
  () =>
    summaries.value
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
const acwrPoints = computed(() => load.value.filter((x) => x.acwr != null && Number.isFinite(x.acwr)))
const lastFoster = computed(() => [...foster.value].at(-1))
const fosterHighRisk = computed(() => {
  const week = lastFoster.value
  return Boolean(week && week.monotony != null && week.strain != null && week.monotony > 2 && week.strain > 400)
})
const rpeWorkouts = computed(() =>
  summaries.value
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
          { name: t.value.totalMinutes, values: weekly.value.map((x) => x.totalMinutes), color: 'var(--accent)' },
          { name: t.value.runningMinutes, values: weekly.value.map((x) => x.runningMinutes), color: 'var(--chart-blue)' },
          { name: t.value.cyclingMinutes, values: weekly.value.map((x) => x.cyclingMinutes), color: 'var(--chart-gold)' },
        ],
      }
    : {
        unit: 'km',
        series: [
          { name: t.value.runningDistance, values: weekly.value.map((x) => x.runningDistanceKm), color: 'var(--chart-blue)' },
          { name: t.value.cyclingDistance, values: weekly.value.map((x) => x.cyclingDistanceKm), color: 'var(--chart-gold)' },
        ],
      },
)
const fosterSeries = computed(() => [
  {
    name: t.value.load,
    values: foster.value.map((x) => x.load),
    color: 'var(--accent)',
    type: 'bar' as const,
  },
  {
    name: t.value.monotony,
    values: foster.value.map((x) => (x.monotony == null ? null : x.monotony)),
    color: 'var(--muted)',
    type: 'line' as const,
    borderDash: [4, 4],
    pointRadius: 0,
  },
  {
    name: t.value.strain,
    values: foster.value.map((x) => (x.strain == null ? null : x.strain)),
    color: 'var(--chart-gold)',
    type: 'line' as const,
    axis: 'right' as const,
    pointRadius: 2,
  },
])
const polarizationSeries = computed(() => [
  { name: t.value.zone1, values: polarization.value.map((x) => x.z1Pct), color: '#10B981', type: 'bar' as const },
  { name: t.value.zone2, values: polarization.value.map((x) => x.z2Pct), color: '#F59E0B', type: 'bar' as const },
  { name: t.value.zone3, values: polarization.value.map((x) => x.z3Pct), color: '#EF4444', type: 'bar' as const },
  {
    name: t.value.polarizationIndex,
    values: polarization.value.map((x) => (x.polarizationIndex == null ? null : x.polarizationIndex)),
    color: 'var(--text)',
    type: 'line' as const,
    axis: 'right' as const,
    borderDash: [5, 4],
    pointRadius: 2,
    borderWidth: 2,
  },
])

function chartLabels(items: Array<{ weekStart?: string; date?: string }>) {
  return items.map((x) => formatChartDate(x.weekStart || x.date || '', locale.value === 'de' ? 'de-DE' : 'en-US'))
}

function localizedSport(value: string) {
  const labels: Record<string, string> = {
    Running: t.value.running,
    Cycling: t.value.cycling,
    Swimming: t.value.swimming,
    Hiking: t.value.hiking,
    Walking: t.value.walking,
    Triathlon: t.value.triathlon,
    Other: t.value.other,
  }
  return labels[value] || value
}

async function saveRpe(workout: Workout, value: string) {
  const numeric = value === '' ? undefined : Number(value)
  if (numeric !== undefined && (!Number.isInteger(numeric) || numeric < 1 || numeric > 10)) return
  const full = workoutsStore.workouts.find((item) => item.id === workout.id) || workout
  await workoutsStore.saveWorkout({ ...full, sessionRpe: numeric })
  analysisStore.scheduleAnalysisRefresh()
}
</script>
<template>
  <div class="analysis-view">
    <div v-if="isCalculating" class="card" role="status">{{ t.analysisCalculating }}</div>
    <div v-if="calculationError" class="card" role="alert">
      {{ calculationError }}
      <button class="button secondary" @click="analysisStore.refreshAnalysis()">{{ t.retryAnalysis }}</button>
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
          :aria-pressed="range === item.value"
          :class="range === item.value ? 'primary' : 'secondary'"
          class="button"
          type="button"
          @click="range = item.value"
        >
          {{ item.label }}
        </button>
      </div>
    </div>
    <section class="stats analysis-stats">
      <article class="card">
        <span>{{ t.ctl }}</span>
        <small>{{ t.ctlContext }}</small>
        <strong class="metric">{{ lastLoad ? lastLoad.ctl.toFixed(1) : '–' }}</strong>
      </article>
      <article class="card">
        <span>{{ t.atl }}</span>
        <small>{{ t.atlContext }}</small>
        <strong class="metric">{{ lastLoad ? lastLoad.atl.toFixed(1) : '–' }}</strong>
      </article>
      <article class="card">
        <span>{{ t.tsb }}</span>
        <small>{{ lastLoad ? tsbContext : t.tsbContext }}</small>
        <strong class="metric">{{ lastLoad ? lastLoad.tsb.toFixed(1) : '–' }}</strong>
      </article>
      <article class="card">
        <span>{{ t.acwr }}</span>
        <strong class="metric">{{ lastLoad?.acwr?.toFixed(2) || '–' }}</strong>
        <small v-if="lastLoad">{{ lastLoad.risk }} · {{ t.acwrContext }}</small>
      </article>
      <article class="card">
        <span>{{ t.trainingTime }}</span>
        <strong class="metric">{{ (weekly.reduce((sum, x) => sum + x.totalMinutes, 0) / 60).toFixed(1) }} h</strong>
        <small>{{ t.trainingTimeContext }}</small>
      </article>
      <article class="card">
        <span>{{ t.totalDistance }}</span>
        <strong class="metric"
          >{{ weekly.reduce((sum, x) => sum + x.runningDistanceKm + x.cyclingDistanceKm, 0).toFixed(1) }} km</strong
        >
        <small>{{ t.distanceContext }}</small>
      </article>
    </section>
    <section class="card analysis-chart-card">
      <div class="chart-heading">
        <p class="eyebrow">{{ t.weeklyLoad }}</p>
        <div class="chart-toggle">
          <button
            class="button"
            type="button"
            :class="weeklyMetric === 'minutes' ? 'primary' : 'secondary'"
            @click="weeklyMetric = 'minutes'"
          >
            {{ t.minutesShort }}
          </button>
          <button
            class="button"
            type="button"
            :class="weeklyMetric === 'distance' ? 'primary' : 'secondary'"
            @click="weeklyMetric = 'distance'"
          >
            {{ t.kilometersShort }}
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
      <ChartHelp :summary="t.chartHelpSummary" :paragraphs="t.helpWeekly" />
    </section>
    <section v-if="results.sports.length" class="card sports-card">
      <p class="eyebrow">{{ t.sports }}</p>
      <div class="stats">
        <article v-for="sport in results.sports" :key="sport.sport" class="card">
          <span>{{ localizedSport(sport.sport) }}</span>
          <strong class="metric">{{ sport.durationMinutes.toFixed(0) }} min</strong>
          <small
            >{{ sport.workoutCount }} {{ t.workoutsLabel }} · {{ sport.distanceKm.toFixed(1) }} km<span
              v-if="sport.elevationGainM"
            >
              · {{ sport.elevationGainM.toFixed(0) }} m</span
            ></small
          >
          <small v-if="sport.averagePowerW">Ø {{ sport.averagePowerW.toFixed(0) }} W</small>
          <small v-if="sport.swimmingDistanceM"
            >{{ (sport.swimmingDistanceM / 1000).toFixed(2) }} km {{ t.swimming }}</small
          >
        </article>
      </div>
    </section>
    <section class="card analysis-chart-card">
      <p class="eyebrow">{{ t.loadChart }}</p>
      <MiniChart
        v-if="load.length"
        :dynamic-y="true"
        :include-zero="true"
        y-unit="load"
        :max-ticks-limit="8"
        :labels="chartLabels(load)"
        :reference-lines="[{ y: 0, color: 'var(--muted)', dash: [4, 4] }]"
        :series="[
          { name: t.ctl, values: load.map((x) => x.ctl), color: 'var(--accent)' },
          { name: t.atl, values: load.map((x) => x.atl), color: 'var(--chart-gold)' },
          { name: t.tsb, values: load.map((x) => x.tsb), color: 'var(--chart-blue)' },
        ]"
      />
      <p v-else>{{ t.noHr }}</p>
      <ChartHelp :summary="t.chartHelpSummary" :paragraphs="t.helpLoad" />
    </section>
    <section class="card analysis-chart-card">
      <p class="eyebrow">{{ t.acwrChart }}</p>
      <MiniChart
        v-if="acwrPoints.length"
        y-unit="acwr"
        :max-ticks-limit="8"
        :labels="chartLabels(acwrPoints)"
        :bands="[
          { yMin: 0, yMax: 0.8, color: 'rgba(185, 140, 242, 0.12)' },
          { yMin: 0.8, yMax: 1.3, color: 'rgba(16, 185, 129, 0.16)' },
          { yMin: 1.3, yMax: 3, color: 'rgba(239, 68, 68, 0.1)' },
        ]"
        :reference-lines="[
          { y: 0.8, color: 'var(--muted)', dash: [3, 3] },
          { y: 1.3, color: 'var(--muted)', dash: [3, 3] },
        ]"
        :series="[
          {
            name: t.acwr,
            values: acwrPoints.map((x) => x.acwr as number),
            color: 'var(--accent)',
            pointRadius: 2,
            borderWidth: 2,
          },
        ]"
      />
      <p v-else>{{ t.noData }}</p>
      <ChartHelp :summary="t.chartHelpSummary" :paragraphs="t.helpAcwr" />
    </section>
    <div class="analysis-grid analysis-chart-grid">
      <section class="card analysis-chart-card">
        <p class="eyebrow">{{ t.foster }}</p>
        <MiniChart
          v-if="foster.length"
          type="bar"
          y-unit="load"
          right-y-unit="strain"
          :labels="chartLabels(foster)"
          :series="fosterSeries"
        />
        <p v-else>{{ t.noData }}</p>
        <p v-if="fosterHighRisk" class="chart-help-risk" role="status">{{ t.fosterHighRisk }}</p>
        <ChartHelp :summary="t.chartHelpSummary" :paragraphs="t.helpFoster" />
      </section>
      <section class="card analysis-chart-card">
        <p class="eyebrow">{{ t.polarization }}</p>
        <MiniChart
          v-if="polarization.length"
          type="bar"
          :stacked="true"
          y-unit="%"
          right-y-unit="idx"
          :labels="chartLabels(polarization)"
          :series="polarizationSeries"
        />
        <p v-else>{{ t.noHr }}</p>
        <ChartHelp :summary="t.chartHelpSummary" :paragraphs="t.helpPolarization" />
      </section>
    </div>
    <section class="card analysis-chart-card">
      <p class="eyebrow">{{ t.hrDistribution }}</p>
      <div class="zone-legend">
        <span v-for="zone in ['Z1', 'Z2', 'Z3', 'Z4', 'Z5']" :key="zone"
          ><i :class="zone.toLowerCase()"></i>{{ zone }}</span
        >
      </div>
      <div v-if="zones.length" class="zone-bars">
        <div v-for="week in zones" :key="week.weekStart" class="zone-week">
          <small>{{ formatChartDate(week.weekStart, locale === 'de' ? 'de-DE' : 'en-US') }}</small>
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
      <ChartHelp :summary="t.chartHelpSummary" :paragraphs="t.helpHrZones" />
    </section>
    <div class="analysis-grid analysis-chart-grid">
      <section class="card analysis-chart-card">
        <p class="eyebrow">{{ t.efficiency }}</p>
        <MiniChart
          v-if="efficiency.length"
          :dynamic-y="true"
          y-unit="efficiency"
          :labels="chartLabels(efficiency)"
          :series="[
            {
              name: t.workoutsLabel,
              values: efficiency.map((x) => x.efficiency),
              color: 'var(--accent)',
              pointRadius: 3,
              showLine: false,
              borderWidth: 0,
            },
            {
              name: t.efficiencyTrend,
              values: efficiencyTrend,
              color: 'var(--chart-blue)',
              pointRadius: 0,
              borderWidth: 3,
            },
          ]"
        />
        <p v-else>{{ t.noData }}</p>
        <ChartHelp :summary="t.chartHelpSummary" :paragraphs="t.helpEfficiency" />
      </section>
      <section class="card analysis-chart-card">
        <p class="eyebrow">{{ t.fosterRpe }}</p>
        <MiniChart
          v-if="rpeFoster.length"
          type="bar"
          y-unit="load"
          right-y-unit="strain"
          :labels="chartLabels(rpeFoster)"
          :series="[
            {
              name: t.load,
              values: rpeFoster.map((x) => x.load),
              color: 'var(--chart-blue)',
              type: 'bar',
            },
            {
              name: t.strain,
              values: rpeFoster.map((x) => (x.strain == null ? null : x.strain)),
              color: 'var(--chart-gold)',
              type: 'line',
              axis: 'right',
              pointRadius: 2,
            },
          ]"
        />
        <p v-else>{{ t.missingRpe }}</p>
      </section>
    </div>
    <section class="card analysis-chart-card">
      <p class="eyebrow">{{ t.rpe }}</p>
      <div class="rpe-list">
        <label v-for="workout in rpeWorkouts" :key="workout.id"
          ><span>{{ formatWorkoutDate(workout.date) }} · {{ localizedSport(workout.sport) }}</span
          ><span class="rpe-control"
            ><input
              :aria-label="`${t.rpe}: ${formatWorkoutDate(workout.date)}`"
              :value="workout.sessionRpe ?? 5"
              max="10"
              min="1"
              step="1"
              type="range"
              @change="saveRpe(workout as Workout, ($event.target as HTMLInputElement).value)"
            /><output>{{ workout.sessionRpe ?? '–' }}</output></span
          ></label
        >
      </div>
    </section>
  </div>
</template>
