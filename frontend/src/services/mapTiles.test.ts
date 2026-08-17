import { describe, expect, it } from 'vitest'
import {
  GERMANY_BBOX,
  hasMapTilesUrl,
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
      ]),
    ).toEqual([
      [10.1, 54.3],
      [10.3, 54.4],
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
