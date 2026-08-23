import { describe, expect, it } from 'vitest'
import {
  GERMANY_BBOX,
  colorForNormalized,
  coloredRouteGeoJson,
  hasMapTilesUrl,
  lauftrainerOverpassFlavor,
  preferredRouteColorMode,
  routeCoordinatesFromRecords,
  routeHasBasemapCoverage,
  routePointsFromRecords,
} from './mapTiles'

describe('routeCoordinatesFromRecords', () => {
  it('keeps only finite lon/lat pairs in MapLibre order', () => {
    expect(
      routeCoordinatesFromRecords([
        { latitude: 54.3, longitude: 10.1 },
        { latitude: undefined, longitude: 10.2 },
        { latitude: 54.4, longitude: 10.3 },
        { latitude: '54.5' as unknown as number, longitude: '10.4' as unknown as number },
      ]),
    ).toEqual([
      [10.1, 54.3],
      [10.3, 54.4],
      [10.4, 54.5],
    ])
  })

  it('returns an empty list without GPS', () => {
    expect(routeCoordinatesFromRecords([{ latitude: undefined }])).toEqual([])
    expect(routeCoordinatesFromRecords(undefined)).toEqual([])
  })
})

describe('routePointsFromRecords', () => {
  it('keeps HR and speed alongside GPS', () => {
    expect(
      routePointsFromRecords([
        { latitude: 54.3, longitude: 10.1, heartRateBpm: 140, speedKmh: 12 },
        { latitude: 54.4, longitude: 10.2 },
      ]),
    ).toEqual([
      { longitude: 10.1, latitude: 54.3, heartRateBpm: 140, speedKmh: 12 },
      { longitude: 10.2, latitude: 54.4 },
    ])
  })

  it('prefers HR coloring when streams exist', () => {
    const points = routePointsFromRecords([
      { latitude: 54.3, longitude: 10.1, heartRateBpm: 140, speedKmh: 11 },
      { latitude: 54.31, longitude: 10.11, heartRateBpm: 160, speedKmh: 13 },
    ])
    expect(preferredRouteColorMode(points)).toBe('hr')
    const geo = coloredRouteGeoJson(points, 'hr')
    expect(geo.features).toHaveLength(1)
    expect(geo.features[0].geometry.type).toBe('LineString')
  })

  it('drops implausible metrics from route points', () => {
    expect(
      routePointsFromRecords([{ latitude: 54.3, longitude: 10.1, heartRateBpm: 300, speedKmh: 60 }], 'Running'),
    ).toEqual([{ longitude: 10.1, latitude: 54.3 }])
  })
})

describe('routeLineGradientStops', () => {
  it('builds a continuous gradient even when metrics are sparse', async () => {
    const { routeLineGradientStops } = await import('./mapTiles')
    const stops = routeLineGradientStops(
      [
        { longitude: 10, latitude: 54, heartRateBpm: 120 },
        { longitude: 10.01, latitude: 54.01 },
        { longitude: 10.02, latitude: 54.02 },
        { longitude: 10.03, latitude: 54.03, heartRateBpm: 160 },
      ],
      'hr',
    )
    expect(stops[0]).toBe(0)
    expect(stops[stops.length - 2]).toBe(1)
    expect(stops.length).toBeGreaterThanOrEqual(4)
  })
})

describe('colorForNormalized', () => {
  it('returns endpoint colors at 0 and 1', () => {
    expect(colorForNormalized(0)).toBe('#38bdf8')
    expect(colorForNormalized(1)).toBe('#f43f5e')
  })
})

describe('routeHasBasemapCoverage', () => {
  it('accepts routes whose centroid is inside the Germany extract', () => {
    expect(
      routeHasBasemapCoverage([
        [10.1, 54.3],
        [10.2, 54.35],
      ]),
    ).toBe(true)
  })

  it('rejects short routes and routes outside the extract', () => {
    expect(routeHasBasemapCoverage([[10.1, 54.3]])).toBe(false)
    expect(
      routeHasBasemapCoverage([
        [-0.1, 51.5],
        [-0.05, 51.52],
      ]),
    ).toBe(false)
  })

  it('matches the documented extract bbox', () => {
    expect(GERMANY_BBOX).toEqual({ west: 5.8, south: 47.2, east: 15.1, north: 55.1 })
  })
})

describe('hasMapTilesUrl', () => {
  it('is a boolean based on build-time env', () => {
    expect(typeof hasMapTilesUrl()).toBe('boolean')
  })
})

describe('lauftrainerOverpassFlavor', () => {
  it('keeps deep slate / soft forest / water tones in dark mode', () => {
    const flavor = lauftrainerOverpassFlavor('dark')
    expect(flavor.background).toBe('#0D1117')
    expect(flavor.earth).toBe('#161B22')
    expect(flavor.water).toBe('#1E4A66')
    expect(flavor.wood_a).toBe('#134E3A')
    expect(flavor.landcover?.urban_area).toBe('#2A3341')
  })
})

describe('routeCentroid', () => {
  it('averages lon/lat pairs', async () => {
    const { routeCentroid } = await import('./mapTiles')
    expect(
      routeCentroid([
        [10, 54],
        [12, 56],
      ]),
    ).toEqual([11, 55])
  })
})
