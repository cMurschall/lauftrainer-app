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
  // private.coffee runs a high-capacity instance without a rate limit; the
  // official FOSSGIS instance is the polite fallback. The former kumi.systems
  // host is deliberately absent: it is the same machine under its old name.
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass-api.de/api/interpreter',
]

/** Long enough for a cold cache on a loaded instance, short enough to still try the next one. */
const REQUEST_TIMEOUT_MS = 20_000

/**
 * Requests are snapped outward onto this grid, so the fetched area is larger than
 * the route and can also serve the next run from the same front door.
 *
 * Coarser would reuse better and reveal the location less precisely, but data
 * density varies about twentyfold: measured over one ~11×7 km tile the response
 * is 0.7 MB around a village and 6.6 MB over Hamburg. 0.02° keeps the worst case
 * near what a single city route already costs while still creating overlap.
 */
export const BBOX_GRID_DEG = 0.02

/** Bump when parsing or the query changes; the key carries it, so stale areas are simply never read. */
export const MAP_CONTEXT_VERSION = 4

export const MAP_CONTEXT_KEY_PREFIX = `map:${MAP_CONTEXT_VERSION}:`

/** Cache identity of a map area, shared by every workout that falls inside it. */
export function mapContextCacheKey(bbox: string): string {
  return `${MAP_CONTEXT_KEY_PREFIX}${bbox}`
}

/** Parse the `minLat,minLng,maxLat,maxLng` form used by both Overpass and the cache key. */
export function parseBboxString(bbox: string): BoundingBox | null {
  const parts = bbox.split(',').map(Number)
  if (parts.length !== 4 || parts.some((value) => !Number.isFinite(value))) return null
  const [minLat, minLng, maxLat, maxLng] = parts
  return { minLat, minLng, maxLat, maxLng }
}

export function parseMapContextCacheKey(key: string): BoundingBox | null {
  if (!key.startsWith(MAP_CONTEXT_KEY_PREFIX)) return null
  return parseBboxString(key.slice(MAP_CONTEXT_KEY_PREFIX.length))
}

export function boxContains(outer: BoundingBox, inner: BoundingBox): boolean {
  const eps = 1e-9
  return (
    outer.minLat <= inner.minLat + eps &&
    outer.minLng <= inner.minLng + eps &&
    outer.maxLat >= inner.maxLat - eps &&
    outer.maxLng >= inner.maxLng - eps
  )
}

/**
 * Exact key matching would miss the common case: two routes from the same front
 * door snap to different boxes as soon as one crosses a grid line. So reuse any
 * cached area that already covers what we need, preferring the tightest one.
 */
export function findCoveringAreaKey(cachedKeys: string[], needed: BoundingBox): string | undefined {
  let best: { key: string; area: number } | undefined
  for (const key of cachedKeys) {
    const box = parseMapContextCacheKey(key)
    if (!box || !boxContains(box, needed)) continue
    const area = (box.maxLat - box.minLat) * (box.maxLng - box.minLng)
    if (!best || area < best.area) best = { key, area }
  }
  return best?.key
}

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
export function quantizeBox(box: BoundingBox, step = BBOX_GRID_DEG): BoundingBox {
  const values = [box.minLat, box.minLng, box.maxLat, box.maxLng]
  if (values.some((value) => !Number.isFinite(value))) throw new Error('invalid bounding box')

  // Integer grid indices avoid IEEE drift (0.02 * n is often 0.019999… / 0.020000…).
  const minLatIdx = Math.floor(Math.min(box.minLat, box.maxLat) / step + 1e-12)
  const minLngIdx = Math.floor(Math.min(box.minLng, box.maxLng) / step + 1e-12)
  const maxLatIdx = Math.ceil(Math.max(box.minLat, box.maxLat) / step - 1e-12)
  const maxLngIdx = Math.ceil(Math.max(box.minLng, box.maxLng) / step - 1e-12)

  const minLat = minLatIdx * step
  const minLng = minLngIdx * step
  const maxLat = Math.max(maxLatIdx, minLatIdx + 1) * step
  const maxLng = Math.max(maxLngIdx, minLngIdx + 1) * step

  return { minLat, minLng, maxLat, maxLng }
}

/** The same box in the `minLat,minLng,maxLat,maxLng` form Overpass and the cache key use. */
export function formatBbox(box: BoundingBox): string {
  return [box.minLat, box.minLng, box.maxLat, box.maxLng].map((value) => value.toFixed(4)).join(',')
}

export function quantizeBbox(box: BoundingBox, step = BBOX_GRID_DEG): string {
  return formatBbox(quantizeBox(box, step))
}

/**
 * Each bracketed statement is a separate index lookup, so related tags are
 * merged into single regex statements to keep the query affordable on the
 * public instances. `wr` covers ways and relations; place labels are nodes.
 *
 * Residential streets are deliberately excluded: they dominate the response in
 * any city (a single dense tile grows into the megabytes) while being an
 * indistinguishable tangle at the 240×150 size the preview is drawn at.
 * `landuse=residential` stays, so built-up areas still read as built-up.
 */
export function buildOverpassQuery(bbox: string): string {
  return `[out:json][timeout:20];
(
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary)$"](${bbox});
  wr["natural"~"^(coastline|water|wood)$"](${bbox});
  wr["landuse"~"^(residential|forest|wood|orchard)$"](${bbox});
  wr["leisure"="park"](${bbox});
  wr["water"](${bbox});
  node["place"~"^(city|town|municipality|village|suburb|quarter|neighbourhood|neighborhood|hamlet|locality)$"](${bbox});
);
out geom;`
}

/**
 * Second pass, only fired for rural areas (see `isRuralArea`). In a village the
 * base query leaves the streets empty; out here the extra lookup is cheap and the
 * network actually reads as a network. Kept separate so cities never pay for it.
 */
export function buildResidentialStreetsQuery(bbox: string): string {
  return `[out:json][timeout:20];
way["highway"~"^(residential|living_street|unclassified)$"](${bbox});
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

/**
 * Ranks a whole area by its biggest place label. `town` and above are treated as
 * urban; a stripped-referrer preview never needs residential streets there.
 */
export const URBAN_PLACE_RANK = PLACE_RANK.town

/**
 * Fraction of the tile covered by `landuse=residential` above which the area is
 * dense enough to skip residential streets even without a place label. Villages
 * sit well below this; a suburb or town centre sits above it.
 */
export const RESIDENTIAL_URBAN_COVERAGE = 0.18

/** Shoelace area of a lon/lat ring in degrees²; distortion cancels in the tile ratio. */
function ringAreaDeg(ring: [number, number][]): number {
  if (!ring || ring.length < 3) return 0
  let sum = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    sum += xj * yi - xi * yj
  }
  return Math.abs(sum) / 2
}

/** Share of `area` filled by residential land use, clamped to [0,1]. */
export function residentialCoverage(context: MapContext, area: BoundingBox): number {
  const boxArea = Math.abs((area.maxLat - area.minLat) * (area.maxLng - area.minLng))
  if (boxArea <= 0) return 0
  let covered = 0
  for (const ring of context.residential || []) covered += ringAreaDeg(ring)
  return Math.min(1, covered / boxArea)
}

/** Highest place rank present in a raw Overpass response (0 when none). */
export function maxPlaceRank(data: { elements?: OverpassElement[] } | null | undefined): number {
  let max = 0
  for (const element of data?.elements || []) {
    if (element.type === 'node' && element.tags?.place) {
      max = Math.max(max, PLACE_RANK[element.tags.place] || 0)
    }
  }
  return max
}

/**
 * A place worth adding residential streets to: small enough to stay readable, yet
 * an actual settlement rather than empty countryside a route merely passes through.
 * The settlement gate (a place label or some residential land) keeps the second
 * request from firing on tiles that hold nothing but a through-road or open water.
 */
export function explainRuralDecision(
  context: MapContext,
  area: BoundingBox,
  placeRank: number,
): { rural: boolean; reason: string } {
  const coverage = residentialCoverage(context, area)
  const coveragePct = Math.round(coverage * 100)
  const urbanPct = Math.round(RESIDENTIAL_URBAN_COVERAGE * 100)

  if (placeRank >= URBAN_PLACE_RANK) {
    return {
      rural: false,
      reason: `städtisch — kein Wohnstraßen-Nachladen (Ort-Rang ${placeRank} ≥ ${URBAN_PLACE_RANK})`,
    }
  }
  if (coverage >= RESIDENTIAL_URBAN_COVERAGE) {
    return {
      rural: false,
      reason: `städtisch — kein Wohnstraßen-Nachladen (Wohnfläche ${coveragePct}% ≥ ${urbanPct}%)`,
    }
  }
  if (placeRank > 0 || coverage > 0) {
    const detail =
      placeRank > 0
        ? `Ort-Rang ${placeRank}, Wohnfläche ${coveragePct}%`
        : `Wohnfläche ${coveragePct}%, kein Place-Node`
    return { rural: true, reason: `ländlich — Wohnstraßen nachladen (${detail})` }
  }
  return {
    rural: false,
    reason: 'kein Nachladen — keine Siedlung erkannt (Ort-Rang 0, Wohnfläche 0%)',
  }
}

export function isRuralArea(context: MapContext, area: BoundingBox, placeRank: number): boolean {
  return explainRuralDecision(context, area, placeRank).rural
}

type OverpassGeometry = { lat: number; lon: number }
type OverpassTags = Record<string, string | undefined>
type OverpassElement = {
  type?: string
  tags?: OverpassTags
  lat?: number
  lon?: number
  geometry?: OverpassGeometry[]
  members?: { type?: string; role?: string; tags?: OverpassTags; geometry?: OverpassGeometry[] }[]
}

export function parseOverpassResponse(data: { elements?: OverpassElement[] } | null | undefined): MapContext {
  const context: MapContext = { waterways: [], waterAreas: [], highways: [], coastlines: [], residential: [], forests: [] }
  const places: PlaceCandidate[] = []

  const assign = (coords: [number, number][], tags: OverpassTags | undefined) => {
    if (!tags || coords.length === 0) return
    // River/stream centerlines are omitted on purpose: OSM draws them through
    // lake polygons, and as thick strokes they look like a skeleton over water.
    if (tags.waterway) return
    else if (tags.natural === 'coastline') context.coastlines.push(coords)
    // Deliberately no natural=bay/strait: those rings are coarse envelopes that
    // swallow the coast and the land behind it (for example "Kieler Bucht"
    // spanning 0.4° of latitude), so the coastline stays the authority for sea.
    else if (tags.natural === 'water' || tags.water) {
      context.waterAreas.push(coords)
    }
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
      // Inner members are holes (islands, courtyards). The preview draws flat
      // filled rings, so painting them would cover the hole they cut out.
      const memberWays = element.members.filter(
        (member) => member.type === 'way' && member.geometry && member.role !== 'inner',
      )
      const tags = element.tags || memberWays[0]?.tags
      for (const ring of stitchRings(memberWays.map((member) => toCoords(member.geometry!)))) {
        assign(ring, tags)
      }
    }
  }

  // OSM splits a coast into many ways, so a preview usually receives fragments
  // that meet somewhere inside the frame. Only a fragment running border to
  // border can be closed into a sea polygon, hence join them back together.
  context.coastlines = stitchRings(context.coastlines)
  context.waterAreas = stitchRings(context.waterAreas)

  const placeName = pickLargestPlaceName(places.filter((place) => place.name.length > 0))
  if (placeName) context.placeName = placeName
  return context
}

/**
 * `out geom` returns a multipolygon relation as one entry per member way, so a
 * large lake or bay arrives as open fragments. Join fragments that share an
 * endpoint back into rings, otherwise the area layers drop them as "not closed".
 */
export function stitchRings(fragments: [number, number][][]): [number, number][][] {
  const key = ([lon, lat]: [number, number]) => `${lon.toFixed(7)},${lat.toFixed(7)}`
  const remaining = fragments.filter((fragment) => fragment.length >= 2).map((fragment) => [...fragment])
  const rings: [number, number][][] = []

  while (remaining.length > 0) {
    let ring = remaining.pop() as [number, number][]
    let extended = true
    while (extended && key(ring[0]) !== key(ring[ring.length - 1])) {
      extended = false
      for (let i = 0; i < remaining.length; i += 1) {
        const fragment = remaining[i]
        const head = ring[0]
        const tail = ring[ring.length - 1]
        if (key(fragment[0]) === key(tail)) ring = ring.concat(fragment.slice(1))
        else if (key(fragment[fragment.length - 1]) === key(tail)) {
          ring = ring.concat([...fragment].reverse().slice(1))
        } else if (key(fragment[fragment.length - 1]) === key(head)) {
          ring = fragment.slice(0, -1).concat(ring)
        } else if (key(fragment[0]) === key(head)) {
          ring = [...fragment].reverse().slice(0, -1).concat(ring)
        } else continue
        remaining.splice(i, 1)
        extended = true
        break
      }
    }
    rings.push(ring)
  }

  return rings
}

/**
 * Only a ring that starts where it ends describes an area we can fill. Fragments
 * that stitching could not join stay open, and closing those on their own would
 * paint shapes that do not exist on the ground.
 */
export function isClosedRing(coords: [number, number][] | undefined): boolean {
  if (!coords || coords.length < 4) return false
  const [firstLon, firstLat] = coords[0]
  const [lastLon, lastLat] = coords[coords.length - 1]
  return Math.abs(firstLon - lastLon) < 1e-7 && Math.abs(firstLat - lastLat) < 1e-7
}

/**
 * Sea filling for the coastline layer. OSM coastlines are open lines (land on the
 * left, water on the right of the way direction), so to paint the sea we clip the
 * line to the preview rectangle and close it along the border on the water side.
 * We work in the projected SVG pixel space, where a y-flip turns "water right" in
 * geo into the normal (-dy, dx) — derived and pinned down by unit tests.
 */
export type SvgPoint = [number, number]

const mod = (value: number, n: number): number => ((value % n) + n) % n

function onBorder([x, y]: SvgPoint, width: number, height: number, eps = 0.5): boolean {
  return x <= eps || x >= width - eps || y <= eps || y >= height - eps
}

/** Liang–Barsky: clip one segment to [0,width]×[0,height]; null if fully outside. */
function clipSegment(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  width: number,
  height: number,
): { a: SvgPoint; b: SvgPoint; t0: number; t1: number } | null {
  const dx = x1 - x0
  const dy = y1 - y0
  const p = [-dx, dx, -dy, dy]
  const q = [x0, width - x0, y0, height - y0]
  let t0 = 0
  let t1 = 1
  for (let i = 0; i < 4; i += 1) {
    if (p[i] === 0) {
      if (q[i] < 0) return null
    } else {
      const r = q[i] / p[i]
      if (p[i] < 0) {
        if (r > t1) return null
        if (r > t0) t0 = r
      } else {
        if (r < t0) return null
        if (r < t1) t1 = r
      }
    }
  }
  return { a: [x0 + t0 * dx, y0 + t0 * dy], b: [x0 + t1 * dx, y0 + t1 * dy], t0, t1 }
}

/** Split a polyline into the chains that lie inside the rectangle. */
export function clipPolylineToRect(points: SvgPoint[], width: number, height: number): SvgPoint[][] {
  const chains: SvgPoint[][] = []
  let current: SvgPoint[] = []
  const flush = () => {
    if (current.length >= 2) chains.push(current)
    current = []
  }
  const near = (a: SvgPoint, b: SvgPoint) => Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6

  for (let i = 0; i < points.length - 1; i += 1) {
    const clip = clipSegment(points[i][0], points[i][1], points[i + 1][0], points[i + 1][1], width, height)
    if (!clip) continue
    if (current.length === 0) current.push(clip.a)
    else if (!near(current[current.length - 1], clip.a)) {
      flush()
      current.push(clip.a)
    }
    current.push(clip.b)
    if (clip.t1 < 1 - 1e-9) flush()
  }
  flush()
  return chains
}

const BORDER_CORNERS: SvgPoint[] = [
  [0, 0],
  [0, 0],
  [0, 0],
  [0, 0],
]

function borderParam([x, y]: SvgPoint, width: number, height: number): number {
  const eps = 0.5
  if (y <= eps) return x
  if (x >= width - eps) return width + y
  if (y >= height - eps) return width + height + (width - x)
  return 2 * width + height + (height - y)
}

/** Corner points passed when walking the rectangle border from `from` to `to`. */
export function borderWalk(
  from: SvgPoint,
  to: SvgPoint,
  dir: 1 | -1,
  width: number,
  height: number,
): SvgPoint[] {
  const perimeter = 2 * (width + height)
  BORDER_CORNERS[0] = [0, 0]
  BORDER_CORNERS[1] = [width, 0]
  BORDER_CORNERS[2] = [width, height]
  BORDER_CORNERS[3] = [0, height]
  const cornerT = [0, width, width + height, 2 * width + height]
  const tf = borderParam(from, width, height)
  const tt = borderParam(to, width, height)
  const span = dir > 0 ? mod(tt - tf, perimeter) : mod(tf - tt, perimeter)
  const items: Array<{ d: number; point: SvgPoint }> = []
  for (let i = 0; i < 4; i += 1) {
    const d = dir > 0 ? mod(cornerT[i] - tf, perimeter) : mod(tf - cornerT[i], perimeter)
    if (d > 1e-6 && d < span - 1e-6) items.push({ d, point: BORDER_CORNERS[i] })
  }
  items.sort((a, b) => a.d - b.d)
  return items.map((item) => item.point)
}

export function pointInPolygon([px, py]: SvgPoint, polygon: SvgPoint[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, yi] = polygon[i]
    const [xj, yj] = polygon[j]
    const intersects = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi
    if (intersects) inside = !inside
  }
  return inside
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/**
 * Turn open coastline polylines (already projected to SVG space, in way order)
 * into filled sea polygons by closing them along the preview border on the water
 * side. Closed rings (islands/enclosed water) are left to the area layers.
 */
export function buildSeaPolygons(
  coastlines: SvgPoint[][],
  width: number,
  height: number,
  debug?: string[],
): SvgPoint[][] {
  const polygons: SvgPoint[][] = []
  const round = ([x, y]: SvgPoint) => `${x.toFixed(0)},${y.toFixed(0)}`
  debug?.push(`coastlines=${coastlines.length}`)

  for (const [lineIndex, line] of coastlines.entries()) {
    if (line.length >= 4 && isClosedRing(line)) {
      debug?.push(`line ${lineIndex}: geschlossener Ring übersprungen (${line.length} Punkte)`)
      continue
    }
    const chains = clipPolylineToRect(line, width, height)
    debug?.push(`line ${lineIndex}: ${line.length} Punkte → ${chains.length} Kette(n) im Bild`)
    for (const [chainIndex, chain] of chains.entries()) {
      if (chain.length < 2) continue
      const start = chain[0]
      const end = chain[chain.length - 1]
      if (!onBorder(start, width, height) || !onBorder(end, width, height)) {
        debug?.push(
          `  Kette ${chainIndex}: Enden nicht am Rand (${round(start)} → ${round(end)}), keine Füllung möglich`,
        )
        continue
      }

      const [x0, y0] = chain[0]
      const [x1, y1] = chain[1]
      let nx = -(y1 - y0)
      let ny = x1 - x0
      const len = Math.hypot(nx, ny) || 1
      nx /= len
      ny /= len
      const testPoint: SvgPoint = [
        clamp((x0 + x1) / 2 + nx * 2, 0.1, width - 0.1),
        clamp((y0 + y1) / 2 + ny * 2, 0.1, height - 0.1),
      ]

      let matched = false
      for (const dir of [1, -1] as const) {
        const polygon = [...chain, ...borderWalk(end, start, dir, width, height)]
        if (pointInPolygon(testPoint, polygon)) {
          polygons.push(polygon)
          debug?.push(
            `  Kette ${chainIndex}: ${round(start)} → ${round(end)}, Wasserseite ${round(testPoint)}, ` +
              `Randlauf ${dir > 0 ? 'vorwärts' : 'rückwärts'}, ${polygon.length} Punkte → Meer gefüllt`,
          )
          matched = true
          break
        }
      }
      if (!matched) {
        debug?.push(
          `  Kette ${chainIndex}: ${round(start)} → ${round(end)}, Wasserseite ${round(testPoint)} ` +
            `liegt in keinem der beiden Randläufe`,
        )
      }
    }
  }

  debug?.push(`Meeresflächen: ${polygons.length}`)
  return polygons
}

/**
 * Cached contexts from earlier versions can be empty (for example when a proxy
 * answered without data), so treat those as a miss instead of a valid answer.
 */
export function hasMapDetails(context: Partial<MapContext> | null | undefined): boolean {
  if (!context) return false
  return [context.waterways, context.waterAreas, context.highways, context.coastlines, context.residential, context.forests].some(
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
  /** Which query is running: the base layers, the rural street add-on, or the rural/urban decision. */
  phase?: 'base' | 'streets' | 'decide'
  /** Human-readable rural/urban verdict, set when `phase` is `decide`. */
  decision?: string
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
      // The Overpass usage policy requires a User-Agent or Referer identifying
      // the app, and overpass-api.de answers 406 to any browser that sends
      // neither. A browser cannot set User-Agent, so we send the origin only:
      // enough to identify the app, without leaking which page the user is on.
      referrerPolicy: 'origin',
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }
}

/** Overpass signals overload and client rejection through distinct statuses. */
export function describeHttpFailure(status: number): string {
  if (status === 429 || status === 504) return 'überlastet'
  // Apache on overpass-api.de rejects requests that identify neither via
  // User-Agent nor Referer, which is what a stripped referrer looks like.
  if (status === 406) return 'lehnt den Browser-Zugriff ab (kein Referer)'
  return 'Fehler'
}

interface OverpassResult {
  data: { elements?: OverpassElement[] }
  /** The mirror that answered, so a follow-up query can start with the warm one. */
  url: string
}

/** Walk the mirrors for one query, returning the first successful JSON body. */
async function fetchOverpassJson(
  query: string,
  endpoints: string[],
  timeoutMs: number,
  phase: 'base' | 'streets',
  onProgress?: (progress: MapContextProgress) => void,
): Promise<OverpassResult> {
  const failures: string[] = []

  for (const [index, url] of endpoints.entries()) {
    const label = endpointLabel(url)
    const progress: MapContextProgress = { endpoint: label, attempt: index + 1, total: endpoints.length, phase }
    onProgress?.(progress)

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
      onProgress?.({ ...progress, durationMs: Date.now() - startedAt, error: reason })
      continue
    }

    const durationMs = Date.now() - startedAt
    if (!response.ok) {
      const reason = describeHttpFailure(response.status)
      failures.push(`${label}: ${reason} (${response.status})`)
      onProgress?.({ ...progress, durationMs, status: response.status, error: `${reason} (${response.status})` })
      continue
    }

    onProgress?.({ ...progress, durationMs, status: response.status })
    return { data: await response.json(), url }
  }

  throw new Error(`Alle Overpass-Server fehlgeschlagen — ${failures.join(' · ')}`)
}

/** Put `preferred` first so a warm mirror is retried before the ones that just stalled. */
function endpointsPreferring(endpoints: string[], preferred: string): string[] {
  const rest = endpoints.filter((url) => url !== preferred)
  return endpoints.includes(preferred) ? [preferred, ...rest] : endpoints
}

/**
 * Merge the rural street layer into `context`, in place. Clears `streetsPending`
 * on success and sets it on failure, so an unreachable Overpass leaves a marker
 * to retry rather than a permanently street-less cache entry.
 */
async function addResidentialStreets(
  bbox: string,
  context: MapContext,
  endpoints: string[],
  timeoutMs: number,
  onProgress?: (progress: MapContextProgress) => void,
): Promise<boolean> {
  try {
    const streets = await fetchOverpassJson(
      buildResidentialStreetsQuery(bbox),
      endpoints,
      timeoutMs,
      'streets',
      onProgress,
    )
    const parsed = parseOverpassResponse(streets.data)
    if (parsed.highways.length) context.highways = context.highways.concat(parsed.highways)
    delete context.streetsPending
    return true
  } catch {
    // The per-attempt progress already reported why; the base context stands.
    context.streetsPending = true
    return false
  }
}

export async function fetchMapContext(bbox: string, options: FetchMapContextOptions = {}): Promise<MapContext> {
  const endpoints = options.endpoints?.length ? options.endpoints : OVERPASS_ENDPOINTS
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS

  const base = await fetchOverpassJson(buildOverpassQuery(bbox), endpoints, timeoutMs, 'base', options.onProgress)
  const context = parseOverpassResponse(base.data)

  // Rural tiles get a second, street-only pass; cities never do (see isRuralArea).
  const area = parseBboxString(bbox)
  if (area) {
    const verdict = explainRuralDecision(context, area, maxPlaceRank(base.data))
    options.onProgress?.({
      endpoint: 'decide',
      attempt: 0,
      total: 0,
      phase: 'decide',
      decision: verdict.reason,
    })
    if (verdict.rural) {
      // Start with the mirror that just answered: retrying one that timed out in
      // the base pass would burn another full timeout for nothing.
      await addResidentialStreets(bbox, context, endpointsPreferring(endpoints, base.url), timeoutMs, options.onProgress)
    }
  }

  return context
}

/**
 * Complete a cached area whose street pass failed earlier. Returns true when the
 * context gained something and is worth writing back to IndexedDB.
 */
export async function completeMapContext(
  bbox: string,
  context: MapContext,
  options: FetchMapContextOptions = {},
): Promise<boolean> {
  if (!context.streetsPending) return false
  const endpoints = options.endpoints?.length ? options.endpoints : OVERPASS_ENDPOINTS
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS
  return await addResidentialStreets(bbox, context, endpoints, timeoutMs, options.onProgress)
}
