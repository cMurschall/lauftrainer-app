import type { ActivityRecord, MapContext } from '../types/workout'

/**
 * Overpass rejects requests coming from shared cloud egress IPs, so the browser
 * queries it directly: every device uses its own quota and the bounding box
 * never reaches our backend.
 */
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter'
const REQUEST_TIMEOUT_MS = 30_000

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

export function buildOverpassQuery(bbox: string): string {
  return `[out:json][timeout:25];
(
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential)$"](${bbox});
  way["waterway"~"^(river|canal)$"](${bbox});
  way["natural"="coastline"](${bbox});
  way["natural"="water"](${bbox});
  relation["natural"="water"](${bbox});
  way["water"](${bbox});
  relation["water"](${bbox});
  way["landuse"="residential"](${bbox});
  relation["landuse"="residential"](${bbox});
  way["landuse"~"^(forest|wood|orchard)$"](${bbox});
  relation["landuse"~"^(forest|wood|orchard)$"](${bbox});
  way["natural"="wood"](${bbox});
  relation["natural"="wood"](${bbox});
  way["leisure"="park"](${bbox});
  relation["leisure"="park"](${bbox});
);
out geom;`
}

type OverpassGeometry = { lat: number; lon: number }
type OverpassTags = Record<string, string | undefined>
type OverpassElement = {
  type?: string
  tags?: OverpassTags
  geometry?: OverpassGeometry[]
  members?: { type?: string; tags?: OverpassTags; geometry?: OverpassGeometry[] }[]
}

export function parseOverpassResponse(data: { elements?: OverpassElement[] } | null | undefined): MapContext {
  const context: MapContext = { waterways: [], highways: [], coastlines: [], residential: [], forests: [] }

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

export async function fetchMapContext(bbox: string): Promise<MapContext> {
  const response = await fetch(OVERPASS_URL, {
    method: 'POST',
    body: new URLSearchParams({ data: buildOverpassQuery(bbox) }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })

  if (!response.ok) {
    const reason = response.status === 429 || response.status === 504 ? 'busy' : 'error'
    throw new Error(`Overpass ${reason} (${response.status})`)
  }

  return parseOverpassResponse(await response.json())
}
