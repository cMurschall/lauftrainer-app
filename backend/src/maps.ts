import { json } from './http'
import type { Env } from './types'

/** ~1.1 km at equator; expands outward so nearby routes share one Overpass fetch. */
export const BBOX_GRID_DEG = 0.01
const SUCCESS_MAX_AGE_SEC = 60 * 60 * 24 * 30 // 30 days
const RATE_LIMIT_MAX_AGE_SEC = 90
const ERROR_MAX_AGE_SEC = 30
const OVERPASS_MAX_ATTEMPTS = 3

const BBOX_RE = /^-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?$/

export function quantizeBbox(bbox: string, step = BBOX_GRID_DEG): string {
  const parts = bbox.split(',').map(Number)
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    throw new Error('invalid bbox')
  }
  const [minLat, minLng, maxLat, maxLng] = parts
  const qMinLat = Math.floor(Math.min(minLat, maxLat) / step) * step
  const qMinLng = Math.floor(Math.min(minLng, maxLng) / step) * step
  const qMaxLat = Math.ceil(Math.max(minLat, maxLat) / step) * step
  const qMaxLng = Math.ceil(Math.max(minLng, maxLng) / step) * step
  // Ensure non-zero extent after rounding (tiny routes)
  const maxLatOut = qMaxLat <= qMinLat ? qMinLat + step : qMaxLat
  const maxLngOut = qMaxLng <= qMinLng ? qMinLng + step : qMaxLng
  return [qMinLat, qMinLng, maxLatOut, maxLngOut].map((n) => n.toFixed(4)).join(',')
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function backoffMs(attempt: number, retryAfterHeader: string | null): number {
  if (retryAfterHeader) {
    const seconds = Number(retryAfterHeader)
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(Math.max(seconds * 1000, 250), 12_000)
    }
  }
  return Math.min(400 * 2 ** attempt, 8_000)
}

function withCorsFromRequest(cached: Response, request: Request): Response {
  const responseHeaders = new Headers(cached.headers)
  const requestOrigin = request.headers.get('Origin')
  if (requestOrigin) {
    responseHeaders.set('Access-Control-Allow-Origin', requestOrigin)
  }
  return new Response(cached.body, {
    status: cached.status,
    statusText: cached.statusText,
    headers: responseHeaders,
  })
}

function cacheKeyForBbox(request: Request, quantizedBbox: string): Request {
  const cacheUrl = new URL(request.url)
  cacheUrl.search = ''
  cacheUrl.searchParams.set('bbox', quantizedBbox)
  cacheUrl.searchParams.set('v', '2') // bump to invalidate bad cached payloads after logic changes
  return new Request(cacheUrl.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' },
  })
}

async function putCache(
  cache: Cache,
  cacheKey: Request,
  response: Response,
  ctx: { waitUntil(promise: Promise<unknown>): void },
): Promise<void> {
  ctx.waitUntil(cache.put(cacheKey, response.clone()))
}

async function fetchOverpass(query: string): Promise<Response> {
  let last: Response | null = null
  for (let attempt = 0; attempt < OVERPASS_MAX_ATTEMPTS; attempt++) {
    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: 'data=' + encodeURIComponent(query),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'LaufTrainerApp/1.0 (https://lauftrainer-app.pages.dev)',
      },
    })
    last = response
    if (response.ok) return response
    const retryable = response.status === 429 || response.status === 502 || response.status === 503 || response.status === 504
    if (!retryable || attempt === OVERPASS_MAX_ATTEMPTS - 1) return response
    await sleep(backoffMs(attempt, response.headers.get('Retry-After')))
  }
  return last!
}

function parseMapElements(data: { elements?: any[] }) {
  const waterways: [number, number][][] = []
  const highways: [number, number][][] = []
  const coastlines: [number, number][][] = []
  const residential: [number, number][][] = []
  const forests: [number, number][][] = []

  const pushByTags = (coords: [number, number][], tags: Record<string, string> | undefined) => {
    if (!tags) return
    if (tags.waterway) waterways.push(coords)
    else if (tags.natural === 'coastline') coastlines.push(coords)
    else if (tags.natural === 'water' || tags.water) waterways.push(coords)
    else if (tags.highway) highways.push(coords)
    else if (tags.landuse === 'residential') residential.push(coords)
    else if (tags.landuse === 'forest' || tags.landuse === 'wood' || tags.landuse === 'orchard' || tags.natural === 'wood' || tags.leisure === 'park') {
      forests.push(coords)
    }
  }

  if (data?.elements) {
    for (const el of data.elements) {
      if (el.type === 'way' && el.geometry) {
        const coords = el.geometry.map((pt: { lon: number; lat: number }) => [pt.lon, pt.lat] as [number, number])
        pushByTags(coords, el.tags)
      } else if (el.type === 'relation' && el.members) {
        for (const member of el.members) {
          if (member.type === 'way' && member.geometry) {
            const coords = member.geometry.map((pt: { lon: number; lat: number }) => [pt.lon, pt.lat] as [number, number])
            pushByTags(coords, el.tags || member.tags)
          }
        }
      }
    }
  }

  return { waterways, highways, coastlines, residential, forests }
}

export async function mapContext(request: Request, env: Env, ctx: { waitUntil(promise: Promise<any>): void }): Promise<Response> {
  const url = new URL(request.url)
  const bbox = url.searchParams.get('bbox')
  if (!bbox || !BBOX_RE.test(bbox)) {
    return json({ detail: 'Missing or invalid bbox parameter (format: minLat,minLng,maxLat,maxLng)' }, 400, request, env)
  }

  let quantizedBbox: string
  try {
    quantizedBbox = quantizeBbox(bbox)
  } catch {
    return json({ detail: 'Missing or invalid bbox parameter (format: minLat,minLng,maxLat,maxLng)' }, 400, request, env)
  }

  const cacheKey = cacheKeyForBbox(request, quantizedBbox)
  const cache = (caches as unknown as { default: Cache }).default
  const cachedResponse = await cache.match(cacheKey)
  if (cachedResponse) {
    return withCorsFromRequest(cachedResponse, request)
  }

  const overpassQuery = `[out:json][timeout:15];
(
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential)$"](${quantizedBbox});
  way["waterway"~"^(river|canal)$"](${quantizedBbox});
  way["natural"="coastline"](${quantizedBbox});
  way["natural"="water"](${quantizedBbox});
  relation["natural"="water"](${quantizedBbox});
  way["water"](${quantizedBbox});
  relation["water"](${quantizedBbox});
  way["landuse"="residential"](${quantizedBbox});
  relation["landuse"="residential"](${quantizedBbox});
  way["landuse"~"^(forest|wood|orchard)$"](${quantizedBbox});
  relation["landuse"~"^(forest|wood|orchard)$"](${quantizedBbox});
  way["natural"="wood"](${quantizedBbox});
  relation["natural"="wood"](${quantizedBbox});
  way["leisure"="park"](${quantizedBbox});
  relation["leisure"="park"](${quantizedBbox});
);
out geom;`

  try {
    const response = await fetchOverpass(overpassQuery)

    if (!response.ok) {
      const status = response.status === 429 ? 429 : 502
      const detail =
        response.status === 429
          ? 'Overpass API rate limited; try again shortly'
          : `Overpass API error: ${response.statusText || response.status}`
      const errorResponse = json({ detail }, status, request, env)
      const maxAge = response.status === 429 ? RATE_LIMIT_MAX_AGE_SEC : ERROR_MAX_AGE_SEC
      errorResponse.headers.set('Cache-Control', `public, max-age=${maxAge}`)
      errorResponse.headers.set('Retry-After', String(maxAge))
      await putCache(cache, cacheKey, errorResponse, ctx)
      return errorResponse
    }

    const data = (await response.json()) as { elements?: any[] }
    const finalResponse = json(parseMapElements(data), 200, request, env)
    finalResponse.headers.set('Cache-Control', `public, max-age=${SUCCESS_MAX_AGE_SEC}`)
    finalResponse.headers.set('X-Map-Bbox', quantizedBbox)
    await putCache(cache, cacheKey, finalResponse, ctx)
    return finalResponse
  } catch (error) {
    console.error('Overpass fetch error:', error)
    const errorResponse = json({ detail: 'Failed to fetch map context from OpenStreetMap' }, 502, request, env)
    errorResponse.headers.set('Cache-Control', `public, max-age=${ERROR_MAX_AGE_SEC}`)
    await putCache(cache, cacheKey, errorResponse, ctx)
    return errorResponse
  }
}
