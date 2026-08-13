import { describe, expect, it } from 'vitest'
import { parseGpx } from './gpx'
import { parseTcx } from './tcx'

describe('GPS parsers', () => {
  it('calculates GPX distance, ascent and elapsed time', () => {
    const text = `<gpx xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg><trkpt lat="50" lon="10"><ele>100</ele><time>2026-08-10T10:00:00Z</time></trkpt><trkpt lat="50.001" lon="10"><ele>110</ele><time>2026-08-10T10:01:00Z</time></trkpt></trkseg></trk></gpx>`
    const result = parseGpx(text, 'route.gpx')
    expect(result.durationSeconds).toBe(60)
    expect(result.distanceKm).toBeGreaterThan(0.1)
    expect(result.ascentM).toBe(10)
  })

  it('reads TCX summary and trackpoint heart rates', () => {
    const text = `<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"><Activities><Activity Sport="Running"><Id>2026-08-10T10:00:00Z</Id><Lap><TotalTimeSeconds>120</TotalTimeSeconds><DistanceMeters>1000</DistanceMeters><Track><Trackpoint><HeartRateBpm><Value>140</Value></HeartRateBpm></Trackpoint></Track></Lap></Activity></Activities></TrainingCenterDatabase>`
    const result = parseTcx(text, 'run.tcx')
    expect(result.durationSeconds).toBe(120)
    expect(result.distanceKm).toBe(1)
    expect(result.averageHeartRate).toBe(140)
  })

  it('rejects malformed or empty GPS documents', () => {
    expect(() => parseGpx('<gpx></gpx>', 'empty.gpx')).toThrow(/Trackpoints/)
    expect(() => parseTcx('<broken>', 'bad.tcx')).toThrow()
  })
})
