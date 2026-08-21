import {
  Map as MapLibreMap,
  LngLatBounds,
  addProtocol,
  setWorkerUrl,
  type GeoJSONSource,
  type StyleSpecification,
} from 'maplibre-gl'
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { layers, namedFlavor, type Flavor } from '@protomaps/basemaps'
import { Protocol } from 'pmtiles'
import type { FeatureCollection } from 'geojson'

// MapLibre v6: Vite must bundle the worker; otherwise Firefox blocks .vite/deps/*.mjs (empty MIME).
setWorkerUrl(maplibreWorkerUrl)

/** Germany extract bbox used by scripts/extract-germany-pmtiles.ps1 (west,south,east,north). */
export const GERMANY_BBOX = {
  west: 5.8,
  south: 47.2,
  east: 15.1,
  north: 55.1,
} as const

export const MAP_PMTILES_URL = String(import.meta.env.VITE_MAP_PMTILES_URL || '').trim()

/**
 * Experimental: restyle PMTiles toward the old Overpass SVG look (few layers, app tokens).
 * Set VITE_MAP_STYLE=protomaps to use the stock Protomaps light/dark flavors again.
 */
export const MAP_STYLE_MODE = String(import.meta.env.VITE_MAP_STYLE || 'overpass-feel').trim()

export function hasMapTilesUrl(): boolean {
  return MAP_PMTILES_URL.length > 0
}

let protocolRegistered = false

/** Register the pmtiles:// protocol once per page lifetime. */
export function ensurePmtilesProtocol(): void {
  if (protocolRegistered) return
  const protocol = new Protocol()
  addProtocol('pmtiles', protocol.tile)
  protocolRegistered = true
}

export type LonLat = [number, number]

export type RouteColorMode = 'solid' | 'hr' | 'pace'

export type RoutePoint = {
  longitude: number
  latitude: number
  heartRateBpm?: number
  speedKmh?: number
}

/** Lon/lat pairs from workout records (skips points without GPS). */
export function routeCoordinatesFromRecords(
  records: Array<{ latitude?: number; longitude?: number }> | undefined,
): LonLat[] {
  return routePointsFromRecords(records).map((point) => [point.longitude, point.latitude])
}

/** GPS points plus optional HR/speed for colored route overlays. */
export function routePointsFromRecords(
  records:
    | Array<{
        latitude?: number
        longitude?: number
        heartRateBpm?: number
        speedKmh?: number
      }>
    | undefined,
): RoutePoint[] {
  if (!records?.length) return []
  const points: RoutePoint[] = []
  for (const record of records) {
    const latitude = Number(record.latitude)
    const longitude = Number(record.longitude)
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue
    const heartRateBpm = Number(record.heartRateBpm)
    const speedKmh = Number(record.speedKmh)
    points.push({
      longitude,
      latitude,
      ...(Number.isFinite(heartRateBpm) ? { heartRateBpm } : {}),
      ...(Number.isFinite(speedKmh) ? { speedKmh } : {}),
    })
  }
  return points
}

export function routeColorCapabilities(points: RoutePoint[]): { hr: boolean; pace: boolean } {
  return {
    hr: points.some((point) => point.heartRateBpm !== undefined),
    pace: points.some((point) => point.speedKmh !== undefined),
  }
}

export function preferredRouteColorMode(points: RoutePoint[]): RouteColorMode {
  const caps = routeColorCapabilities(points)
  if (caps.hr) return 'hr'
  if (caps.pace) return 'pace'
  return 'solid'
}

/** True when the route centroid falls inside the Germany PMTiles extract. */
export function routeHasBasemapCoverage(coords: LonLat[]): boolean {
  if (coords.length < 2) return false
  let sumLng = 0
  let sumLat = 0
  for (const [lng, lat] of coords) {
    sumLng += lng
    sumLat += lat
  }
  const lng = sumLng / coords.length
  const lat = sumLat / coords.length
  return lng >= GERMANY_BBOX.west && lng <= GERMANY_BBOX.east && lat >= GERMANY_BBOX.south && lat <= GERMANY_BBOX.north
}

const ROUTE_SOURCE = 'workout-route'
const ROUTE_LAYER = 'workout-route-line'
const ROUTE_COLOR = '#fb923c'
/** Low → high effort / intensity along the track. */
const METRIC_COLOR_STOPS = ['#38bdf8', '#34d399', '#a3e635', '#fb923c', '#f43f5e'] as const

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace('#', '')
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ]
}

function rgbToHex(r: number, g: number, b: number): string {
  const to = (channel: number) => Math.round(channel).toString(16).padStart(2, '0')
  return `#${to(r)}${to(g)}${to(b)}`
}

export function colorForNormalized(t: number, stops: readonly string[] = METRIC_COLOR_STOPS): string {
  const clamped = Math.min(1, Math.max(0, t))
  if (stops.length === 0) return ROUTE_COLOR
  if (stops.length === 1) return stops[0]
  const scaled = clamped * (stops.length - 1)
  const index = Math.min(stops.length - 2, Math.floor(scaled))
  const local = scaled - index
  const [r1, g1, b1] = hexToRgb(stops[index])
  const [r2, g2, b2] = hexToRgb(stops[index + 1])
  return rgbToHex(r1 + (r2 - r1) * local, g1 + (g2 - g1) * local, b1 + (b2 - b1) * local)
}

function metricAt(point: RoutePoint, mode: RouteColorMode): number | undefined {
  if (mode === 'hr') return point.heartRateBpm
  if (mode === 'pace') return point.speedKmh
  return undefined
}

export function routeMetricRange(points: RoutePoint[], mode: RouteColorMode): { min: number; max: number } | undefined {
  if (mode === 'solid') return undefined
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (const point of points) {
    const value = metricAt(point, mode)
    if (value === undefined) continue
    min = Math.min(min, value)
    max = Math.max(max, value)
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return undefined
  if (max - min < 1e-6) {
    const pad = mode === 'hr' ? 5 : 0.5
    return { min: min - pad, max: max + pad }
  }
  return { min, max }
}

function colorForMetric(value: number | undefined, range: { min: number; max: number } | undefined): string {
  if (value === undefined || !range) return ROUTE_COLOR
  return colorForNormalized((value - range.min) / (range.max - range.min))
}

export type MapTheme = 'light' | 'dark'

export function resolvedDomTheme(): MapTheme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
}

/**
 * Colors aligned with the former SVG `--map-*` tokens: water / soft forest /
 * faint urban / light roads on a deep slate canvas — without place/POI labels.
 */
export function lauftrainerOverpassFlavor(theme: MapTheme): Flavor {
  const base = namedFlavor(theme === 'dark' ? 'dark' : 'light')
  if (theme === 'dark') {
    const earth = '#161B22'
    const road = '#6B7280'
    const roadMajor = '#9CA3AF'
    return {
      ...base,
      background: '#0D1117',
      earth,
      park_a: '#12352C',
      park_b: '#0F2A22',
      hospital: earth,
      industrial: earth,
      school: earth,
      wood_a: '#134E3A',
      wood_b: '#0F3D2E',
      pedestrian: '#1C2230',
      scrub_a: '#1A2E24',
      scrub_b: '#15261E',
      glacier: '#1E293B',
      sand: '#1C2230',
      beach: '#1C2230',
      aerodrome: earth,
      runway: '#2A3140',
      water: '#1E4A66',
      zoo: earth,
      military: earth,
      pier: '#2A3140',
      buildings: '#1C2230',
      other: '#3F4654',
      minor_service: '#3F4654',
      minor_a: road,
      minor_b: road,
      link: roadMajor,
      major: roadMajor,
      highway: '#D1D5DB',
      railway: '#374151',
      boundaries: '#2A3140',
      tunnel_other: '#3F4654',
      tunnel_minor: road,
      tunnel_link: road,
      tunnel_major: roadMajor,
      tunnel_highway: roadMajor,
      bridges_other: '#3F4654',
      bridges_minor: road,
      bridges_link: roadMajor,
      bridges_major: roadMajor,
      bridges_highway: '#D1D5DB',
      landcover: {
        barren: earth,
        farmland: '#1A2E24',
        forest: '#134E3A',
        glacier: '#1E293B',
        grassland: '#1A2E24',
        scrub: '#15261E',
        // Distinct from earth so inhabited areas read like the old SVG residential fill.
        urban_area: '#2A3341',
      },
    }
  }

  const earth = '#F2F4F7'
  const road = '#94A3B8'
  const roadMajor = '#64748B'
  return {
    ...base,
    background: '#E8EEF4',
    earth,
    park_a: '#BBF7D0',
    park_b: '#A7F3D0',
    hospital: earth,
    industrial: earth,
    school: earth,
    wood_a: '#86EFAC',
    wood_b: '#6EE7B7',
    pedestrian: '#E2E8F0',
    scrub_a: '#D1FAE5',
    scrub_b: '#A7F3D0',
    glacier: '#E0F2FE',
    sand: '#F1F5F9',
    beach: '#E0F2FE',
    aerodrome: earth,
    runway: '#CBD5E1',
    water: '#7DD3FC',
    zoo: earth,
    military: earth,
    pier: '#CBD5E1',
    buildings: '#E2E8F0',
    other: '#CBD5E1',
    minor_service: '#CBD5E1',
    minor_a: road,
    minor_b: road,
    link: roadMajor,
    major: roadMajor,
    highway: '#475569',
    railway: '#94A3B8',
    boundaries: '#E2E8F0',
    tunnel_other: '#CBD5E1',
    tunnel_minor: road,
    tunnel_link: road,
    tunnel_major: roadMajor,
    tunnel_highway: roadMajor,
    bridges_other: '#CBD5E1',
    bridges_minor: road,
    bridges_link: roadMajor,
    bridges_major: roadMajor,
    bridges_highway: '#475569',
    landcover: {
      barren: earth,
      farmland: '#D1FAE5',
      forest: '#86EFAC',
      glacier: '#E0F2FE',
      grassland: '#BBF7D0',
      scrub: '#A7F3D0',
      urban_area: '#D0D7E0',
    },
  }
}

/** Extra fill so OSM landuse=residential shows even when stock styles omit it. */
function residentialLanduseLayer(theme: MapTheme): StyleSpecification['layers'][number] {
  return {
    id: 'landuse_residential_feel',
    type: 'fill',
    source: 'protomaps',
    'source-layer': 'landuse',
    filter: ['==', ['get', 'kind'], 'residential'],
    paint: {
      'fill-color': theme === 'dark' ? '#2A3341' : '#D0D7E0',
      'fill-opacity': 1,
    },
  }
}

const PLACE_RANK: Record<string, number> = {
  city: 70,
  town: 60,
  municipality: 55,
  village: 50,
  suburb: 40,
  quarter: 35,
  neighbourhood: 30,
  neighborhood: 30,
  hamlet: 25,
  locality: 20,
  farm: 10,
  allotments: 5,
}

function placeFeatureName(props: Record<string, unknown> | null | undefined): string | undefined {
  if (!props) return undefined
  for (const key of ['name:de', 'name', 'name2', 'pgf:name']) {
    const value = props[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

function placeFeatureRank(props: Record<string, unknown> | null | undefined): number {
  if (!props) return 0
  const detail = String(props.kind_detail || props.kind || '').toLowerCase()
  const fromDetail = PLACE_RANK[detail] || 0
  const population = Number(props.population)
  const popBonus = Number.isFinite(population) ? Math.min(20, Math.log10(Math.max(population, 10))) : 0
  return fromDetail + popBonus
}

function haversineKm(a: LonLat, b: LonLat): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(b[1] - a[1])
  const dLng = toRad(b[0] - a[0])
  const lat1 = toRad(a[1])
  const lat2 = toRad(b[1])
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 6371 * 2 * Math.asin(Math.sqrt(h))
}

export function routeCentroid(coords: LonLat[]): LonLat | null {
  if (!coords.length) return null
  let sumLng = 0
  let sumLat = 0
  for (const [lng, lat] of coords) {
    sumLng += lng
    sumLat += lat
  }
  return [sumLng / coords.length, sumLat / coords.length]
}

/**
 * Pick the best municipality/locality label from loaded Protomaps `places` features
 * near the route centroid (no Overpass).
 */
export function resolvePlaceNameFromMap(map: MapLibreMap, coords: LonLat[]): string | undefined {
  const center = routeCentroid(coords)
  if (!center || !map.getSource('protomaps')) return undefined

  let features: ReturnType<MapLibreMap['querySourceFeatures']> = []
  try {
    features = map.querySourceFeatures('protomaps', { sourceLayer: 'places' })
  } catch {
    return undefined
  }
  if (!features.length) return undefined

  type Candidate = { name: string; score: number }
  const candidates: Candidate[] = []
  for (const feature of features) {
    const name = placeFeatureName(feature.properties as Record<string, unknown>)
    if (!name) continue
    const rank = placeFeatureRank(feature.properties as Record<string, unknown>)
    if (rank < 20) continue
    const geometry = feature.geometry
    if (geometry.type !== 'Point') continue
    const [lng, lat] = geometry.coordinates
    const distanceKm = haversineKm(center, [lng, lat])
    // Prefer important places close to the route; soft distance penalty.
    const score = rank - distanceKm * 8
    candidates.push({ name, score })
  }
  if (!candidates.length) return undefined
  candidates.sort((a, b) => b.score - a.score)
  return candidates[0]?.name
}

function emptyBasemapStyle(theme: MapTheme): StyleSpecification {
  return {
    version: 8,
    sources: {},
    layers: [
      {
        id: 'background',
        type: 'background',
        paint: { 'background-color': theme === 'dark' ? '#0D1117' : '#E8EEF4' },
      },
    ],
  }
}

export function buildMapStyle(options: { showBasemap: boolean; theme?: MapTheme }): StyleSpecification {
  const theme = options.theme ?? resolvedDomTheme()
  if (!options.showBasemap || !hasMapTilesUrl()) {
    return emptyBasemapStyle(theme)
  }

  const useOverpassFeel = MAP_STYLE_MODE !== 'protomaps'
  const stockName = theme === 'dark' ? 'dark' : 'light'
  const flavor = useOverpassFeel ? lauftrainerOverpassFlavor(theme) : namedFlavor(stockName)
  const baseLayers = layers('protomaps', flavor, useOverpassFeel ? undefined : { lang: 'de' })
  const styledLayers = useOverpassFeel ? insertResidentialLayer(baseLayers, theme) : baseLayers

  return {
    version: 8,
    glyphs: 'https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf',
    sprite: `https://protomaps.github.io/basemaps-assets/sprites/v4/${stockName}`,
    sources: {
      protomaps: {
        type: 'vector',
        url: `pmtiles://${MAP_PMTILES_URL}`,
        // Required by OSM / Protomaps license when basemap tiles are shown.
        attribution:
          '<a href="https://protomaps.com">Protomaps</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      },
    },
    // Omit `lang` in overpass-feel to drop map labels; place name is resolved separately for the UI chip.
    layers: styledLayers,
  }
}

function insertResidentialLayer(
  styleLayers: StyleSpecification['layers'],
  theme: MapTheme,
): StyleSpecification['layers'] {
  const residential = residentialLanduseLayer(theme)
  const layersList = [...styleLayers]
  const waterIdx = layersList.findIndex((layer) => layer.id === 'water')
  if (waterIdx >= 0) {
    layersList.splice(waterIdx, 0, residential)
  } else {
    layersList.splice(1, 0, residential)
  }
  return layersList
}

export function routeGeoJson(coords: LonLat[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { color: ROUTE_COLOR },
        geometry: {
          type: 'LineString',
          coordinates: coords,
        },
      },
    ],
  }
}

/** One colored segment per consecutive GPS pair (MapLibre `line-color: get color`). */
export function coloredRouteGeoJson(points: RoutePoint[], mode: RouteColorMode): FeatureCollection {
  if (points.length < 2) {
    return { type: 'FeatureCollection', features: [] }
  }
  const caps = routeColorCapabilities(points)
  const effectiveMode = mode === 'hr' && !caps.hr ? 'solid' : mode === 'pace' && !caps.pace ? 'solid' : mode
  if (effectiveMode === 'solid') {
    return routeGeoJson(points.map((point) => [point.longitude, point.latitude]))
  }
  const range = routeMetricRange(points, effectiveMode)
  const features: FeatureCollection['features'] = []
  for (let index = 0; index < points.length - 1; index += 1) {
    const a = points[index]
    const b = points[index + 1]
    const valueA = metricAt(a, effectiveMode)
    const valueB = metricAt(b, effectiveMode)
    const value = valueA !== undefined && valueB !== undefined ? (valueA + valueB) / 2 : (valueA ?? valueB)
    features.push({
      type: 'Feature',
      properties: { color: colorForMetric(value, range) },
      geometry: {
        type: 'LineString',
        coordinates: [
          [a.longitude, a.latitude],
          [b.longitude, b.latitude],
        ],
      },
    })
  }
  return { type: 'FeatureCollection', features }
}

export function upsertRouteLayer(map: MapLibreMap, points: RoutePoint[], mode: RouteColorMode = 'solid'): void {
  const data = coloredRouteGeoJson(points, mode)
  const existing = map.getSource(ROUTE_SOURCE) as GeoJSONSource | undefined
  if (existing) {
    existing.setData(data)
    if (map.getLayer(ROUTE_LAYER)) {
      map.setPaintProperty(ROUTE_LAYER, 'line-color', ['get', 'color'])
    }
    return
  }
  map.addSource(ROUTE_SOURCE, { type: 'geojson', data })
  map.addLayer({
    id: ROUTE_LAYER,
    type: 'line',
    source: ROUTE_SOURCE,
    layout: {
      'line-join': 'round',
      'line-cap': 'round',
    },
    paint: {
      'line-color': ['get', 'color'],
      'line-width': 3.5,
      'line-opacity': 0.95,
    },
  })
}

export function fitRoute(map: MapLibreMap, coords: LonLat[], padding = 28): void {
  if (coords.length < 2) return
  const bounds = coords.reduce((box, coord) => box.extend(coord), new LngLatBounds(coords[0], coords[0]))
  map.fitBounds(bounds, { padding, duration: 0, maxZoom: 14 })
}

export function formatRouteLegendValue(value: number, mode: RouteColorMode): string {
  if (mode === 'hr') return `${Math.round(value)}`
  if (mode === 'pace') {
    if (value <= 0) return '–'
    const minPerKm = 60 / value
    const minutes = Math.floor(minPerKm)
    const seconds = Math.round((minPerKm - minutes) * 60)
    return `${minutes}:${String(seconds % 60).padStart(2, '0')}`
  }
  return String(value)
}

export { MapLibreMap }
