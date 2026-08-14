import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseFit } from './fit'

const fixturePath = resolve(__dirname, '../../test/fixtures/sample-run.fit')

describe('parseFit', () => {
  it('reads duration, distance, HR and records from a FIT fixture', () => {
    const bytes = readFileSync(fixturePath)
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    const workout = parseFit(buffer, 'sample-run.fit')
    expect(workout.source).toBe('fit')
    expect(workout.durationSeconds).toBe(60)
    expect(workout.distanceKm).toBeCloseTo(0.2)
    expect(workout.averageHeartRate).toBe(142)
    expect(workout.records).toHaveLength(2)
    expect(workout.records[0].heartRateBpm).toBe(140)
    expect(workout.ascentM).toBe(5)
  })

  it('rejects an invalid buffer with a clear error', () => {
    expect(() => parseFit(new Uint8Array([1, 2, 3, 4]).buffer, 'bad.fit')).toThrow(/keine gültige FIT-Datei/)
  })
})
