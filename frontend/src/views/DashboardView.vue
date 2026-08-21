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
  connectorBannerKind,
  shouldWarnPolarStravaOverlap,
  sportKind,
  weeklyTrend,
  type WeeklyTrendEntry,
} from '../utils/dashboardUi'
import WorkoutMap from '../components/WorkoutMap.vue'
import PageHeader from '../components/PageHeader.vue'
import {
  hasMapTilesUrl,
  type LonLat,
  type RouteColorMode,
  type RoutePoint,
  routeHasBasemapCoverage,
  routePointsFromRecords,
} from '../services/mapTiles'

const workouts = useWorkoutStore()
const planStore = usePlanStore()
const settings = useSettingsStore()
const analysisStore = useAnalysisStore()
const ui = useUiStore()

const { summaries } = storeToRefs(workouts)
const { plan, completedPlanDates } = storeToRefs(planStore)
const { connectors } = storeToRefs(settings)
const { analysis } = storeToRefs(analysisStore)
const { connectorLoading } = storeToRefs(ui)

const { t, locale } = useI18n()
const showWorkoutDebug = import.meta.env.DEV && localStorage.getItem('lauftrainer-debug') === '1'
const DEFAULT_ACTIVITY_FIT = 6
const sortedActivities = computed(() => [...summaries.value].sort((a, b) => b.date.localeCompare(a.date)))
const activityFit = ref(DEFAULT_ACTIVITY_FIT)
const recentActivities = computed(() => sortedActivities.value.slice(0, Math.max(1, activityFit.value)))
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

  const row = list.querySelector<HTMLElement>('.activity-row:not(.is-expanded)')
  let rowHeight = row?.getBoundingClientRect().height ?? 0
  if (rowHeight <= 0) {
    const anyRow = list.querySelector<HTMLElement>('.activity-row')
    rowHeight = anyRow?.getBoundingClientRect().height ?? 50
    if (anyRow?.classList.contains('is-expanded')) {
      rowHeight = 50
    }
  }

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

const enlargedMapId = ref<string | null>(null)
const closeEnlargedMapOnEscape = (event: KeyboardEvent) => {
  if (event.key === 'Escape') enlargedMapId.value = null
}

let activityFitObserver: ResizeObserver | undefined
onMounted(() => {
  if (typeof ResizeObserver !== 'undefined') {
    activityFitObserver = new ResizeObserver(scheduleActivityFit)
    if (trendContentRef.value) activityFitObserver.observe(trendContentRef.value)
    if (activitiesCardRef.value) activityFitObserver.observe(activitiesCardRef.value)
  }
  window.addEventListener('resize', scheduleActivityFit)
  window.addEventListener('keydown', closeEnlargedMapOnEscape)
  scheduleActivityFit()
})
onBeforeUnmount(() => {
  activityFitObserver?.disconnect()
  window.removeEventListener('resize', scheduleActivityFit)
  window.removeEventListener('keydown', closeEnlargedMapOnEscape)
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

const hasPlan = computed(() => plan.value.days.length > 0)
const todayDateStr = localDateKey()
const todayWorkout = computed(() => plan.value.days.find((day) => day.date === todayDateStr))

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

const planSportLabel = (day: TrainingPlanDay) => {
  if (day.session_type === 'rest') return t.value.restDay
  if (day.sport_label?.trim()) return day.sport_label.trim()
  return t.value[day.sport]
}

const isPlanDayCompleted = (day: TrainingPlanDay) => Boolean(day.date && completedPlanDates.value.includes(day.date))

const activeConnectedConnectors = computed(() =>
  connectors.value.filter((connector) => connector.active && connector.connected),
)
const bannerKind = computed(() =>
  connectorBannerKind({
    hasWorkouts: summaries.value.length > 0,
    hasActiveConnected: activeConnectedConnectors.value.length > 0,
  }),
)

const expandedActivityId = ref<string | null>(null)

const mapConsentOpen = ref(false)
let mapConsentResolver: ((allowed: boolean) => void) | null = null

const enlargedWorkout = computed(() =>
  enlargedMapId.value ? summaries.value.find((workout) => workout.id === enlargedMapId.value) || null : null,
)

function askMapDetailsConsent(): Promise<boolean> {
  if (mapConsentOpen.value) {
    return new Promise((resolve) => {
      const previous = mapConsentResolver
      mapConsentResolver = (allowed) => {
        previous?.(false)
        resolve(allowed)
      }
    })
  }
  mapConsentOpen.value = true
  return new Promise((resolve) => {
    mapConsentResolver = resolve
  })
}

async function resolveMapDetailsConsent(allowed: boolean) {
  mapConsentOpen.value = false
  const resolver = mapConsentResolver
  mapConsentResolver = null
  await settings.updateMapDetailsConsent(allowed ? 'allowed' : 'denied')
  resolver?.(allowed)
}

function workoutRouteCoordinates(workoutId: string): LonLat[] {
  return workoutRoutePoints(workoutId).map((point) => [point.longitude, point.latitude])
}

function workoutRoutePoints(workoutId: string): RoutePoint[] {
  const workoutObj = workouts.workouts.find((w) => w.id === workoutId)
  return routePointsFromRecords(workoutObj?.records)
}

const mapColorModeById = ref<Record<string, RouteColorMode>>({})

function mapColorMode(workoutId: string): RouteColorMode | undefined {
  return mapColorModeById.value[workoutId]
}

function setMapColorMode(workoutId: string, mode: RouteColorMode) {
  mapColorModeById.value = { ...mapColorModeById.value, [workoutId]: mode }
}

function hasRouteMap(workoutId: string): boolean {
  return workoutRoutePoints(workoutId).length >= 2
}

/** Visible in the PWA: what stream fields this workout actually stores. */
function workoutTrackDataLabel(workoutId: string): string {
  const records = workouts.workouts.find((workout) => workout.id === workoutId)?.records || []
  if (!records.length) return ''
  const gpsCount = records.filter(
    (record) => Number.isFinite(record.latitude) && Number.isFinite(record.longitude),
  ).length
  const hasHr = records.some((record) => Number.isFinite(record.heartRateBpm))
  const hasPace = records.some((record) => Number.isFinite(record.speedKmh))
  const parts: string[] = []
  if (gpsCount >= 2) parts.push(t.value.trackDataGps(gpsCount))
  else parts.push(t.value.trackDataMetricsOnly)
  if (hasHr) parts.push(t.value.trackDataHr)
  if (hasPace) parts.push(t.value.trackDataPace)
  return parts.join(' · ')
}

function showBasemapFor(workoutId: string): boolean {
  if (settings.mapDetailsConsent !== 'allowed') return false
  if (!hasMapTilesUrl()) return false
  return routeHasBasemapCoverage(workoutRouteCoordinates(workoutId))
}

const mapPlaceNames = ref<Record<string, string>>({})

function mapPlaceLabel(workoutId: string): string {
  return mapPlaceNames.value[workoutId] || t.value.mapRouteFallback
}

function onMapPlaceName(workoutId: string, name: string) {
  if (!name || mapPlaceNames.value[workoutId] === name) return
  mapPlaceNames.value = { ...mapPlaceNames.value, [workoutId]: name }
}

function mapDetailsHint(workoutId: string): string {
  if (settings.mapDetailsConsent === 'denied') return t.value.mapDetailsDisabled
  if (settings.mapDetailsConsent !== 'allowed') return ''
  if (!hasMapTilesUrl()) return t.value.mapDetailsUnavailable
  if (!routeHasBasemapCoverage(workoutRouteCoordinates(workoutId))) return t.value.mapDetailsOutsideCoverage
  return ''
}

async function prepareMapConsent(workoutId: string) {
  if (!hasRouteMap(workoutId)) return
  if (settings.mapDetailsConsent !== 'unset') return
  await askMapDetailsConsent()
}

async function toggleActivityExpand(id: string) {
  if (expandedActivityId.value === id) {
    expandedActivityId.value = null
  } else {
    expandedActivityId.value = id
    await prepareMapConsent(id)
  }
}

function formatPace(secondsPerKm: number | undefined): string {
  if (!secondsPerKm || !Number.isFinite(secondsPerKm)) return '–'
  const min = Math.floor(secondsPerKm / 60)
  const sec = Math.round(secondsPerKm % 60)
  return `${min}:${String(sec).padStart(2, '0')} min/km`
}

async function updateWorkoutRpe(workoutSummary: (typeof summaries.value)[number], rpe: number) {
  const workoutObj = workouts.workouts.find((w) => w.id === workoutSummary.id)
  if (!workoutObj) return
  await workouts.saveWorkout({ ...workoutObj, sessionRpe: rpe })
  analysisStore.scheduleAnalysisRefresh()
}
</script>

<template>
  <div
    v-if="mapConsentOpen"
    class="modal-backdrop"
    role="dialog"
    aria-modal="true"
    :aria-label="t.mapDetailsConsentTitle"
  >
    <div class="modal-card">
      <strong>{{ t.mapDetailsConsentTitle }}</strong>
      <p class="muted">
        {{ t.mapDetailsConsentBody }}
        <RouterLink to="/datenschutz">{{ t.mapDetailsConsentPrivacyLink }}</RouterLink>
      </p>
      <div class="modal-actions">
        <button class="button secondary" type="button" @click="resolveMapDetailsConsent(false)">
          {{ t.mapDetailsConsentDeny }}
        </button>
        <button class="button primary" type="button" @click="resolveMapDetailsConsent(true)">
          {{ t.mapDetailsConsentAllow }}
        </button>
      </div>
    </div>
  </div>
  <div
    v-if="enlargedWorkout && hasRouteMap(enlargedWorkout.id)"
    class="modal-backdrop"
    role="dialog"
    aria-modal="true"
    :aria-label="mapPlaceLabel(enlargedWorkout.id)"
    @click="enlargedMapId = null"
  >
    <div class="modal-card modal-card-wide" @click.stop>
      <div class="map-modal-head">
        <strong>{{ mapPlaceLabel(enlargedWorkout.id) }}</strong>
        <span class="muted"
          >{{ formatSport(enlargedWorkout.sport) }} · {{ formatActivityDate(enlargedWorkout.date, locale) }}</span
        >
        <button class="button secondary" type="button" :aria-label="t.mapClose" @click="enlargedMapId = null">×</button>
      </div>
      <div class="map-modal-canvas">
        <WorkoutMap
          :points="workoutRoutePoints(enlargedWorkout.id)"
          :show-basemap="showBasemapFor(enlargedWorkout.id)"
          :color-mode="mapColorMode(enlargedWorkout.id)"
          interactive
          @place-name="(name) => enlargedWorkout && onMapPlaceName(enlargedWorkout.id, name)"
          @update:color-mode="(mode) => enlargedWorkout && setMapColorMode(enlargedWorkout.id, mode)"
        />
      </div>
    </div>
  </div>
  <PageHeader :label="t.dashboard" :meta="t.dashboardIntro" />
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

    <!-- Today's Workout widget -->
    <section v-if="todayWorkout" class="card plan dashboard-plan">
      <div class="plan-heading">
        <div class="plan-heading-title">
          <h3>{{ t.todayWorkout }}</h3>
          <span class="plan-badge">{{ t.aiPlanBadge }}</span>
        </div>
        <div class="plan-summary">
          <strong>{{ todayWorkout.total_duration_minutes }} min</strong>
        </div>
      </div>
      <article
        class="plan-day"
        :class="{ completed: isPlanDayCompleted(todayWorkout) }"
        style="border: 0; padding: 0; margin: 0; box-shadow: none"
      >
        <label class="plan-check">
          <input
            :checked="isPlanDayCompleted(todayWorkout)"
            type="checkbox"
            @change="planStore.togglePlanDate(todayWorkout.date)"
          />
          <span>
            <strong class="plan-day-name">{{ planSportLabel(todayWorkout) }}</strong>
            <small>{{ todayWorkout.target_focus }}</small>
          </span>
        </label>
        <p>{{ planDescription(todayWorkout) }}</p>
      </article>
      <div class="empty-actions" style="margin-top: 14px; display: flex; gap: 8px">
        <RouterLink
          class="button secondary"
          to="/training"
          style="font-size: 0.78rem; padding: 6px 12px; min-height: auto"
        >
          {{ t.trainingNav }} →
        </RouterLink>
      </div>
    </section>

    <section class="grid dashboard-grid">
      <article ref="activitiesCardRef" class="card">
        <p class="eyebrow">{{ t.recentActivities }}</p>
        <ul ref="activitiesListRef" class="activities">
          <li
            v-for="workout in recentActivities"
            :key="workout.id"
            class="activity-row"
            :class="{ 'is-expanded': expandedActivityId === workout.id }"
            style="flex-direction: column; align-items: stretch; cursor: pointer; padding: 10px 0"
            @click="toggleActivityExpand(workout.id)"
          >
            <div style="display: flex; align-items: stretch; gap: 12px; width: 100%">
              <span class="activity-accent" :class="`accent-${sportKind(workout.sport)}`" aria-hidden="true"></span>
              <div style="flex: 1; min-width: 0">
                <div style="display: flex; justify-content: space-between; align-items: center">
                  <strong style="color: var(--text); font-weight: 550; font-size: 0.85rem"
                    >{{ formatSport(workout.sport) }} · {{ formatActivityDate(workout.date, locale) }}</strong
                  >
                  <span style="font-size: 0.72rem; color: var(--muted); padding-right: 4px">{{
                    expandedActivityId === workout.id ? '▲' : '▼'
                  }}</span>
                </div>
                <span style="display: block; margin-top: 3px; color: var(--muted); font-size: 0.78rem">{{
                  activityMeta(workout)
                }}</span>
              </div>
            </div>

            <!-- Details slide-down view -->
            <div
              v-if="expandedActivityId === workout.id"
              style="
                margin-top: 12px;
                padding: 12px;
                border-radius: 8px;
                background: var(--surface-raised);
                border: 1px solid var(--border);
                display: flex;
                flex-direction: column;
                gap: 12px;
                cursor: default;
              "
              @click.stop
            >
              <!-- Details stats, then full-width route map -->
              <div style="display: flex; flex-direction: column; gap: 14px">
                <!-- Details stats grid -->
                <div
                  style="
                    display: grid;
                    grid-template-columns: repeat(2, minmax(0, 1fr));
                    gap: 10px;
                    font-size: 0.8rem;
                    color: var(--text);
                  "
                >
                  <div v-if="workout.distanceKm" style="display: flex; flex-direction: column; gap: 1px">
                    <span
                      style="
                        color: var(--muted);
                        font-size: 0.72rem;
                        font-weight: 550;
                        text-transform: uppercase;
                        letter-spacing: 0.3px;
                      "
                      >{{ t.totalDistance }}</span
                    >
                    <strong style="font-size: 1.05rem; font-weight: 600; color: var(--text)">{{
                      formatWorkoutDistance(workout.distanceKm)
                    }}</strong>
                  </div>
                  <div style="display: flex; flex-direction: column; gap: 1px">
                    <span
                      style="
                        color: var(--muted);
                        font-size: 0.72rem;
                        font-weight: 550;
                        text-transform: uppercase;
                        letter-spacing: 0.3px;
                      "
                      >{{ t.trainingTime }}</span
                    >
                    <strong style="font-size: 1.05rem; font-weight: 600; color: var(--text)">{{
                      formatWorkoutDuration(workout.durationSeconds)
                    }}</strong>
                  </div>
                  <div v-if="workout.averagePaceSecondsPerKm" style="display: flex; flex-direction: column; gap: 1px">
                    <span
                      style="
                        color: var(--muted);
                        font-size: 0.72rem;
                        font-weight: 550;
                        text-transform: uppercase;
                        letter-spacing: 0.3px;
                      "
                      >Pace (Ø)</span
                    >
                    <strong style="font-size: 1.05rem; font-weight: 600; color: var(--text)">{{
                      formatPace(workout.averagePaceSecondsPerKm)
                    }}</strong>
                  </div>
                  <div v-if="workout.averageHeartRate" style="display: flex; flex-direction: column; gap: 1px">
                    <span
                      style="
                        color: var(--muted);
                        font-size: 0.72rem;
                        font-weight: 550;
                        text-transform: uppercase;
                        letter-spacing: 0.3px;
                      "
                      >Puls (Ø)</span
                    >
                    <strong style="font-size: 1.05rem; font-weight: 600; color: var(--text)"
                      >{{ Math.round(workout.averageHeartRate) }} bpm</strong
                    >
                  </div>
                  <div v-if="workout.calories" style="display: flex; flex-direction: column; gap: 1px">
                    <span
                      style="
                        color: var(--muted);
                        font-size: 0.72rem;
                        font-weight: 550;
                        text-transform: uppercase;
                        letter-spacing: 0.3px;
                      "
                      >Kalorien</span
                    >
                    <strong style="font-size: 1.05rem; font-weight: 600; color: var(--text)"
                      >{{ workout.calories }} kcal</strong
                    >
                  </div>
                  <div
                    v-if="workout.elevationGainM || workout.ascentM"
                    style="display: flex; flex-direction: column; gap: 1px"
                  >
                    <span
                      style="
                        color: var(--muted);
                        font-size: 0.72rem;
                        font-weight: 550;
                        text-transform: uppercase;
                        letter-spacing: 0.3px;
                      "
                      >Höhenmeter</span
                    >
                    <strong style="font-size: 1.05rem; font-weight: 600; color: var(--text)"
                      >{{ Math.round(workout.elevationGainM || workout.ascentM || 0) }} hm ↑</strong
                    >
                  </div>
                  <div v-if="workout.averagePowerW" style="display: flex; flex-direction: column; gap: 1px">
                    <span
                      style="
                        color: var(--muted);
                        font-size: 0.72rem;
                        font-weight: 550;
                        text-transform: uppercase;
                        letter-spacing: 0.3px;
                      "
                      >Leistung (Ø)</span
                    >
                    <strong style="font-size: 1.05rem; font-weight: 600; color: var(--text)"
                      >{{ Math.round(workout.averagePowerW) }} W</strong
                    >
                  </div>
                  <div style="display: flex; flex-direction: column; gap: 1px">
                    <span
                      style="
                        color: var(--muted);
                        font-size: 0.72rem;
                        font-weight: 550;
                        text-transform: uppercase;
                        letter-spacing: 0.3px;
                      "
                      >Quelle / Typ</span
                    >
                    <strong
                      style="font-size: 1.05rem; font-weight: 600; color: var(--text); text-transform: uppercase"
                      >{{ workout.source }}</strong
                    >
                  </div>
                </div>

                <!-- Full-width route map under stats -->
                <div v-if="hasRouteMap(workout.id)" class="activity-route-map">
                  <span
                    class="activity-route-map-label"
                    :style="{ textTransform: mapPlaceNames[workout.id] ? 'none' : 'uppercase' }"
                    >{{ mapPlaceLabel(workout.id) }}</span
                  >
                  <span v-if="mapDetailsHint(workout.id)" class="activity-route-map-hint">{{
                    mapDetailsHint(workout.id)
                  }}</span>
                  <div class="map-zoom-trigger">
                    <WorkoutMap
                      :points="workoutRoutePoints(workout.id)"
                      :show-basemap="showBasemapFor(workout.id)"
                      :color-mode="mapColorMode(workout.id)"
                      @place-name="(name) => onMapPlaceName(workout.id, name)"
                      @update:color-mode="(mode) => setMapColorMode(workout.id, mode)"
                    />
                    <button
                      type="button"
                      class="map-enlarge-hit"
                      :aria-label="t.mapEnlarge"
                      :title="t.mapEnlarge"
                      @click.stop="enlargedMapId = workout.id"
                    />
                  </div>
                  <p v-if="workoutTrackDataLabel(workout.id)" class="activity-route-map-data muted">
                    {{ workoutTrackDataLabel(workout.id) }}
                  </p>
                </div>
                <p v-else class="activity-route-map-missing muted">
                  {{ workoutTrackDataLabel(workout.id) || t.mapNoGpsTrack }}
                </p>
              </div>

              <!-- RPE Rating -->
              <div
                style="
                  border-top: 1px solid var(--border);
                  padding-top: 10px;
                  display: flex;
                  flex-direction: column;
                  gap: 6px;
                "
              >
                <div style="display: flex; justify-content: space-between; align-items: center">
                  <span style="font-size: 0.76rem; font-weight: 550; color: var(--muted)">{{ t.rpe }}</span>
                  <span v-if="workout.sessionRpe" style="font-size: 0.76rem; font-weight: 600; color: var(--accent)"
                    >{{ workout.sessionRpe }}/10</span
                  >
                </div>
                <div style="display: flex; gap: 4px; flex-wrap: wrap">
                  <button
                    v-for="rpe in 10"
                    :key="rpe"
                    type="button"
                    style="
                      flex: 1;
                      min-width: 24px;
                      height: 28px;
                      font-size: 0.74rem;
                      border-radius: 6px;
                      border: 1px solid var(--border);
                      background: var(--surface);
                      color: var(--text);
                      cursor: pointer;
                      transition: all 0.15s ease;
                      display: flex;
                      align-items: center;
                      justify-content: center;
                    "
                    :style="
                      workout.sessionRpe === rpe
                        ? 'background: var(--accent); color: white; border-color: var(--accent); font-weight: bold;'
                        : ''
                    "
                    @click="updateWorkoutRpe(workout, rpe)"
                  >
                    {{ rpe }}
                  </button>
                </div>
              </div>

              <!-- Debug details inline -->
              <details v-if="showWorkoutDebug" class="workout-debug" style="margin-top: 4px">
                <summary style="font-size: 0.74rem; color: var(--muted)">{{ t.debugDetails }}</summary>
                <code
                  style="
                    display: block;
                    font-size: 0.72rem;
                    line-height: 1.4;
                    padding: 6px;
                    background: var(--surface);
                    border-radius: 4px;
                    margin-top: 4px;
                    overflow-x: auto;
                    color: var(--text);
                  "
                  >{{ JSON.stringify(workoutDebug(workout), null, 2) }}</code
                >
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
                <strong>{{
                  week.isCurrentWeek ? t.thisWeek : t.weekFrom(formatWeekStartShort(week.weekStart, locale))
                }}</strong>
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
</template>
