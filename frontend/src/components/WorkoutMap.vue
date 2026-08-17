<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import 'maplibre-gl/dist/maplibre-gl.css'
import {
  buildMapStyle,
  ensurePmtilesProtocol,
  fitRoute,
  type LonLat,
  MapLibreMap,
  upsertRouteLayer,
} from '../services/mapTiles'

const props = withDefaults(
  defineProps<{
    coordinates: LonLat[]
    /** When false, only the GPS route is drawn on a dark background (no tile fetches). */
    showBasemap?: boolean
    /** Modal: allow pan/zoom. Preview: static camera. */
    interactive?: boolean
  }>(),
  {
    showBasemap: false,
    interactive: false,
  },
)

const containerRef = ref<HTMLElement | null>(null)
let map: MapLibreMap | null = null
let resizeObserver: ResizeObserver | null = null

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
    style: buildMapStyle({ showBasemap: props.showBasemap }),
    attributionControl: props.interactive ? { compact: true } : false,
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
    upsertRouteLayer(map, props.coordinates)
    fitRoute(map, props.coordinates, props.interactive ? 40 : 24)
  })

  resizeObserver = new ResizeObserver(() => {
    map?.resize()
  })
  resizeObserver.observe(containerRef.value)
}

onMounted(() => {
  mountMap()
})

onBeforeUnmount(() => {
  destroyMap()
})

watch(
  () => [props.coordinates, props.showBasemap, props.interactive] as const,
  () => {
    mountMap()
  },
  { deep: true },
)
</script>

<template>
  <div ref="containerRef" class="workout-map" role="img" aria-label="Route map" />
</template>

<style scoped>
.workout-map {
  display: block;
  width: 100%;
  height: 100%;
  min-height: 120px;
  border-radius: inherit;
  overflow: hidden;
  background: #0d1117;
}

.workout-map :deep(.maplibregl-canvas) {
  outline: none;
}

.workout-map :deep(.maplibregl-ctrl-attrib) {
  font-size: 10px;
  background: rgba(13, 17, 23, 0.72);
  color: #8b949e;
}

.workout-map :deep(.maplibregl-ctrl-attrib a) {
  color: #8b949e;
}
</style>
