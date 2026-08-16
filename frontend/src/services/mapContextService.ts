import type { ActivityRecord, MapContext } from '../types/workout'

/**
 * The browser queries Overpass directly so the bounding box never reaches our
 * backend and every device spends its own quota.
 *
 * The public instances are frequently saturated, so we walk a list of mirrors
 * instead of failing on the first gateway timeout. Only EU-hosted endpoints are
 * used: the request carries the user's IP, so the operator matters.
 */
export const OVERPASS_ENDPOINTS = [
  // kumi.systems runs a high-capacity instance without a rate limit and asks not
  // to be credited as the main one; the official instance is the polite fallback.
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
]

/** Long enough for a cold cache on a loaded instance, short enough to still try the next one. */
const REQUEST_TIMEOUT_MS = 20_000

/** ~1.1 km at the equator; nearby routes reuse the same cached answer. */
export const BBOX_GRID_DEG = 0.01

export type { MapContext }

export interface BoundingBox {
  minLat: number
  minLng: number
  maxLat: number
  maxLng: number
}

export function boundingBoxFromRecords(records: ActivityRecord[]): BoundingBox | null {
  let minLat = Infinity
  let maxLat = -Infinity
  let minLng = Infinity
  let maxLng = -Infinity
  let count = 0

  for (const record of records) {
    const { latitude, longitude } = record
    if (latitude === undefined || longitude === undefined) continue
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue
    if (latitude < minLat) minLat = latitude
    if (latitude > maxLat) maxLat = latitude
    if (longitude < minLng) minLng = longitude
    if (longitude > maxLng) maxLng = longitude
    count += 1
  }

  if (count < 2) return null

  const latPad = Math.max(0.005, (maxLat - minLat) * 0.15)
  const lngPad = Math.max(0.005, (maxLng - minLng) * 0.15)
  return {
    minLat: minLat - latPad,
    minLng: minLng - lngPad,
    maxLat: maxLat + latPad,
    maxLng: maxLng + lngPad,
  }
}

/** Snap the box outward onto a fixed grid so slightly different routes share a query. */
export function quantizeBbox(box: BoundingBox, step = BBOX_GRID_DEG): string {
  const values = [box.minLat, box.minLng, box.maxLat, box.maxLng]
  if (values.some((value) => !Number.isFinite(value))) throw new Error('invalid bounding box')

  const minLat = Math.floor(Math.min(box.minLat, box.maxLat) / step) * step
  const minLng = Math.floor(Math.min(box.minLng, box.maxLng) / step) * step
  const maxLat = Math.ceil(Math.max(box.minLat, box.maxLat) / step) * step
  const maxLng = Math.ceil(Math.max(box.minLng, box.maxLng) / step) * step

  return [
    minLat,
    minLng,
    maxLat <= minLat ? minLat + step : maxLat,
    maxLng <= minLng ? minLng + step : maxLng,
  ]
    .map((value) => value.toFixed(4))
    .join(',')
}

/**
 * Each bracketed statement is a separate index lookup, so related tags are
 * merged into single regex statements to keep the query affordable on the
 * public instances. `wr` covers ways and relations; place labels are nodes.
 */
export function buildOverpassQuery(bbox: string): string {
  return `[out:json][timeout:20];
(
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential)$"](${bbox});
  way["waterway"~"^(river|canal)$"](${bbox});
  wr["natural"~"^(coastline|water|wood)$"](${bbox});
  wr["landuse"~"^(residential|forest|wood|orchard)$"](${bbox});
  wr["leisure"="park"](${bbox});
  node["place"~"^(city|town|municipality|village|suburb|quarter|neighbourhood|neighborhood|hamlet|locality)$"](${bbox});
);
out geom;`
}

/** Higher = larger settlement. Used when several place nodes sit in one bbox. */
export const PLACE_RANK: Record<string, number> = {
  city: 70,
  town: 60,
  municipality: 55,
  village: 40,
  suburb: 30,
  quarter: 25,
  neighbourhood: 20,
  neighborhood: 20,
  hamlet: 10,
  locality: 5,
}

export interface PlaceCandidate {
  name: string
  place: string
  population?: number
}

/** Prefer city > town > village, then higher population, then the longer name. */
export function pickLargestPlaceName(candidates: PlaceCandidate[]): string | undefined {
  if (candidates.length === 0) return undefined
  const best = [...candidates].sort((a, b) => {
    const rankDiff = (PLACE_RANK[b.place] || 0) - (PLACE_RANK[a.place] || 0)
    if (rankDiff !== 0) return rankDiff
    const popDiff = (b.population || 0) - (a.population || 0)
    if (popDiff !== 0) return popDiff
    return b.name.length - a.name.length
  })[0]
  return best?.name
}

type OverpassGeometry = { lat: number; lon: number }
type OverpassTags = Record<string, string | undefined>
type OverpassElement = {
  type?: string
  tags?: OverpassTags
  lat?: number
  lon?: number
  geometry?: OverpassGeometry[]
  members?: { type?: string; tags?: OverpassTags; geometry?: OverpassGeometry[] }[]
}

export function parseOverpassResponse(data: { elements?: OverpassElement[] } | null | undefined): MapContext {
  const context: MapContext = { waterways: [], highways: [], coastlines: [], residential: [], forests: [] }
  const places: PlaceCandidate[] = []

  const assign = (coords: [number, number][], tags: OverpassTags | undefined) => {
    if (!tags || coords.length === 0) return
    if (tags.waterway) context.waterways.push(coords)
    else if (tags.natural === 'coastline') context.coastlines.push(coords)
    else if (tags.natural === 'water' || tags.water) context.waterways.push(coords)
    else if (tags.highway) context.highways.push(coords)
    else if (tags.landuse === 'residential') context.residential.push(coords)
    else if (
      tags.landuse === 'forest' ||
      tags.landuse === 'wood' ||
      tags.landuse === 'orchard' ||
      tags.natural === 'wood' ||
      tags.leisure === 'park'
    ) {
      context.forests.push(coords)
    }
  }

  const toCoords = (geometry: OverpassGeometry[]): [number, number][] =>
    geometry.map((point) => [point.lon, point.lat] as [number, number])

  for (const element of data?.elements || []) {
    if (element.type === 'node' && element.tags?.place && element.tags.name) {
      const population = Number.parseInt(element.tags.population || '', 10)
      places.push({
        name: element.tags.name.trim(),
        place: element.tags.place,
        population: Number.isFinite(population) ? population : undefined,
      })
      continue
    }
    if (element.type === 'way' && element.geometry) {
      assign(toCoords(element.geometry), element.tags)
    } else if (element.type === 'relation' && element.members) {
      // "out geom" inlines member geometries; relation tags describe the whole area.
      for (const member of element.members) {
        if (member.type === 'way' && member.geometry) {
          assign(toCoords(member.geometry), element.tags || member.tags)
        }
      }
    }
  }

  const placeName = pickLargestPlaceName(places.filter((place) => place.name.length > 0))
  if (placeName) context.placeName = placeName
  return context
}

/**
 * Cached contexts from earlier versions can be empty (for example when a proxy
 * answered without data), so treat those as a miss instead of a valid answer.
 */
export function hasMapDetails(context: Partial<MapContext> | null | undefined): boolean {
  if (!context) return false
  return [context.waterways, context.highways, context.coastlines, context.residential, context.forests].some(
    (layer) => (layer?.length || 0) > 0,
  )
}

export function endpointLabel(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/** Reported per attempt so the UI can show which mirror is being tried. */
export interface MapContextProgress {
  endpoint: string
  attempt: number
  total: number
  durationMs?: number
  status?: number
  error?: string
}

export interface FetchMapContextOptions {
  endpoints?: string[]
  timeoutMs?: number
  onProgress?: (progress: MapContextProgress) => void
}

async function requestOverpass(url: string, query: string, timeoutMs: number): Promise<Response> {
  // `AbortSignal.timeout` is missing on iOS below 16, so drive the abort manually.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, {
      method: 'POST',
      body: new URLSearchParams({ data: query }),
      // The user's route page is none of the mirror operator's business.
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }
}

export async function fetchMapContext(bbox: string, options: FetchMapContextOptions = {}): Promise<MapContext> {
  const endpoints = options.endpoints?.length ? options.endpoints : OVERPASS_ENDPOINTS
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS
  const query = buildOverpassQuery(bbox)
  const failures: string[] = []

  for (const [index, url] of endpoints.entries()) {
    const label = endpointLabel(url)
    const progress: MapContextProgress = { endpoint: label, attempt: index + 1, total: endpoints.length }
    options.onProgress?.(progress)

    const startedAt = Date.now()
    let response: Response
    try {
      response = await requestOverpass(url, query, timeoutMs)
    } catch (error) {
      const name = error instanceof Error ? error.name : ''
      const aborted = name === 'AbortError' || name === 'TimeoutError'
      const reason = aborted
        ? `Timeout nach ${Math.round(timeoutMs / 1000)}s`
        : // Browsers collapse DNS failures, resets and blocks into an opaque TypeError.
          'keine HTTP-Antwort (offline, blockiert oder Verbindung abgebrochen)'
      failures.push(`${label}: ${reason}`)
      options.onProgress?.({ ...progress, durationMs: Date.now() - startedAt, error: reason })
      continue
    }

    const durationMs = Date.now() - startedAt
    if (!response.ok) {
      const reason = response.status === 429 || response.status === 504 ? 'überlastet' : 'Fehler'
      failures.push(`${label}: ${reason} (${response.status})`)
      options.onProgress?.({ ...progress, durationMs, status: response.status, error: `${reason} (${response.status})` })
      continue
    }

    options.onProgress?.({ ...progress, durationMs, status: response.status })
    return parseOverpassResponse(await response.json())
  }

  throw new Error(`Alle Overpass-Server fehlgeschlagen — ${failures.join(' · ')}`)
}
