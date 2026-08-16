import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { decodePolyline, recordsFromPolyline } from '../src/polyline.ts'

describe('decodePolyline', () => {
  it('decodes the Google sample polyline', () => {
    const points = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')
    assert.equal(points.length, 3)
    assert.deepEqual(
      points.map(([lat, lng]) => [Number(lat.toFixed(3)), Number(lng.toFixed(3))]),
      [
        [38.5, -120.2],
        [40.7, -120.95],
        [43.252, -126.453],
      ],
    )
  })

  it('returns empty for blank input', () => {
    assert.deepEqual(decodePolyline(''), [])
  })
})

describe('recordsFromPolyline', () => {
  it('builds timed GPS records from a summary polyline', () => {
    const records = recordsFromPolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@', 120)
    assert.equal(records.length, 3)
    assert.equal(records[0].elapsedSeconds, 0)
    assert.equal(records[1].elapsedSeconds, 60)
    assert.equal(records[2].elapsedSeconds, 120)
    assert.ok(Number.isFinite(records[0].latitude))
    assert.ok(Number.isFinite(records[0].longitude))
  })

  it('skips activities without a usable polyline', () => {
    assert.deepEqual(recordsFromPolyline(undefined, 100), [])
    assert.deepEqual(recordsFromPolyline('', 100), [])
  })
})
