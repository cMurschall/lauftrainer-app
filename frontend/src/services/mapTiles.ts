import {
  Map as MapLibreMap,
  LngLatBounds,
  addProtocol,
  setWorkerUrl,
  type GeoJSONSource,
  type StyleSpecification,
} from 'maplibre-gl'
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { layers, namedFlavor } from '@protomaps/basemaps'
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

/** Lon/lat pairs from workout records (skips points without GPS). */
export function routeCoordinatesFromRecords(
  records: Array<{ latitude?: number; longitude?: number }> | undefined,
): LonLat[] {
  if (!records?.length) return []
  const coords: LonLat[] = []
  for (const record of records) {
    if (record.latitude === undefined || record.longitude === undefined) continue
    if (!Number.isFinite(record.latitude) || !Number.isFinite(record.longitude)) continue
    coords.push([record.longitude, record.latitude])
  }
  return coords
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
  return (
    lng >= GERMANY_BBOX.west &&
    lng <= GERMANY_BBOX.east &&
    lat >= GERMANY_BBOX.south &&
    lat <= GERMANY_BBOX.north
  )
}

const ROUTE_SOURCE = 'workout-route'
const ROUTE_LAYER = 'workout-route-line'
const ROUTE_COLOR = '#fb923c'

export type MapTheme = 'light' | 'dark'

export function resolvedDomTheme(): MapTheme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
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

  const flavor = theme === 'dark' ? 'dark' : 'light'
  return {
    version: 8,
    glyphs: 'https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf',
    sprite: `https://protomaps.github.io/basemaps-assets/sprites/v4/${flavor}`,
    sources: {
      protomaps: {
        type: 'vector',
        url: `pmtiles://${MAP_PMTILES_URL}`,
        // Required by OSM / Protomaps license when basemap tiles are shown.
        attribution:
          '<a href="https://protomaps.com">Protomaps</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      },
    },
    layers: layers('protomaps', namedFlavor(flavor), { lang: 'de' }),
  }
}

export function routeGeoJson(coords: LonLat[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: coords,
        },
      },
    ],
  }
}

export function upsertRouteLayer(map: MapLibreMap, coords: LonLat[]): void {
  const data = routeGeoJson(coords)
  const existing = map.getSource(ROUTE_SOURCE) as GeoJSONSource | undefined
  if (existing) {
    existing.setData(data)
  } else {
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
        'line-color': ROUTE_COLOR,
        'line-width': 3,
        'line-opacity': 0.95,
      },
    })
  }
}

export function fitRoute(map: MapLibreMap, coords: LonLat[], padding = 28): void {
  if (coords.length < 2) return
  const bounds = coords.reduce(
    (box, coord) => box.extend(coord),
    new LngLatBounds(coords[0], coords[0]),
  )
  map.fitBounds(bounds, { padding, duration: 0, maxZoom: 14 })
}

export { MapLibreMap }
