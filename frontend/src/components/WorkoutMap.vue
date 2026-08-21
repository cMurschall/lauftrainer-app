<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useSettingsStore } from '../stores/settings'
import { useI18n } from '../i18n'
import {
  buildMapStyle,
  ensurePmtilesProtocol,
  fitRoute,
  formatRouteLegendValue,
  type MapTheme,
  MapLibreMap,
  preferredRouteColorMode,
  resolvePlaceNameFromMap,
  routeColorCapabilities,
  routeMetricRange,
  type RouteColorMode,
  type RouteHighlightPoint,
  type RoutePoint,
  setRouteHighlight,
  upsertRouteLayer,
} from '../services/mapTiles'

const props = withDefaults(
  defineProps<{
    points: RoutePoint[]
    /** When false, only the GPS route is drawn (no tile fetches). */
    showBasemap?: boolean
    /** Modal: allow pan/zoom. Preview: static camera. */
    interactive?: boolean
    /** Override auto mode (hr → pace → solid). */
    colorMode?: RouteColorMode
    /** Chart-hover cursor on the track. */
    highlight?: RouteHighlightPoint | null
    /** Hide HR/pace color legend + toggles (accordion preview). */
    colorControls?: boolean
  }>(),
  {
    showBasemap: false,
    interactive: false,
    highlight: null,
    colorControls: true,
  },
)

const emit = defineEmits<{
  placeName: [name: string]
  'update:colorMode': [mode: RouteColorMode]
}>()

const { t } = useI18n()
const settings = useSettingsStore()
const { theme } = storeToRefs(settings)
const systemPrefersDark = ref(
  typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)').matches : true,
)

const mapTheme = computed<MapTheme>(() => {
  const dark = theme.value === 'dark' || (theme.value === 'system' && systemPrefersDark.value)
  return dark ? 'dark' : 'light'
})

const capabilities = computed(() => routeColorCapabilities(props.points))
const resolvedColorMode = computed<RouteColorMode>(() => {
  const requested = props.colorMode ?? preferredRouteColorMode(props.points)
  if (requested === 'hr' && !capabilities.value.hr) return preferredRouteColorMode(props.points)
  if (requested === 'pace' && !capabilities.value.pace) return preferredRouteColorMode(props.points)
  return requested
})

const legendRange = computed(() => routeMetricRange(props.points, resolvedColorMode.value))
const legendLow = computed(() => {
  if (!legendRange.value || resolvedColorMode.value === 'solid') return ''
  return formatRouteLegendValue(legendRange.value.min, resolvedColorMode.value)
})
const legendHigh = computed(() => {
  if (!legendRange.value || resolvedColorMode.value === 'solid') return ''
  return formatRouteLegendValue(legendRange.value.max, resolvedColorMode.value)
})
const legendUnit = computed(() => {
  if (resolvedColorMode.value === 'hr') return 'bpm'
  if (resolvedColorMode.value === 'pace') return '/km'
  return ''
})

const showModeToggle = computed(
  () => props.colorControls && (capabilities.value.hr || capabilities.value.pace),
)

/** Tiny custom credit in the card preview; MapLibre control only in the enlarged modal. */
const showPreviewAttribution = computed(() => props.showBasemap && !props.interactive)

const containerRef = ref<HTMLElement | null>(null)
let map: MapLibreMap | null = null
let resizeObserver: ResizeObserver | null = null
let systemMedia: MediaQueryList | null = null
let lastEmittedPlace = ''
let mountedForKey = ''

const onSystemThemeChange = (event: MediaQueryListEvent) => {
  systemPrefersDark.value = event.matches
}

/** Stable fingerprint so parent re-renders with a fresh array do not remount the map. */
function pointsKey(points: RoutePoint[]): string {
  if (points.length < 2) return String(points.length)
  const first = points[0]
  const mid = points[Math.floor(points.length / 2)]
  const last = points[points.length - 1]
  return `${points.length}:${first.longitude},${first.latitude}:${mid.longitude},${mid.latitude}:${last.longitude},${last.latitude}`
}

function mapInstanceKey(): string {
  return [pointsKey(props.points), props.showBasemap ? '1' : '0', props.interactive ? '1' : '0', mapTheme.value].join(
    '|',
  )
}

function destroyMap() {
  resizeObserver?.disconnect()
  resizeObserver = null
  map?.remove()
  map = null
}

function emitPlaceNameOnce() {
  if (!map || !props.showBasemap) return
  const coordinates = props.points.map((point) => [point.longitude, point.latitude] as [number, number])
  const name = resolvePlaceNameFromMap(map, coordinates)
  if (!name || name === lastEmittedPlace) return
  lastEmittedPlace = name
  emit('placeName', name)
}

function paintRoute() {
  if (!map) return
  upsertRouteLayer(map, props.points, resolvedColorMode.value)
  setRouteHighlight(map, props.highlight ?? null)
}

function paintHighlight() {
  if (!map) return
  setRouteHighlight(map, props.highlight ?? null)
}

function mountMap() {
  if (!containerRef.value || props.points.length < 2) return

  const nextKey = mapInstanceKey()
  if (map && mountedForKey === nextKey) {
    paintRoute()
    return
  }
  mountedForKey = nextKey
  lastEmittedPlace = ''

  ensurePmtilesProtocol()
  destroyMap()

  map = new MapLibreMap({
    container: containerRef.value,
    style: buildMapStyle({ showBasemap: props.showBasemap, theme: mapTheme.value }),
    attributionControl: props.showBasemap && props.interactive ? { compact: true } : false,
    interactive: props.interactive,
    dragRotate: false,
    pitchWithRotate: false,
    fadeDuration: 0,
  })

  if (!props.interactive) {
    map.scrollZoom.disable()
    map.boxZoom.disable()
    map.dragPan.disable()
    map.keyboard.disable()
    map.doubleClickZoom.disable()
    map.touchZoomRotate.disable()
  }

  map.on('load', () => {
    if (!map) return
    map.resize()
    paintRoute()
    const coordinates = props.points.map((point) => [point.longitude, point.latitude] as [number, number])
    fitRoute(map, coordinates, props.interactive ? 40 : 24)
  })

  map.on('idle', () => {
    emitPlaceNameOnce()
  })

  resizeObserver = new ResizeObserver(() => {
    map?.resize()
  })
  resizeObserver.observe(containerRef.value)
}

function setColorMode(mode: RouteColorMode) {
  emit('update:colorMode', mode)
}

onMounted(() => {
  systemMedia = window.matchMedia('(prefers-color-scheme: dark)')
  systemPrefersDark.value = systemMedia.matches
  systemMedia.addEventListener('change', onSystemThemeChange)
  mountMap()
})

onBeforeUnmount(() => {
  systemMedia?.removeEventListener('change', onSystemThemeChange)
  systemMedia = null
  destroyMap()
})

watch(mapInstanceKey, () => {
  mountMap()
})

watch(resolvedColorMode, () => {
  paintRoute()
})

watch(
  () => props.highlight,
  () => {
    paintHighlight()
  },
)
</script>

<template>
  <div class="workout-map-shell" :class="mapTheme === 'dark' ? 'is-dark' : 'is-light'">
    <div ref="containerRef" class="workout-map" role="img" aria-label="Route map" />
    <div v-if="showModeToggle" class="map-color-controls" @click.stop>
      <div
        class="map-color-legend"
        :class="{ 'is-placeholder': resolvedColorMode === 'solid' || !legendRange }"
        aria-hidden="true"
      >
        <span>{{ legendLow || '—' }}</span>
        <span class="map-color-legend-bar" />
        <span>{{ legendHigh || '—' }}{{ legendUnit ? ` ${legendUnit}` : '' }}</span>
      </div>
      <div class="map-color-modes" role="group" :aria-label="t.mapColorMode">
        <button
          type="button"
          class="map-color-mode"
          :class="{ active: resolvedColorMode === 'solid' }"
          @click="setColorMode('solid')"
        >
          {{ t.mapColorSolid }}
        </button>
        <button
          v-if="capabilities.hr"
          type="button"
          class="map-color-mode"
          :class="{ active: resolvedColorMode === 'hr' }"
          @click="setColorMode('hr')"
        >
          {{ t.mapColorHr }}
        </button>
        <button
          v-if="capabilities.pace"
          type="button"
          class="map-color-mode"
          :class="{ active: resolvedColorMode === 'pace' }"
          @click="setColorMode('pace')"
        >
          {{ t.mapColorPace }}
        </button>
      </div>
    </div>
    <a
      v-if="showPreviewAttribution"
      class="map-attrib-preview"
      href="https://www.openstreetmap.org/copyright"
      target="_blank"
      rel="noreferrer"
      @click.stop
    >
      ©&nbsp;OSM
    </a>
  </div>
</template>

<style scoped>
.workout-map-shell {
  position: relative;
  display: block;
  width: 100%;
  height: 100%;
  min-height: 120px;
  border-radius: inherit;
  overflow: hidden;
}

.workout-map-shell.is-light {
  background: #e8eef4;
}

.workout-map-shell.is-dark {
  background: #0d1117;
}

.workout-map {
  display: block;
  width: 100%;
  height: 100%;
  min-height: inherit;
}

.workout-map :deep(.maplibregl-canvas) {
  outline: none;
}

.map-color-controls {
  position: absolute;
  left: 8px;
  bottom: 8px;
  z-index: 2;
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-width: calc(100% - 48px);
  pointer-events: auto;
}

.map-color-modes {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 6px;
  background: rgba(13, 17, 23, 0.72);
  backdrop-filter: blur(6px);
}

.workout-map-shell.is-light .map-color-modes {
  border-color: rgba(15, 23, 42, 0.12);
  background: rgba(255, 255, 255, 0.82);
}

.map-color-mode {
  appearance: none;
  margin: 0;
  border: 0;
  border-radius: 4px;
  padding: 3px 7px;
  background: transparent;
  color: #8b949e;
  font: inherit;
  font-size: 0.62rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  cursor: pointer;
}

.workout-map-shell.is-light .map-color-mode {
  color: #64748b;
}

.map-color-mode.active {
  background: rgba(16, 185, 129, 0.18);
  color: #a3e635;
}

.workout-map-shell.is-light .map-color-mode.active {
  background: rgba(16, 185, 129, 0.14);
  color: #047857;
}

.map-color-legend {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 14px;
  color: #8b949e;
  font-size: 0.62rem;
  font-weight: 550;
  letter-spacing: 0.02em;
}

.map-color-legend.is-placeholder {
  visibility: hidden;
}

.workout-map-shell.is-light .map-color-legend {
  color: #64748b;
}

.map-color-legend-bar {
  width: 56px;
  height: 4px;
  border-radius: 999px;
  background: linear-gradient(90deg, #38bdf8, #34d399, #a3e635, #fb923c, #f43f5e);
}

.map-attrib-preview {
  position: absolute;
  right: 4px;
  bottom: 3px;
  z-index: 2;
  font-size: 8px;
  font-weight: 500;
  letter-spacing: 0.02em;
  line-height: 1;
  text-decoration: none;
  opacity: 0.45;
  pointer-events: auto;
}

.workout-map-shell.is-light .map-attrib-preview {
  color: #475569;
}

.workout-map-shell.is-dark .map-attrib-preview {
  color: #8b949e;
}

.map-attrib-preview:hover {
  opacity: 0.8;
}

.workout-map-shell :deep(.maplibregl-ctrl-attrib) {
  font-size: 9px;
  line-height: 1.2;
  max-width: 55%;
  background: transparent;
  color: var(--muted, #8b949e);
  margin: 0;
  padding: 2px 4px;
}

.workout-map-shell.is-light :deep(.maplibregl-ctrl-attrib) {
  color: #64748b;
}

.workout-map-shell :deep(.maplibregl-ctrl-attrib a) {
  color: inherit;
}

.workout-map-shell :deep(.maplibregl-ctrl-bottom-right) {
  right: 2px;
  bottom: 2px;
}
</style>
