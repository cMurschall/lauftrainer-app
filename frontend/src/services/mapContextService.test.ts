import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BBOX_GRID_DEG,
  boundingBoxFromRecords,
  buildOverpassQuery,
  fetchMapContext,
  hasMapDetails,
  OVERPASS_ENDPOINTS,
  parseOverpassResponse,
  pickLargestPlaceName,
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
      highways: [],
      coastlines: [],
      residential: [],
      forests: [],
    })
    expect(parseOverpassResponse({ elements: [{ type: 'node' }] }).highways).toEqual([])
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

  it('sends no referrer so blocked-referrer rejections do not apply', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ elements: [] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await fetchMapContext('54.3700,10.4700,54.4000,10.5300')

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.referrerPolicy).toBe('no-referrer')
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

  it('falls back to the next mirror and reports progress', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Load failed'))
      .mockResolvedValueOnce(new Response('busy', { status: 504 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ elements: [{ type: 'way', tags: { highway: 'primary' }, geometry: [{ lat: 1, lon: 2 }] }] }), {
          status: 200,
        }),
      )
    vi.stubGlobal('fetch', fetchMock)
    const progress: string[] = []

    const context = await fetchMapContext('54.3700,10.4700,54.4000,10.5300', {
      onProgress: (event) => progress.push(`${event.endpoint} ${event.status ?? event.error ?? 'start'}`),
    })

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual(OVERPASS_ENDPOINTS)
    expect(context.highways).toEqual([[[2, 1]]])
    expect(progress.some((line) => line.includes('504'))).toBe(true)
    expect(progress.at(-1)).toContain('200')
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
    expect(query).toContain('out geom;')
    const statements = query.match(/\(1,2,3,4\)/g)?.length || 0
    expect(statements).toBeGreaterThanOrEqual(5)
    // Public instances time out on long statement lists, so keep the query lean.
    expect(statements).toBeLessThanOrEqual(7)
  })

  it('still covers every layer the parser knows', () => {
    const query = buildOverpassQuery('1,2,3,4')
    for (const tag of ['highway', 'waterway', 'coastline', 'water', 'residential', 'forest', 'park', 'place']) {
      expect(query).toContain(tag)
    }
  })
})
