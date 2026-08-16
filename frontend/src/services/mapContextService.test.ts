import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BBOX_GRID_DEG,
  boundingBoxFromRecords,
  buildOverpassQuery,
  fetchMapContext,
  hasMapDetails,
  parseOverpassResponse,
  quantizeBbox,
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
      '54.3700,10.4700,54.4000,10.5300',
    )
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
        { type: 'way', tags: { waterway: 'river' }, geometry: [{ lat: 5, lon: 6 }] },
        { type: 'way', tags: { natural: 'coastline' }, geometry: [{ lat: 7, lon: 8 }] },
        { type: 'way', tags: { landuse: 'residential' }, geometry: [{ lat: 9, lon: 10 }] },
        {
          type: 'relation',
          tags: { leisure: 'park' },
          members: [{ type: 'way', geometry: [{ lat: 11, lon: 12 }] }],
        },
      ],
    })

    expect(context.highways).toEqual([[[2, 1], [4, 3]]])
    expect(context.waterways).toEqual([[[6, 5]]])
    expect(context.coastlines).toEqual([[[8, 7]]])
    expect(context.residential).toEqual([[[10, 9]]])
    expect(context.forests).toEqual([[[12, 11]]])
  })

  it('tolerates empty and malformed payloads', () => {
    expect(parseOverpassResponse(undefined)).toEqual({
      waterways: [],
      highways: [],
      coastlines: [],
      residential: [],
      forests: [],
    })
    expect(parseOverpassResponse({ elements: [{ type: 'node' }] }).highways).toEqual([])
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
    expect(url).toBe('https://overpass-api.de/api/interpreter')
    expect(init.method).toBe('POST')
    expect(String(init.body)).toContain('54.3700%2C10.4700%2C54.4000%2C10.5300')
    expect(context.highways).toEqual([[[2, 1]]])
  })

  it('throws with the status when Overpass rejects the request', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('rate limited', { status: 429 })))
    await expect(fetchMapContext('54.3700,10.4700,54.4000,10.5300')).rejects.toThrow(/429/)
  })
})

describe('hasMapDetails', () => {
  it('treats missing and empty cached contexts as unusable', () => {
    expect(hasMapDetails(undefined)).toBe(false)
    expect(hasMapDetails(null)).toBe(false)
    expect(hasMapDetails({ waterways: [], highways: [], coastlines: [], residential: [], forests: [] })).toBe(false)
    // Shape stored by earlier versions, which only knew two layers.
    expect(hasMapDetails({ waterways: [], highways: [] })).toBe(false)
  })

  it('accepts a context that carries at least one layer', () => {
    expect(hasMapDetails({ waterways: [], highways: [[[1, 2]]], coastlines: [], residential: [], forests: [] })).toBe(
      true,
    )
    expect(hasMapDetails({ forests: [[[1, 2]]] })).toBe(true)
  })
})

describe('buildOverpassQuery', () => {
  it('embeds the bbox in every filter', () => {
    const query = buildOverpassQuery('1,2,3,4')
    expect(query).toContain('[out:json]')
    expect(query.match(/\(1,2,3,4\)/g)?.length).toBeGreaterThan(10)
  })
})
