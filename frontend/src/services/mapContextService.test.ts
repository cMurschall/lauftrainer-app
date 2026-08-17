import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BBOX_GRID_DEG,
  boundingBoxFromRecords,
  boxContains,
  buildOverpassQuery,
  buildResidentialStreetsQuery,
  completeMapContext,
  describeHttpFailure,
  fetchMapContext,
  findCoveringAreaKey,
  formatBbox,
  isRuralArea,
  type MapContext,
  maxPlaceRank,
  explainRuralDecision,
  parseBboxString,
  parseMapContextCacheKey,
  residentialCoverage,
  RESIDENTIAL_URBAN_COVERAGE,
  quantizeBox,
  borderWalk,
  buildSeaPolygons,
  clipPolylineToRect,
  hasMapDetails,
  isClosedRing,
  MAP_CONTEXT_KEY_PREFIX,
  mapContextCacheKey,
  OVERPASS_ENDPOINTS,
  pointInPolygon,
  parseOverpassResponse,
  pickLargestPlaceName,
  quantizeBbox,
  stitchRings,
} from './mapContextService'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('boundingBoxFromRecords', () => {
  it('pads the box around the recorded track', () => {
    const box = boundingBoxFromRecords([
      { elapsedSeconds: 0, latitude: 54.38, longitude: 10.48 },
      { elapsedSeconds: 60, latitude: 54.39, longitude: 10.52 },
    ])
    expect(box).not.toBeNull()
    expect(box!.minLat).toBeLessThan(54.38)
    expect(box!.maxLat).toBeGreaterThan(54.39)
    expect(box!.minLng).toBeLessThan(10.48)
    expect(box!.maxLng).toBeGreaterThan(10.52)
  })

  it('returns null when fewer than two records carry coordinates', () => {
    expect(boundingBoxFromRecords([])).toBeNull()
    expect(boundingBoxFromRecords([{ elapsedSeconds: 0, latitude: 54.38, longitude: 10.48 }])).toBeNull()
    expect(
      boundingBoxFromRecords([
        { elapsedSeconds: 0, heartRateBpm: 140 },
        { elapsedSeconds: 60, heartRateBpm: 150 },
      ]),
    ).toBeNull()
  })
})

describe('quantizeBbox', () => {
  it('expands outward onto the grid', () => {
    expect(quantizeBbox({ minLat: 54.370410, minLng: 10.470927, maxLat: 54.395485, maxLng: 10.522751 })).toBe(
      '54.3600,10.4600,54.4000,10.5400',
    )
  })

  it('never returns a box smaller than the route it has to cover', () => {
    const route = { minLat: 54.370410, minLng: 10.470927, maxLat: 54.395485, maxLng: 10.522751 }
    expect(boxContains(quantizeBox(route), route)).toBe(true)
  })

  it('lets nearby boxes share one cache key', () => {
    const a = quantizeBbox({ minLat: 54.370410, minLng: 10.470927, maxLat: 54.395485, maxLng: 10.522751 })
    const b = quantizeBbox({ minLat: 54.370500, minLng: 10.471000, maxLat: 54.395400, maxLng: 10.522700 })
    expect(a).toBe(b)
  })

  it('keeps a non-zero cell for tiny routes', () => {
    const [minLat, minLng, maxLat, maxLng] = quantizeBbox({
      minLat: 54.3712,
      minLng: 10.4811,
      maxLat: 54.3712,
      maxLng: 10.4811,
    })
      .split(',')
      .map(Number)
    expect(maxLat - minLat).toBeCloseTo(BBOX_GRID_DEG, 6)
    expect(maxLng - minLng).toBeCloseTo(BBOX_GRID_DEG, 6)
  })
})

describe('parseOverpassResponse', () => {
  it('sorts ways and relation members into layers as [lon, lat]', () => {
    const context = parseOverpassResponse({
      elements: [
        { type: 'way', tags: { highway: 'residential' }, geometry: [{ lat: 1, lon: 2 }, { lat: 3, lon: 4 }] },
        { type: 'way', tags: { waterway: 'river' }, geometry: [{ lat: 5, lon: 6 }, { lat: 5.1, lon: 6.1 }] },
        { type: 'way', tags: { natural: 'coastline' }, geometry: [{ lat: 7, lon: 8 }, { lat: 7.1, lon: 8.1 }] },
        { type: 'way', tags: { landuse: 'residential' }, geometry: [{ lat: 9, lon: 10 }, { lat: 9.1, lon: 10.1 }] },
        {
          type: 'relation',
          tags: { leisure: 'park' },
          members: [{ type: 'way', geometry: [{ lat: 11, lon: 12 }, { lat: 11.1, lon: 12.1 }] }],
        },
      ],
    })

    expect(context.highways).toEqual([[[2, 1], [4, 3]]])
    // River centerlines are dropped so they do not cut across lake fills.
    expect(context.waterways).toEqual([])
    expect(context.coastlines).toEqual([[[8, 7], [8.1, 7.1]]])
    expect(context.residential).toEqual([[[10, 9], [10.1, 9.1]]])
    expect(context.forests).toEqual([[[12, 11], [12.1, 11.1]]])
    expect(context.placeName).toBeUndefined()
  })

  it('picks the largest named place from place nodes', () => {
    const context = parseOverpassResponse({
      elements: [
        { type: 'node', lat: 54.3, lon: 10.1, tags: { place: 'suburb', name: 'Gaarden', population: '20000' } },
        { type: 'node', lat: 54.32, lon: 10.13, tags: { place: 'city', name: 'Kiel', population: '247000' } },
        { type: 'node', lat: 54.31, lon: 10.12, tags: { place: 'village', name: 'Möltenort' } },
        { type: 'way', tags: { highway: 'primary' }, geometry: [{ lat: 1, lon: 2 }] },
      ],
    })
    expect(context.placeName).toBe('Kiel')
    expect(context.highways).toHaveLength(1)
  })

  it('tolerates empty and malformed payloads', () => {
    expect(parseOverpassResponse(undefined)).toEqual({
      waterways: [],
      waterAreas: [],
      highways: [],
      coastlines: [],
      residential: [],
      forests: [],
    })
    expect(parseOverpassResponse({ elements: [{ type: 'node' }] }).highways).toEqual([])
  })
})

describe('map area cache keys', () => {
  const areaKeyFor = (records: Parameters<typeof boundingBoxFromRecords>[0]) =>
    mapContextCacheKey(quantizeBbox(boundingBoxFromRecords(records)!))

  it('round-trips a key back into the box it describes', () => {
    const key = mapContextCacheKey('54.3500,10.5000,54.4000,10.5500')
    expect(key.startsWith(MAP_CONTEXT_KEY_PREFIX)).toBe(true)
    expect(parseMapContextCacheKey(key)).toEqual({ minLat: 54.35, minLng: 10.5, maxLat: 54.4, maxLng: 10.55 })
    expect(parseMapContextCacheKey('someWorkoutId')).toBeNull()
    expect(parseMapContextCacheKey(`${MAP_CONTEXT_KEY_PREFIX}nonsense`)).toBeNull()
  })

  it('separates distant areas', () => {
    const kiel = quantizeBbox({ minLat: 54.32, minLng: 10.13, maxLat: 54.33, maxLng: 10.14 })
    const hamburg = quantizeBbox({ minLat: 53.55, minLng: 9.99, maxLat: 53.56, maxLng: 10.0 })
    expect(mapContextCacheKey(kiel)).not.toBe(mapContextCacheKey(hamburg))
  })

  it('reuses a cached area for a second route from the same front door', () => {
    // Snapping alone is not enough: this pair straddles a grid line, so the two
    // keys differ and only a containment check turns the second one into a hit.
    const first = areaKeyFor([
      { elapsedSeconds: 0, latitude: 54.3614, longitude: 10.5359 },
      { elapsedSeconds: 60, latitude: 54.3702, longitude: 10.5461 },
    ])
    const secondBox = quantizeBox(
      boundingBoxFromRecords([
        { elapsedSeconds: 0, latitude: 54.3650, longitude: 10.5390 },
        { elapsedSeconds: 60, latitude: 54.3688, longitude: 10.5420 },
      ])!,
    )
    expect(mapContextCacheKey(formatBbox(secondBox))).not.toBe(first)
    expect(findCoveringAreaKey([first], secondBox)).toBe(first)
  })

  it('ignores cached areas that do not cover the route and unrelated keys', () => {
    const hamburg = mapContextCacheKey(quantizeBbox({ minLat: 53.55, minLng: 9.99, maxLat: 53.56, maxLng: 10.0 }))
    const needed = quantizeBox({ minLat: 54.36, minLng: 10.53, maxLat: 54.37, maxLng: 10.54 })
    expect(findCoveringAreaKey([hamburg, 'legacyWorkoutId'], needed)).toBeUndefined()
  })

  it('reuses a larger cached area for a shorter route that sits inside it', () => {
    // Regression: we used to require the quantized fetch box to fit, so a short
    // run next to a longer cached one still missed and hit Overpass again.
    const longRun = mapContextCacheKey('54.3400,10.5000,54.4000,10.5600')
    const shortRoute = { minLat: 54.361, minLng: 10.53, maxLat: 54.37, maxLng: 10.54 }
    expect(findCoveringAreaKey([longRun], shortRoute)).toBe(longRun)
    expect(findCoveringAreaKey([longRun], quantizeBox(shortRoute))).toBe(longRun)
  })

  it('prefers the tightest covering area, keeping the preview close to the route', () => {
    const needed = quantizeBox({ minLat: 54.36, minLng: 10.53, maxLat: 54.37, maxLng: 10.54 })
    const tight = mapContextCacheKey(formatBbox(needed))
    const wide = mapContextCacheKey('54.0000,10.0000,55.0000,11.0000')
    expect(findCoveringAreaKey([wide, tight], needed)).toBe(tight)
  })
})

describe('pickLargestPlaceName', () => {
  it('ranks cities above villages even with lower population', () => {
    expect(
      pickLargestPlaceName([
        { name: 'Dorf', place: 'village', population: 5000 },
        { name: 'Stadt', place: 'city', population: 1000 },
      ]),
    ).toBe('Stadt')
  })

  it('breaks ties with population then name length', () => {
    expect(
      pickLargestPlaceName([
        { name: 'Nord', place: 'suburb', population: 100 },
        { name: 'Südviertel', place: 'suburb', population: 100 },
        { name: 'Ost', place: 'suburb', population: 500 },
      ]),
    ).toBe('Ost')
  })

  it('returns undefined for an empty list', () => {
    expect(pickLargestPlaceName([])).toBeUndefined()
  })
})

describe('fetchMapContext', () => {
  it('posts the query to Overpass and parses the result', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ elements: [{ type: 'way', tags: { highway: 'primary' }, geometry: [{ lat: 1, lon: 2 }] }] }), {
        status: 200,
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const context = await fetchMapContext('54.3700,10.4700,54.4000,10.5300')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(OVERPASS_ENDPOINTS[0])
    expect(init.method).toBe('POST')
    expect(String(init.body)).toContain('54.3700%2C10.4700%2C54.4000%2C10.5300')
    expect(context.highways).toEqual([[[2, 1]]])
  })

  it('throws with the status when Overpass rejects the request', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('rate limited', { status: 429 })))
    await expect(fetchMapContext('54.3700,10.4700,54.4000,10.5300')).rejects.toThrow(/429/)
  })

  it('identifies the app by origin, since overpass-api.de answers 406 without a referer', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ elements: [] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await fetchMapContext('54.3700,10.4700,54.4000,10.5300')

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    // 'origin' identifies the app without revealing which page the user is on.
    expect(init.referrerPolicy).toBe('origin')
  })

  it('names a 406 rejection so it is not mistaken for server overload', async () => {
    expect(describeHttpFailure(406)).toContain('Referer')
    expect(describeHttpFailure(429)).toBe('überlastet')
    expect(describeHttpFailure(504)).toBe('überlastet')
    expect(describeHttpFailure(500)).toBe('Fehler')
  })

  it('lists each Overpass host once, so a fallback is a genuinely different server', () => {
    const hosts = OVERPASS_ENDPOINTS.map((url) => new URL(url).host)
    expect(new Set(hosts).size).toBe(hosts.length)
    // overpass.kumi.systems is the old name of overpass.private.coffee.
    expect(hosts).not.toContain('overpass.kumi.systems')
  })

  it('reports an opaque transport failure as a missing HTTP response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Load failed')
    }))
    await expect(fetchMapContext('54.3700,10.4700,54.4000,10.5300')).rejects.toThrow(/keine HTTP-Antwort/)
  })

  it('reports an aborted request as a timeout', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new DOMException('The operation timed out.', 'TimeoutError')
    }))
    await expect(fetchMapContext('54.3700,10.4700,54.4000,10.5300')).rejects.toThrow(/Timeout/i)
  })

  it('walks the configured mirrors in order until one answers', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Load failed'))
      .mockResolvedValue(
        new Response(JSON.stringify({ elements: [{ type: 'way', tags: { highway: 'primary' }, geometry: [{ lat: 1, lon: 2 }] }] }), {
          status: 200,
        }),
      )
    vi.stubGlobal('fetch', fetchMock)

    const context = await fetchMapContext('54.3700,10.4700,54.4000,10.5300')

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual(OVERPASS_ENDPOINTS.slice(0, 2))
    expect(context.highways).toEqual([[[2, 1]]])
  })

  it('reports every attempt, its status and the eventual success', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Load failed'))
      .mockResolvedValueOnce(new Response('busy', { status: 504 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ elements: [] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const progress: string[] = []

    await fetchMapContext('54.3700,10.4700,54.4000,10.5300', {
      endpoints: ['https://a.example/api', 'https://b.example/api', 'https://c.example/api'],
      onProgress: (event) => progress.push(`${event.endpoint} ${event.status ?? event.error ?? 'start'}`),
    })

    expect(progress.some((line) => line.includes('keine HTTP-Antwort'))).toBe(true)
    expect(progress.some((line) => line.includes('504'))).toBe(true)
    expect(progress.some((line) => line.includes('200'))).toBe(true)
  })

  it('names every failing mirror once none answers', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('busy', { status: 504 })))
    const error = await fetchMapContext('54.3700,10.4700,54.4000,10.5300').catch((e: Error) => e)
    for (const endpoint of OVERPASS_ENDPOINTS) {
      expect((error as Error).message).toContain(new URL(endpoint).host)
    }
  })

  it('stops waiting for a mirror after the timeout and moves on', async () => {
    vi.useFakeTimers()
    try {
      const fetchMock = vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
          }),
      )
      vi.stubGlobal('fetch', fetchMock)

      const pending = fetchMapContext('54.3700,10.4700,54.4000,10.5300', { timeoutMs: 1000 }).catch(
        (e: Error) => e.message,
      )
      await vi.advanceTimersByTimeAsync(1000 * OVERPASS_ENDPOINTS.length)

      expect(await pending).toContain('Timeout')
      expect(fetchMock).toHaveBeenCalledTimes(OVERPASS_ENDPOINTS.length)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('stitchRings', () => {
  it('joins fragments that share an endpoint, regardless of their direction', () => {
    const rings = stitchRings([
      [
        [10, 54],
        [10.1, 54],
      ],
      // Reversed on purpose: OSM way direction inside a relation is arbitrary.
      [
        [10.1, 54.1],
        [10.1, 54],
      ],
      [
        [10.1, 54.1],
        [10, 54],
      ],
    ])
    expect(rings).toHaveLength(1)
    expect(isClosedRing(rings[0])).toBe(true)
  })

  it('keeps unrelated fragments apart and leaves an open coast open', () => {
    const rings = stitchRings([
      [
        [10, 54],
        [10.1, 54],
      ],
      [
        [10.1, 54],
        [10.2, 54],
      ],
      [
        [11, 55],
        [11.1, 55],
      ],
    ])
    expect(rings).toHaveLength(2)
    expect(rings.map((ring) => ring.length).sort()).toEqual([2, 3])
    expect(rings.some((ring) => isClosedRing(ring))).toBe(false)
  })
})

describe('parseOverpassResponse coastline stitching', () => {
  it('merges split coastline ways so the chain can reach the preview border', () => {
    const context = parseOverpassResponse({
      elements: [
        {
          type: 'way',
          tags: { natural: 'coastline' },
          geometry: [
            { lat: 54.3649, lon: 10.5944 },
            { lat: 54.3797, lon: 10.5392 },
          ],
        },
        {
          type: 'way',
          tags: { natural: 'coastline' },
          geometry: [
            { lat: 54.3797, lon: 10.5392 },
            { lat: 54.3898, lon: 10.4835 },
          ],
        },
      ],
    })
    expect(context.coastlines).toHaveLength(1)
    expect(context.coastlines[0]).toHaveLength(3)
  })

  it('skips inner relation members, which are holes rather than areas', () => {
    const island = [
      { lat: 54.37, lon: 10.52 },
      { lat: 54.372, lon: 10.522 },
      { lat: 54.371, lon: 10.524 },
      { lat: 54.37, lon: 10.52 },
    ]
    const context = parseOverpassResponse({
      elements: [
        {
          type: 'relation',
          tags: { natural: 'water', name: 'See mit Insel' },
          members: [
            {
              type: 'way',
              role: 'outer',
              geometry: [
                { lat: 54.36, lon: 10.51 },
                { lat: 54.38, lon: 10.51 },
                { lat: 54.38, lon: 10.53 },
                { lat: 54.36, lon: 10.51 },
              ],
            },
            { type: 'way', role: 'inner', geometry: island },
          ],
        },
      ],
    })
    expect(context.waterAreas).toHaveLength(1)
    expect(context.waterAreas[0]).not.toContainEqual([10.522, 54.372])
  })

  it('ignores natural=bay, whose ring also covers the land behind the coast', () => {
    const context = parseOverpassResponse({
      elements: [
        {
          type: 'way',
          tags: { natural: 'bay', name: 'Kieler Bucht' },
          geometry: [
            { lat: 54.31, lon: 10.01 },
            { lat: 54.71, lon: 11.05 },
            { lat: 54.31, lon: 10.01 },
          ],
        },
      ],
    })
    expect(context.waterAreas).toHaveLength(0)
    expect(buildOverpassQuery('54,10,55,11')).not.toContain('bay')
  })
})

describe('isClosedRing', () => {
  it('accepts a ring whose last point repeats the first', () => {
    expect(
      isClosedRing([
        [10, 54],
        [10.1, 54],
        [10.1, 54.1],
        [10, 54],
      ]),
    ).toBe(true)
  })

  it('rejects open multipolygon fragments and degenerate input', () => {
    expect(
      isClosedRing([
        [10, 54],
        [10.1, 54],
        [10.1, 54.1],
        [10.2, 54.2],
      ]),
    ).toBe(false)
    expect(isClosedRing(undefined)).toBe(false)
    expect(isClosedRing([[10, 54], [10, 54]])).toBe(false)
  })
})

describe('sea fill geometry', () => {
  const W = 240
  const H = 150

  it('clips a polyline crossing the viewport into a bordered chain', () => {
    const chains = clipPolylineToRect(
      [
        [120, -10],
        [120, 160],
      ],
      W,
      H,
    )
    expect(chains).toHaveLength(1)
    expect(chains[0][0]).toEqual([120, 0])
    expect(chains[0][chains[0].length - 1]).toEqual([120, 150])
  })

  it('splits a polyline that leaves and re-enters into separate chains', () => {
    const chains = clipPolylineToRect(
      [
        [10, 10],
        [10, -20],
        [200, -20],
        [200, 20],
      ],
      W,
      H,
    )
    expect(chains.length).toBe(2)
    for (const chain of chains) {
      expect(chain.length).toBeGreaterThanOrEqual(2)
    }
  })

  it('walks the border between two edge points collecting the corners in between', () => {
    // From bottom edge to top edge, going left should pass the two left corners.
    expect(borderWalk([120, 150], [120, 0], 1, W, H)).toEqual([
      [0, 150],
      [0, 0],
    ])
    // The other direction passes the two right corners.
    expect(borderWalk([120, 150], [120, 0], -1, W, H)).toEqual([
      [240, 150],
      [240, 0],
    ])
  })

  it('tests point-in-polygon for a simple rectangle', () => {
    const square: Array<[number, number]> = [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ]
    expect(pointInPolygon([50, 50], square)).toBe(true)
    expect(pointInPolygon([150, 50], square)).toBe(false)
  })

  it('fills the water side of a coastline running down the middle', () => {
    // Way heading south (down in SVG); OSM keeps water on the right, which the
    // y-flip turns into the left half (x < 120) of the preview.
    const polygons = buildSeaPolygons(
      [
        [
          [120, -10],
          [120, 160],
        ],
      ],
      W,
      H,
    )
    expect(polygons).toHaveLength(1)
    expect(pointInPolygon([60, 75], polygons[0])).toBe(true)
    expect(pointInPolygon([180, 75], polygons[0])).toBe(false)
  })

  it('flips the water side when the coastline runs the other way', () => {
    const polygons = buildSeaPolygons(
      [
        [
          [120, 160],
          [120, -10],
        ],
      ],
      W,
      H,
    )
    expect(polygons).toHaveLength(1)
    expect(pointInPolygon([180, 75], polygons[0])).toBe(true)
    expect(pointInPolygon([60, 75], polygons[0])).toBe(false)
  })

  it('ignores closed rings and lines that never reach the border', () => {
    expect(
      buildSeaPolygons(
        [
          [
            [10, 10],
            [50, 10],
            [50, 50],
            [10, 50],
            [10, 10],
          ],
        ],
        W,
        H,
      ),
    ).toEqual([])
    expect(
      buildSeaPolygons(
        [
          [
            [100, 70],
            [140, 80],
          ],
        ],
        W,
        H,
      ),
    ).toEqual([])
  })
})

describe('hasMapDetails', () => {
  it('treats missing and empty cached contexts as unusable', () => {
    expect(hasMapDetails(undefined)).toBe(false)
    expect(hasMapDetails(null)).toBe(false)
    expect(hasMapDetails({ waterways: [], waterAreas: [], highways: [], coastlines: [], residential: [], forests: [] })).toBe(false)
    // Shape stored by earlier versions, which only knew two layers.
    expect(hasMapDetails({ waterways: [], highways: [] })).toBe(false)
  })

  it('accepts a context that carries at least one layer', () => {
    expect(hasMapDetails({ waterways: [], waterAreas: [[[1, 2]]], highways: [[[1, 2]]], coastlines: [], residential: [], forests: [] })).toBe(
      true,
    )
    expect(hasMapDetails({ forests: [[[1, 2]]] })).toBe(true)
  })
})

describe('buildOverpassQuery', () => {
  it('embeds the bbox in every filter', () => {
    const query = buildOverpassQuery('1,2,3,4')
    expect(query).toContain('[out:json]')
    expect(query).toContain('out geom;')
    const statements = query.match(/\(1,2,3,4\)/g)?.length || 0
    expect(statements).toBeGreaterThanOrEqual(5)
    // Public instances time out on long statement lists, so keep the query lean.
    expect(statements).toBeLessThanOrEqual(7)
  })

  it('covers the rendered layers and skips river centerlines', () => {
    const query = buildOverpassQuery('1,2,3,4')
    for (const tag of ['highway', 'coastline', 'water', 'residential', 'forest', 'park', 'place']) {
      expect(query).toContain(tag)
    }
    expect(query).not.toContain('waterway')
  })

  it('keeps residential streets out of the base query', () => {
    // They belong to the rural second pass; in a city they would explode the payload.
    expect(buildOverpassQuery('1,2,3,4')).not.toContain('living_street')
  })
})

describe('buildResidentialStreetsQuery', () => {
  it('asks only for the small road classes, embedding the bbox', () => {
    const query = buildResidentialStreetsQuery('1,2,3,4')
    for (const klass of ['residential', 'living_street', 'unclassified']) {
      expect(query).toContain(klass)
    }
    expect(query).toContain('(1,2,3,4)')
    // No area/water/place lookups: the base pass already carries those.
    expect(query).not.toContain('natural')
    expect(query).not.toContain('place')
  })
})

describe('parseBboxString', () => {
  it('parses a well-formed bbox and rejects a malformed one', () => {
    expect(parseBboxString('54.1,10.2,54.3,10.4')).toEqual({ minLat: 54.1, minLng: 10.2, maxLat: 54.3, maxLng: 10.4 })
    expect(parseBboxString('54.1,10.2,54.3')).toBeNull()
    expect(parseBboxString('a,b,c,d')).toBeNull()
  })
})

describe('rural heuristic', () => {
  const area = { minLat: 0, minLng: 0, maxLat: 1, maxLng: 1 }
  const empty = (): MapContextLike => ({
    waterways: [],
    waterAreas: [],
    highways: [],
    coastlines: [],
    residential: [],
    forests: [],
  })
  type MapContextLike = ReturnType<typeof parseOverpassResponse>

  it('reads the largest place rank from the response', () => {
    const data = {
      elements: [
        { type: 'node', tags: { place: 'hamlet' } },
        { type: 'node', tags: { place: 'town' } },
        { type: 'way', tags: { highway: 'primary' } },
      ],
    }
    expect(maxPlaceRank(data)).toBe(60)
    expect(maxPlaceRank({ elements: [] })).toBe(0)
  })

  it('measures residential coverage as the filled fraction of the tile', () => {
    const context = empty()
    // A 0.5×0.5 square inside a 1×1 tile: a quarter of the area.
    context.residential = [[[0, 0], [0.5, 0], [0.5, 0.5], [0, 0.5], [0, 0]]]
    expect(residentialCoverage(context, area)).toBeCloseTo(0.25, 5)
    expect(residentialCoverage(empty(), area)).toBe(0)
  })

  it('treats a village (low coverage, small place) as rural', () => {
    const context = empty()
    context.residential = [[[0, 0], [0.2, 0], [0.2, 0.2], [0, 0.2], [0, 0]]] // 4% coverage
    expect(isRuralArea(context, area, 40)).toBe(true)
  })

  it('treats a town or city as urban regardless of coverage', () => {
    expect(isRuralArea(empty(), area, 60)).toBe(false)
  })

  it('treats a dense built-up tile as urban even without a place label', () => {
    const context = empty()
    const side = Math.sqrt(RESIDENTIAL_URBAN_COVERAGE) + 0.05
    context.residential = [[[0, 0], [side, 0], [side, side], [0, side], [0, 0]]]
    expect(isRuralArea(context, area, 0)).toBe(false)
  })

  it('does not augment empty countryside a route merely passes through', () => {
    // No place, no residential land: nothing to detail, so keep it a single request.
    expect(isRuralArea(empty(), area, 0)).toBe(false)
  })

  it('explains the rural/urban verdict in plain language', () => {
    const village = empty()
    village.residential = [[[0, 0], [0.2, 0], [0.2, 0.2], [0, 0.2], [0, 0]]]
    expect(explainRuralDecision(village, area, 40).reason).toMatch(/ländlich.*Wohnstraßen nachladen/)
    expect(explainRuralDecision(empty(), area, 60).reason).toMatch(/städtisch.*Ort-Rang/)
    expect(explainRuralDecision(empty(), area, 0).reason).toMatch(/keine Siedlung/)
  })
})

describe('fetchMapContext rural augmentation', () => {
  const villageBase = {
    elements: [
      { type: 'node', tags: { place: 'village', name: 'Satjendorf' } },
      { type: 'way', tags: { highway: 'tertiary' }, geometry: [{ lat: 54.38, lon: 10.5 }, { lat: 54.39, lon: 10.51 }] },
    ],
  }
  const streets = {
    elements: [
      { type: 'way', tags: { highway: 'residential' }, geometry: [{ lat: 54.381, lon: 10.501 }, { lat: 54.382, lon: 10.502 }] },
    ],
  }

  it('fetches residential streets for a rural tile and merges them', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(villageBase), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(streets), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const progress: string[] = []

    const context = await fetchMapContext('54.3700,10.4700,54.4000,10.5300', {
      onProgress: (event) => {
        if (event.decision) progress.push(event.decision)
      },
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[1]?.[1]?.body)).toContain('living_street')
    expect(context.highways).toHaveLength(2)
    expect(context.placeName).toBe('Satjendorf')
    expect(progress.some((line) => /ländlich.*Wohnstraßen nachladen/.test(line))).toBe(true)
  })

  it('keeps the base layers and flags the gap when the street pass fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(villageBase), { status: 200 }))
      .mockResolvedValue(new Response('busy', { status: 504 }))
    vi.stubGlobal('fetch', fetchMock)

    const context = await fetchMapContext('54.3700,10.4700,54.4000,10.5300')

    expect(context.highways).toHaveLength(1)
    // Cached without the flag it would stay street-less forever.
    expect(context.streetsPending).toBe(true)
  })

  it('leaves no pending flag when the streets arrive', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(villageBase), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(streets), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const context = await fetchMapContext('54.3700,10.4700,54.4000,10.5300')

    expect(context.streetsPending).toBeUndefined()
  })

  it('retries the street pass on the mirror that answered the base query', async () => {
    const fetchMock = vi
      .fn()
      // First mirror stalls, second one answers the base query.
      .mockRejectedValueOnce(new TypeError('Load failed'))
      .mockResolvedValueOnce(new Response(JSON.stringify(villageBase), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(streets), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await fetchMapContext('54.3700,10.4700,54.4000,10.5300')

    // Third call must skip the mirror that just failed, not burn another timeout.
    expect(fetchMock.mock.calls[2]?.[0]).toBe(OVERPASS_ENDPOINTS[1])
  })
})

describe('completeMapContext', () => {
  const pending = (): MapContext => ({
    waterways: [],
    waterAreas: [],
    highways: [[[10.5, 54.38]]],
    coastlines: [],
    residential: [],
    forests: [],
    streetsPending: true,
  })

  it('does nothing when no streets are pending', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const context = pending()
    delete context.streetsPending

    expect(await completeMapContext('54.3400,10.5000,54.4000,10.5600', context)).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('merges the streets into a cached area and clears the flag', async () => {
    const body = {
      elements: [
        { type: 'way', tags: { highway: 'residential' }, geometry: [{ lat: 54.381, lon: 10.501 }, { lat: 54.382, lon: 10.502 }] },
      ],
    }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })))
    const context = pending()

    expect(await completeMapContext('54.3400,10.5000,54.4000,10.5600', context)).toBe(true)
    expect(context.highways).toHaveLength(2)
    expect(context.streetsPending).toBeUndefined()
  })

  it('keeps the flag when Overpass is still unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('busy', { status: 504 })))
    const context = pending()

    expect(await completeMapContext('54.3400,10.5000,54.4000,10.5600', context)).toBe(false)
    expect(context.streetsPending).toBe(true)
    expect(context.highways).toHaveLength(1)
  })

  it('makes only one request for an urban tile', async () => {
    const city = {
      elements: [
        { type: 'node', tags: { place: 'city', name: 'Kiel' } },
        { type: 'way', tags: { highway: 'primary' }, geometry: [{ lat: 54.32, lon: 10.13 }, { lat: 54.33, lon: 10.14 }] },
      ],
    }
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(city), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await fetchMapContext('54.3000,10.1000,54.3400,10.1600')

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
