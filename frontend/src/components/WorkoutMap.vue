<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useSettingsStore } from '../stores/settings'
import {
  buildMapStyle,
  ensurePmtilesProtocol,
  fitRoute,
  type LonLat,
  type MapTheme,
  MapLibreMap,
  upsertRouteLayer,
} from '../services/mapTiles'

const props = withDefaults(
  defineProps<{
    coordinates: LonLat[]
    /** When false, only the GPS route is drawn (no tile fetches). */
    showBasemap?: boolean
    /** Modal: allow pan/zoom. Preview: static camera. */
    interactive?: boolean
  }>(),
  {
    showBasemap: false,
    interactive: false,
  },
)

const settings = useSettingsStore()
const { theme } = storeToRefs(settings)
const systemPrefersDark = ref(
  typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)').matches : true,
)

const mapTheme = computed<MapTheme>(() => {
  const dark = theme.value === 'dark' || (theme.value === 'system' && systemPrefersDark.value)
  return dark ? 'dark' : 'light'
})

/** Tiny custom credit in the card preview; MapLibre control only in the enlarged modal. */
const showPreviewAttribution = computed(() => props.showBasemap && !props.interactive)

const containerRef = ref<HTMLElement | null>(null)
let map: MapLibreMap | null = null
let resizeObserver: ResizeObserver | null = null
let systemMedia: MediaQueryList | null = null

const onSystemThemeChange = (event: MediaQueryListEvent) => {
  systemPrefersDark.value = event.matches
}

function destroyMap() {
  resizeObserver?.disconnect()
  resizeObserver = null
  map?.remove()
  map = null
}

function mountMap() {
  if (!containerRef.value || props.coordinates.length < 2) return

  ensurePmtilesProtocol()
  destroyMap()

  map = new MapLibreMap({
    container: containerRef.value,
    style: buildMapStyle({ showBasemap: props.showBasemap, theme: mapTheme.value }),
    // Preview uses a custom micro-credit; modal keeps MapLibre's compact control.
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
    upsertRouteLayer(map, props.coordinates)
    fitRoute(map, props.coordinates, props.interactive ? 40 : 24)
  })

  resizeObserver = new ResizeObserver(() => {
    map?.resize()
  })
  resizeObserver.observe(containerRef.value)
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

watch(
  () => [props.coordinates, props.showBasemap, props.interactive, mapTheme.value] as const,
  () => {
    mountMap()
  },
  { deep: true },
)
</script>

<template>
  <div class="workout-map-shell" :class="mapTheme === 'dark' ? 'is-dark' : 'is-light'">
    <div ref="containerRef" class="workout-map" role="img" aria-label="Route map" />
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
