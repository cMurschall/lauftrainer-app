<script lang="ts" setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from '../i18n'
import type { MapContext, TrainingPlanDay } from '../types/workout'
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
import { workoutDb } from '../db/database'
import {
  type BoundingBox,
  boundingBoxFromRecords,
  buildSeaPolygons,
  completeMapContext,
  fetchMapContext,
  findCoveringAreaKey,
  formatBbox,
  hasMapDetails,
  isClosedRing,
  MAP_CONTEXT_KEY_PREFIX,
  type MapContextProgress,
  mapContextCacheKey,
  quantizeBox,
} from '../services/mapContextService'
import {
  averageWeeklyMinutes,
  connectorBannerKind,
  shouldWarnPolarStravaOverlap,
  sportKind,
  weeklyTrend,
  type WeeklyTrendEntry,
} from '../utils/dashboardUi'
import RouteMap, { type RouteMapLayers } from '../components/RouteMap.vue'

const workouts = useWorkoutStore()
const planStore = usePlanStore()
const settings = useSettingsStore()
const analysisStore = useAnalysisStore()
const ui = useUiStore()

const { summaries } = storeToRefs(workouts)
const { plan, completedPlanDates } = storeToRefs(planStore)
const { connectors } = storeToRefs(settings)
const { analysis } = storeToRefs(analysisStore)
const { notification, connectorLoading } = storeToRefs(ui)

const { t, locale } = useI18n()
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

const mapContexts = ref<Record<string, MapContext>>({})
const mapContextFailed = ref<Record<string, boolean>>({})
const mapContextLoading = ref<Record<string, boolean>>({})
const mapConsentOpen = ref(false)
let mapConsentResolver: ((allowed: boolean) => void) | null = null

/** In-flight Overpass requests by area, so workouts nearby share one round trip. */
const areaRequests = new Map<string, Promise<MapContext>>()

/** Projected SVG paths per workout; only a new context invalidates an entry. */
const mapPathCache = new Map<string, RouteMapLayers | null>()

function setMapContext(workoutId: string, context: MapContext) {
  mapContexts.value[workoutId] = context
  mapPathCache.delete(workoutId)
}

const enlargedMapId = ref<string | null>(null)
const enlargedWorkout = computed(() =>
  enlargedMapId.value ? summaries.value.find((workout) => workout.id === enlargedMapId.value) || null : null,
)

// TEMP map diagnostics — remove this flag, mapDiagnostics, traceMap, layerCount
// and the diagnostics line in the template once mobile map loading is verified.
const SHOW_MAP_DIAGNOSTICS = true
const mapDiagnostics = ref<Record<string, string[]>>({})
const isOnline = ref(typeof navigator === 'undefined' ? true : navigator.onLine)
const updateOnlineState = () => {
  isOnline.value = navigator.onLine
}
const closeEnlargedMapOnEscape = (event: KeyboardEvent) => {
  if (event.key === 'Escape') enlargedMapId.value = null
}
onMounted(() => {
  window.addEventListener('online', updateOnlineState)
  window.addEventListener('offline', updateOnlineState)
  window.addEventListener('keydown', closeEnlargedMapOnEscape)
  // A cached area can weigh a megabyte, so reclaim what an older parser wrote.
  void workoutDb.pruneMapContexts(MAP_CONTEXT_KEY_PREFIX)
})
onBeforeUnmount(() => {
  window.removeEventListener('online', updateOnlineState)
  window.removeEventListener('offline', updateOnlineState)
  window.removeEventListener('keydown', closeEnlargedMapOnEscape)
})

function traceMap(workoutId: string, message: string) {
  if (!SHOW_MAP_DIAGNOSTICS) return
  const time = new Date().toLocaleTimeString(undefined, { hour12: false })
  mapDiagnostics.value[workoutId] = [...(mapDiagnostics.value[workoutId] || []), `${time} ${message}`].slice(-14)
}

function layerCount(context: Partial<MapContext> | null | undefined): string {
  const size = (layer?: unknown[]) => layer?.length || 0
  return [
    `hw ${size(context?.highways)}`,
    `wa ${size(context?.waterAreas)}`,
    `co ${size(context?.coastlines)}`,
    `re ${size(context?.residential)}`,
    `fo ${size(context?.forests)}`,
  ].join(' · ')
}

/** TEMP: dumps the sea/area geometry decisions for one preview into the console. */
function logMapGeometry(workoutId: string) {
  if (!SHOW_MAP_DIAGNOSTICS) return
  const context = mapContexts.value[workoutId]
  const debug: string[] = []
  const paths = getMapContextPaths(workoutId, debug)
  console.groupCollapsed(`[map] ${workoutId} ${mapPlaceLabel(workoutId)} — ${layerCount(context)}`)
  for (const line of debug) console.info(line)
  console.info('Pfade', {
    sea: paths?.sea.length ?? 0,
    waterAreas: paths?.waterAreas.length ?? 0,
    coastlines: paths?.coastlines.length ?? 0,
  })
  console.info('Rohdaten', context)
  console.groupEnd()
}

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

function mapPlaceLabel(workoutId: string): string {
  return mapContexts.value[workoutId]?.placeName || t.value.mapRouteFallback
}

function mapDetailsHint(workoutId: string): string {
  if (mapContextFailed.value[workoutId]) return t.value.mapDetailsUnavailable
  if (settings.mapDetailsConsent === 'denied' && !mapContexts.value[workoutId]) return t.value.mapDetailsDisabled
  return ''
}

/**
 * A cached area counts as a hit when it covers the route we need. Pass the
 * padded route box here — not the quantized fetch box — otherwise a slightly
 * larger neighbour run never reuses a perfectly good cached area.
 */
async function loadCachedArea(cacheKey: string, routeBox: BoundingBox) {
  const keys = await workoutDb.listMapContextKeys()
  const exact = await workoutDb.getMapContext(cacheKey)
  if (hasMapDetails(exact)) {
    return { context: exact as MapContext, bbox: cacheKey.slice(MAP_CONTEXT_KEY_PREFIX.length), how: 'exakt' as const }
  }

  const covering = findCoveringAreaKey(keys, routeBox)
  if (!covering) {
    return { context: null, bbox: '', how: 'miss' as const, keyCount: keys.length }
  }
  const context = await workoutDb.getMapContext(covering)
  if (!hasMapDetails(context)) {
    return { context: null, bbox: '', how: 'miss' as const, keyCount: keys.length }
  }
  return {
    context: context as MapContext,
    bbox: covering.slice(MAP_CONTEXT_KEY_PREFIX.length),
    how: 'überdeckend' as const,
    keyCount: keys.length,
  }
}

function traceProgress(workoutId: string) {
  return ({ endpoint, attempt, total, durationMs, status, error, phase }: MapContextProgress) => {
    const tag = phase === 'streets' ? 'Wohnstraßen ' : ''
    if (durationMs === undefined) traceMap(workoutId, `${tag}Versuch ${attempt}/${total}: ${endpoint}`)
    else if (error) traceMap(workoutId, `${tag}${endpoint} fehlgeschlagen nach ${durationMs} ms — ${error}`)
    else traceMap(workoutId, `${tag}${endpoint} antwortete ${status} nach ${durationMs} ms`)
  }
}

/**
 * A cached rural area can be missing its residential streets when Overpass was
 * unreachable at the time. Fill that in now instead of keeping the gap forever.
 */
async function completeCachedStreets(workoutId: string, areaBbox: string, context: MapContext) {
  if (!context.streetsPending) return
  if (settings.mapDetailsConsent !== 'allowed') return

  traceMap(workoutId, 'Wohnstraßen fehlen im Cache — werden nachgeladen')
  const gained = await completeMapContext(areaBbox, context, { onProgress: traceProgress(workoutId) })
  if (!gained) return

  // A fresh object, so the reactive assignment actually re-renders the preview.
  const merged = { ...context }
  setMapContext(workoutId, merged)
  await workoutDb.saveMapContext(mapContextCacheKey(areaBbox), merged)
  traceMap(workoutId, `Wohnstraßen ergänzt (${layerCount(merged)})`)
  logMapGeometry(workoutId)
}

async function loadMapContextForWorkout(workoutId: string, force = false) {
  if (mapContextLoading.value[workoutId]) return
  if (mapContexts.value[workoutId] && !force) {
    traceMap(workoutId, `bereits geladen (${layerCount(mapContexts.value[workoutId])})`)
    return
  }
  if (mapContextFailed.value[workoutId] && !force) {
    traceMap(workoutId, 'zuvor fehlgeschlagen, kein neuer Versuch in dieser Sitzung')
    return
  }

  const workoutObj = workouts.workouts.find((w) => w.id === workoutId)
  if (!workoutObj?.records) {
    traceMap(workoutId, 'keine Records im Store (Workout nicht vollständig geladen)')
    return
  }

  const box = boundingBoxFromRecords(workoutObj.records)
  if (!box) {
    traceMap(workoutId, `keine Bounding-Box: ${workoutObj.records.length} Records ohne GPS`)
    return
  }

  const area = quantizeBox(box)
  const bbox = formatBbox(area)
  const cacheKey = mapContextCacheKey(bbox)
  const startedAt = Date.now()

  // Claimed before the first await: the cache read and the consent dialog are
  // both async, and a second call must not slip past into a duplicate request.
  mapContextLoading.value[workoutId] = true
  mapContextFailed.value[workoutId] = false
  try {
    const cached = force ? null : await loadCachedArea(cacheKey, box)
    if (cached?.context) {
      setMapContext(workoutId, cached.context)
      traceMap(
        workoutId,
        `Cache-Treffer (${cached.how}), Gebiet ${cached.bbox} (${layerCount(cached.context)}${cached.context.placeName ? ` · Ort ${cached.context.placeName}` : ''})`,
      )
      logMapGeometry(workoutId)
      await completeCachedStreets(workoutId, cached.bbox, cached.context)
      return
    }
    if (force) traceMap(workoutId, 'manueller Neuversuch, lokaler Cache übersprungen')
    else {
      const keyCount = cached?.keyCount ?? 0
      traceMap(
        workoutId,
        `Cache-Miss für ${bbox} (${keyCount} Gebiet${keyCount === 1 ? '' : 'e'} in IndexedDB)`,
      )
    }

    let consent = settings.mapDetailsConsent
    if (consent === 'unset') {
      traceMap(workoutId, 'warte auf Zustimmung')
      const allowed = await askMapDetailsConsent()
      consent = allowed ? 'allowed' : 'denied'
    }
    if (consent === 'denied') {
      traceMap(workoutId, 'Zustimmung: nie laden (Einstellungen → Kartendetails)')
      return
    }

    // Two workouts from the same area must not race each other onto Overpass.
    const pending = areaRequests.get(cacheKey)
    if (pending) traceMap(workoutId, `wartet auf laufende Abfrage für Gebiet ${bbox}`)
    else traceMap(workoutId, `Overpass-Abfrage Gebiet ${bbox}`)

    const request =
      pending ||
      fetchMapContext(bbox, { onProgress: traceProgress(workoutId) }).finally(() => areaRequests.delete(cacheKey))
    areaRequests.set(cacheKey, request)

    const context = await request
    setMapContext(workoutId, context)
    traceMap(workoutId, `fertig nach ${Date.now() - startedAt} ms (${layerCount(context)}${context.placeName ? ` · Ort ${context.placeName}` : ''})`)
    logMapGeometry(workoutId)

    // Empty answers must not be cached: hasMapDetails would reject them on the
    // next open and we would hammer Overpass for the same miss forever.
    if (!hasMapDetails(context)) {
      traceMap(workoutId, 'Antwort ohne Zeichenflächen — nicht in IndexedDB gespeichert')
      return
    }

    try {
      await workoutDb.saveMapContext(cacheKey, context)
      const verify = await workoutDb.getMapContext(cacheKey)
      if (!hasMapDetails(verify)) {
        traceMap(workoutId, `IndexedDB-Schreiben fehlgeschlagen für ${cacheKey}`)
      } else {
        const stats = await workoutDb.getMapContextStats()
        traceMap(
          workoutId,
          `IndexedDB gespeichert (${stats.areaCount} Gebiete · ca. ${Math.max(1, Math.round(stats.approxBytes / 1024))} KB)`,
        )
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      traceMap(workoutId, `IndexedDB-Fehler: ${detail}`)
    }
  } catch (error) {
    // Overpass throttles heavily; keep the route visible and flag the missing layers.
    mapContextFailed.value[workoutId] = true
    const detail = error instanceof Error ? error.message : String(error)
    traceMap(workoutId, `Abbruch nach ${Date.now() - startedAt} ms — ${detail}`)
    console.error('Failed to load map context:', error)
  } finally {
    mapContextLoading.value[workoutId] = false
  }
}

async function toggleActivityExpand(id: string) {
  if (expandedActivityId.value === id) {
    expandedActivityId.value = null
  } else {
    expandedActivityId.value = id
    // Load map context on-demand
    await loadMapContextForWorkout(id)
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
  if (workoutObj) {
    workoutObj.sessionRpe = rpe
    await workouts.saveWorkout(workoutObj)
  }
}

function getRouteSvgPath(workoutId: string) {
  const workoutObj = workouts.workouts.find((w) => w.id === workoutId)
  if (!workoutObj || !workoutObj.records) return null

  const gpsRecords = workoutObj.records.filter(
    (r) => r.latitude !== undefined && r.longitude !== undefined,
  )
  if (gpsRecords.length < 2) return null

  let minLat = Infinity, maxLat = -Infinity
  let minLng = Infinity, maxLng = -Infinity

  for (const r of gpsRecords) {
    if (r.latitude! < minLat) minLat = r.latitude!
    if (r.latitude! > maxLat) maxLat = r.latitude!
    if (r.longitude! < minLng) minLng = r.longitude!
    if (r.longitude! > maxLng) maxLng = r.longitude!
  }

  const latRange = maxLat - minLat
  const lngRange = maxLng - minLng
  if (latRange === 0 && lngRange === 0) return null

  const midLatRad = ((minLat + maxLat) / 2) * (Math.PI / 180)
  const lngScale = Math.cos(midLatRad)
  const adjustedLngRange = lngRange * lngScale

  const padding = 15
  const width = 240
  const height = 150
  const innerWidth = width - 2 * padding
  const innerHeight = height - 2 * padding

  const scale = Math.min(innerWidth / (adjustedLngRange || 1), innerHeight / (latRange || 1))

  const xOffset = padding + (innerWidth - (lngRange * lngScale * scale)) / 2
  const yOffset = padding + (innerHeight - (latRange * scale)) / 2

  const path = gpsRecords
    .map((r, index) => {
      const x = xOffset + (r.longitude! - minLng) * lngScale * scale
      const y = height - (yOffset + (r.latitude! - minLat) * scale)
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`
    })
    .join(' ')

  return path
  }

  /**
   * The template calls this on every render, and rebuilding the sea polygons each
   * time is wasteful, so results are memoised until the context itself changes.
   * A debug run is never cached: it exists to observe the computation.
   */
  function getMapContextPaths(workoutId: string, debug?: string[]) {
  if (!debug && mapPathCache.has(workoutId)) return mapPathCache.get(workoutId)!
  const paths = buildMapContextPaths(workoutId, debug)
  if (!debug) mapPathCache.set(workoutId, paths)
  return paths
  }

  function buildMapContextPaths(workoutId: string, debug?: string[]) {
  const context = mapContexts.value[workoutId]
  if (!context) return null

  const workoutObj = workouts.workouts.find((w) => w.id === workoutId)
  if (!workoutObj || !workoutObj.records) return null

  const gpsRecords = workoutObj.records.filter(
    (r) => r.latitude !== undefined && r.longitude !== undefined,
  )
  if (gpsRecords.length < 2) return null

  let minLat = Infinity, maxLat = -Infinity
  let minLng = Infinity, maxLng = -Infinity

  for (const r of gpsRecords) {
    if (r.latitude! < minLat) minLat = r.latitude!
    if (r.latitude! > maxLat) maxLat = r.latitude!
    if (r.longitude! < minLng) minLng = r.longitude!
    if (r.longitude! > maxLng) maxLng = r.longitude!
  }

  const latRange = maxLat - minLat
  const lngRange = maxLng - minLng
  if (latRange === 0 && lngRange === 0) return null

  const midLatRad = ((minLat + maxLat) / 2) * (Math.PI / 180)
  const lngScale = Math.cos(midLatRad)
  const adjustedLngRange = lngRange * lngScale

  const padding = 15
  const width = 240
  const height = 150
  const innerWidth = width - 2 * padding
  const innerHeight = height - 2 * padding

  const scale = Math.min(innerWidth / (adjustedLngRange || 1), innerHeight / (latRange || 1))

  const xOffset = padding + (innerWidth - (lngRange * lngScale * scale)) / 2
  const yOffset = padding + (innerHeight - (latRange * scale)) / 2

  const projectPoint = (lon: number, lat: number): [number, number] => [
    xOffset + (lon - minLng) * lngScale * scale,
    height - (yOffset + (lat - minLat) * scale),
  ]

  const projectCoords = (coords: number[][], close: boolean = false) => {
    if (coords.length === 0) return ''
    const path = coords
      .map(([lon, lat], index) => {
        const [x, y] = projectPoint(lon, lat)
        return `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`
      })
      .join(' ')
    return close ? `${path} Z` : path
  }

  const polygonToPath = (polygon: [number, number][]): string =>
    `M ${polygon.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L ')} Z`

  const seaPaths = buildSeaPolygons(
    (context.coastlines || []).map((coords) => coords.map(([lon, lat]) => projectPoint(lon, lat))),
    width,
    height,
    debug,
  ).map(polygonToPath)

  const closedWaterAreas = (context.waterAreas || []).filter(isClosedRing)
  debug?.push(
    `waterAreas=${(context.waterAreas || []).length}, davon geschlossen=${closedWaterAreas.length}`,
  )

  const waterAreasPaths = closedWaterAreas
    .map(coords => projectCoords(coords, true))
    .filter(Boolean)

  const highwaysPaths = (context.highways || [])
    .map(coords => projectCoords(coords))
    .filter(Boolean)

  const coastlinesPaths = (context.coastlines || [])
    .map(coords => projectCoords(coords))
    .filter(Boolean)

  const residentialPaths = (context.residential || [])
    .map(coords => projectCoords(coords, true))
    .filter(Boolean)

  const forestsPaths = (context.forests || [])
    .map(coords => projectCoords(coords, true))
    .filter(Boolean)

  return {
    waterAreas: waterAreasPaths,
    sea: seaPaths,
    highways: highwaysPaths,
    coastlines: coastlinesPaths,
    residential: residentialPaths,
    forests: forestsPaths,
  }
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
    v-if="enlargedWorkout && getRouteSvgPath(enlargedWorkout.id)"
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
        <RouteMap
          :route-path="getRouteSvgPath(enlargedWorkout.id)!"
          :layers="getMapContextPaths(enlargedWorkout.id)"
          :route-width="1.6"
        />
      </div>
    </div>
  </div>
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
        style="border: 0; padding: 0; margin: 0; box-shadow: none;"
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
      <div class="empty-actions" style="margin-top: 14px; display: flex; gap: 8px;">
        <RouterLink class="button secondary" to="/training" style="font-size: 0.78rem; padding: 6px 12px; min-height: auto;">
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
            style="flex-direction: column; align-items: stretch; cursor: pointer; padding: 10px 0;"
            @click="toggleActivityExpand(workout.id)"
          >
            <div style="display: flex; align-items: stretch; gap: 12px; width: 100%;">
              <span class="activity-accent" :class="`accent-${sportKind(workout.sport)}`" aria-hidden="true"></span>
              <div style="flex: 1; min-width: 0;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                  <strong style="color: var(--text); font-weight: 550; font-size: 0.85rem;">{{ formatSport(workout.sport) }} · {{ formatActivityDate(workout.date, locale) }}</strong>
                  <span style="font-size: 0.72rem; color: var(--muted); padding-right: 4px;">{{ expandedActivityId === workout.id ? '▲' : '▼' }}</span>
                </div>
                <span style="display: block; margin-top: 3px; color: var(--muted); font-size: 0.78rem;">{{ activityMeta(workout) }}</span>
              </div>
            </div>

            <!-- Details slide-down view -->
            <div
              v-if="expandedActivityId === workout.id"
              style="margin-top: 12px; padding: 12px; border-radius: 8px; background: var(--surface-raised); border: 1px solid var(--border); display: flex; flex-direction: column; gap: 12px; cursor: default;"
              @click.stop
            >
              <!-- Details stats grid & Route Silhouette side-by-side -->
              <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px;">
                <!-- Details stats grid -->
                <div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; font-size: 0.8rem; color: var(--text);">
                  <div v-if="workout.distanceKm" style="display: flex; flex-direction: column; gap: 1px;">
                    <span style="color: var(--muted); font-size: 0.72rem; font-weight: 550; text-transform: uppercase; letter-spacing: 0.3px;">{{ t.totalDistance }}</span>
                    <strong style="font-size: 1.05rem; font-weight: 600; color: var(--text);">{{ formatWorkoutDistance(workout.distanceKm) }}</strong>
                  </div>
                  <div style="display: flex; flex-direction: column; gap: 1px;">
                    <span style="color: var(--muted); font-size: 0.72rem; font-weight: 550; text-transform: uppercase; letter-spacing: 0.3px;">{{ t.trainingTime }}</span>
                    <strong style="font-size: 1.05rem; font-weight: 600; color: var(--text);">{{ formatWorkoutDuration(workout.durationSeconds) }}</strong>
                  </div>
                  <div v-if="workout.averagePaceSecondsPerKm" style="display: flex; flex-direction: column; gap: 1px;">
                    <span style="color: var(--muted); font-size: 0.72rem; font-weight: 550; text-transform: uppercase; letter-spacing: 0.3px;">Pace (Ø)</span>
                    <strong style="font-size: 1.05rem; font-weight: 600; color: var(--text);">{{ formatPace(workout.averagePaceSecondsPerKm) }}</strong>
                  </div>
                  <div v-if="workout.averageHeartRate" style="display: flex; flex-direction: column; gap: 1px;">
                    <span style="color: var(--muted); font-size: 0.72rem; font-weight: 550; text-transform: uppercase; letter-spacing: 0.3px;">Puls (Ø)</span>
                    <strong style="font-size: 1.05rem; font-weight: 600; color: var(--text);">{{ Math.round(workout.averageHeartRate) }} bpm</strong>
                  </div>
                  <div v-if="workout.calories" style="display: flex; flex-direction: column; gap: 1px;">
                    <span style="color: var(--muted); font-size: 0.72rem; font-weight: 550; text-transform: uppercase; letter-spacing: 0.3px;">Kalorien</span>
                    <strong style="font-size: 1.05rem; font-weight: 600; color: var(--text);">{{ workout.calories }} kcal</strong>
                  </div>
                  <div v-if="workout.elevationGainM || workout.ascentM" style="display: flex; flex-direction: column; gap: 1px;">
                    <span style="color: var(--muted); font-size: 0.72rem; font-weight: 550; text-transform: uppercase; letter-spacing: 0.3px;">Höhenmeter</span>
                    <strong style="font-size: 1.05rem; font-weight: 600; color: var(--text);">{{ Math.round(workout.elevationGainM || workout.ascentM || 0) }} hm ↑</strong>
                  </div>
                  <div v-if="workout.averagePowerW" style="display: flex; flex-direction: column; gap: 1px;">
                    <span style="color: var(--muted); font-size: 0.72rem; font-weight: 550; text-transform: uppercase; letter-spacing: 0.3px;">Leistung (Ø)</span>
                    <strong style="font-size: 1.05rem; font-weight: 600; color: var(--text);">{{ Math.round(workout.averagePowerW) }} W</strong>
                  </div>
                  <div style="display: flex; flex-direction: column; gap: 1px;">
                    <span style="color: var(--muted); font-size: 0.72rem; font-weight: 550; text-transform: uppercase; letter-spacing: 0.3px;">Quelle / Typ</span>
                    <strong style="font-size: 1.05rem; font-weight: 600; color: var(--text); text-transform: uppercase;">{{ workout.source }}</strong>
                  </div>
                </div>

                <!-- Right Column: Route Map (SVG) -->
                <div v-if="getRouteSvgPath(workout.id)" style="display: flex; flex-direction: column; gap: 4px; background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 8px; position: relative; justify-content: center; align-items: center;">
                  <span
                    style="position: absolute; top: 6px; left: 8px; color: var(--muted); font-size: 0.65rem; font-weight: 550; letter-spacing: 0.3px; pointer-events: none; max-width: 70%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
                    :style="{ textTransform: mapContexts[workout.id]?.placeName ? 'none' : 'uppercase' }"
                    >{{ mapPlaceLabel(workout.id) }}</span
                  >
                  <span
                    v-if="mapDetailsHint(workout.id)"
                    style="position: absolute; top: 6px; right: 8px; color: var(--subtle); font-size: 0.62rem; font-weight: 550; pointer-events: none;"
                    >{{ mapDetailsHint(workout.id) }}</span
                  >
                  <button
                    type="button"
                    class="map-zoom-trigger"
                    :aria-label="t.mapEnlarge"
                    :title="t.mapEnlarge"
                    @click.stop="enlargedMapId = workout.id"
                  >
                    <RouteMap :route-path="getRouteSvgPath(workout.id)!" :layers="getMapContextPaths(workout.id)" />
                  </button>
                  <!-- TEMP map diagnostics — remove this block together with SHOW_MAP_DIAGNOSTICS. -->
                  <div
                    v-if="SHOW_MAP_DIAGNOSTICS"
                    style="width: 100%; border-top: 1px solid var(--border); padding-top: 6px; display: flex; flex-direction: column; gap: 2px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.6rem; line-height: 1.35; color: var(--muted); word-break: break-word; user-select: text;"
                  >
                    <span
                      >consent={{ settings.mapDetailsConsent }} · online={{ isOnline }} · layers={{
                        layerCount(mapContexts[workout.id])
                      }}</span
                    >
                    <span v-for="(line, lIdx) in mapDiagnostics[workout.id] || []" :key="`d-${workout.id}-${lIdx}`">{{
                      line
                    }}</span>
                    <span v-if="!(mapDiagnostics[workout.id] || []).length">keine Kartenschritte protokolliert</span>
                    <button
                      type="button"
                      :disabled="mapContextLoading[workout.id]"
                      style="align-self: flex-start; margin-top: 4px; padding: 4px 10px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface-raised); color: var(--text); font-size: 0.62rem; font-family: inherit;"
                      @click.stop="loadMapContextForWorkout(workout.id, true)"
                    >
                      {{ mapContextLoading[workout.id] ? 'lädt …' : 'Kartendetails neu laden' }}
                    </button>
                  </div>
                </div>
              </div>

              <!-- RPE Rating -->
              <div style="border-top: 1px solid var(--border); padding-top: 10px; display: flex; flex-direction: column; gap: 6px;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                  <span style="font-size: 0.76rem; font-weight: 550; color: var(--muted);">{{ t.rpe }}</span>
                  <span v-if="workout.sessionRpe" style="font-size: 0.76rem; font-weight: 600; color: var(--accent);">{{ workout.sessionRpe }}/10</span>
                </div>
                <div style="display: flex; gap: 4px; flex-wrap: wrap;">
                  <button
                    v-for="rpe in 10"
                    :key="rpe"
                    type="button"
                    style="flex: 1; min-width: 24px; height: 28px; font-size: 0.74rem; border-radius: 6px; border: 1px solid var(--border); background: var(--surface); color: var(--text); cursor: pointer; transition: all 0.15s ease; display: flex; align-items: center; justify-content: center;"
                    :style="workout.sessionRpe === rpe ? 'background: var(--accent); color: white; border-color: var(--accent); font-weight: bold;' : ''"
                    @click="updateWorkoutRpe(workout, rpe)"
                  >
                    {{ rpe }}
                  </button>
                </div>
              </div>

              <!-- Debug details inline -->
              <details v-if="showWorkoutDebug" class="workout-debug" style="margin-top: 4px;">
                <summary style="font-size: 0.74rem; color: var(--muted);">{{ t.debugDetails }}</summary>
                <code style="display: block; font-size: 0.72rem; line-height: 1.4; padding: 6px; background: var(--surface); border-radius: 4px; margin-top: 4px; overflow-x: auto; color: var(--text);">{{ JSON.stringify(workoutDebug(workout), null, 2) }}</code>
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
</template>
