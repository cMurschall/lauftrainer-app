import { describe, expect, it } from 'vitest'
import {
  GERMANY_BBOX,
  hasMapTilesUrl,
  lauftrainerOverpassFlavor,
  routeCoordinatesFromRecords,
  routeHasBasemapCoverage,
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
