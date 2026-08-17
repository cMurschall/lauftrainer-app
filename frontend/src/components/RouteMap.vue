<script setup lang="ts">
/** Projected SVG paths for one route preview, all in the 240×150 user space. */
export interface RouteMapLayers {
  sea: string[]
  forests: string[]
  residential: string[]
  waterAreas: string[]
  coastlines: string[]
  highways: string[]
}

const props = withDefaults(
  defineProps<{
    routePath: string
    layers?: RouteMapLayers | null
    /** Thicker route line reads better once the map is blown up. */
    routeWidth?: number
  }>(),
  { layers: null, routeWidth: 1.5 },
)
</script>

<template>
  <svg viewBox="0 0 240 150" preserveAspectRatio="xMidYMid meet" class="route-map">
    <template v-if="props.layers">
      <!-- Sea, reconstructed from coastline + preview border -->
      <path v-for="(path, i) in props.layers.sea" :key="`sea-${i}`" :d="path" fill="var(--map-water-fill)" />
      <path v-for="(path, i) in props.layers.forests" :key="`f-${i}`" :d="path" fill="var(--map-forest)" />
      <path v-for="(path, i) in props.layers.residential" :key="`r-${i}`" :d="path" fill="var(--map-urban)" />
      <!-- Lakes and bays, drawn over land so water always wins -->
      <path
        v-for="(path, i) in props.layers.waterAreas"
        :key="`wa-${i}`"
        :d="path"
        fill="var(--map-water-fill)"
        stroke="var(--map-water)"
        stroke-width=".6"
      />
      <path
        v-for="(path, i) in props.layers.coastlines"
        :key="`c-${i}`"
        :d="path"
        fill="none"
        stroke="var(--map-coast)"
        stroke-width="0.2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <path
        v-for="(path, i) in props.layers.highways"
        :key="`h-${i}`"
        :d="path"
        fill="none"
        stroke="var(--map-road)"
        stroke-width="1.1"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </template>
    <path
      :d="props.routePath"
      fill="none"
      stroke="var(--map-route)"
      :stroke-width="props.routeWidth"
      stroke-linecap="round"
      stroke-linejoin="round"
      style="filter: drop-shadow(0 0 3px var(--map-route-glow))"
    />
  </svg>
</template>

<style scoped>
.route-map {
  display: block;
  width: 100%;
  height: 100%;
}
</style>
