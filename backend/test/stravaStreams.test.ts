import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeStravaStreams, recordsFromStravaStreams, streamRecordsAreRicher } from '../src/stravaStreams.ts'

describe('recordsFromStravaStreams', () => {
  it('maps keyed streams into activity records', () => {
    const records = recordsFromStravaStreams({
      time: { data: [0, 10, 20] },
      latlng: {
        data: [
          [52.5, 13.4],
          [52.51, 13.41],
          [52.52, 13.42],
        ],
      },
      heartrate: { data: [140, 145, 150] },
      velocity_smooth: { data: [3, 3.5, 4] },
      distance: { data: [0, 30, 70] },
      altitude: { data: [40, 41, 42] },
      watts: { data: [200, 220, 240] },
    })
    assert.equal(records.length, 3)
    assert.deepEqual(records[1], {
      elapsedSeconds: 10,
      latitude: 52.51,
      longitude: 13.41,
      heartRateBpm: 145,
      speedKmh: 12.6,
      altitudeM: 41,
      powerW: 220,
      distanceM: 30,
    })
  })

  it('accepts array-shaped stream payloads', () => {
    const streams = normalizeStravaStreams([
      { type: 'time', data: [0, 5] },
      { type: 'heartrate', data: [120, 130] },
    ])
    assert.deepEqual(streams.time, [0, 5])
    const records = recordsFromStravaStreams([
      { type: 'time', data: [0, 5] },
      { type: 'heartrate', data: [120, 130] },
    ])
    assert.equal(records[1].heartRateBpm, 130)
    assert.equal(records[1].latitude, undefined)
  })

  it('prefers stream metrics over polyline fallback', () => {
    assert.equal(
      streamRecordsAreRicher([{ elapsedSeconds: 0, heartRateBpm: 140 }], [{ elapsedSeconds: 0, latitude: 1, longitude: 2 }]),
      true,
    )
    assert.equal(streamRecordsAreRicher([], [{ elapsedSeconds: 0, latitude: 1, longitude: 2 }]), false)
  })
})
