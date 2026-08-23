import { describe, expect, it } from 'vitest'
import {
  HR_BPM_MAX,
  HR_BPM_MIN,
  isPlausibleHeartRate,
  isPlausibleSpeedKmh,
  plausibleHeartRate,
  plausibleSpeedKmh,
} from './streamPlausibility'

describe('isPlausibleHeartRate', () => {
  it('accepts typical exercise values', () => {
    expect(isPlausibleHeartRate(120)).toBe(true)
    expect(isPlausibleHeartRate(HR_BPM_MIN)).toBe(true)
    expect(isPlausibleHeartRate(HR_BPM_MAX)).toBe(true)
  })

  it('rejects spikes and dropouts', () => {
    expect(isPlausibleHeartRate(30)).toBe(false)
    expect(isPlausibleHeartRate(250)).toBe(false)
  })
})

describe('isPlausibleSpeedKmh', () => {
  it('rejects standstill and GPS sprint glitches for runners', () => {
    expect(isPlausibleSpeedKmh(0.1, 'Running')).toBe(false)
    expect(isPlausibleSpeedKmh(12, 'Running')).toBe(true)
    expect(isPlausibleSpeedKmh(40, 'Running')).toBe(false)
  })

  it('allows higher speeds for cycling', () => {
    expect(isPlausibleSpeedKmh(45, 'Cycling')).toBe(true)
    expect(isPlausibleSpeedKmh(120, 'Cycling')).toBe(false)
  })
})

describe('plausibleHeartRate', () => {
  it('returns undefined for out-of-range values', () => {
    expect(plausibleHeartRate(300)).toBeUndefined()
    expect(plausibleHeartRate(150)).toBe(150)
  })
})

describe('plausibleSpeedKmh', () => {
  it('returns undefined for out-of-range values', () => {
    expect(plausibleSpeedKmh(100, 'Laufen')).toBeUndefined()
    expect(plausibleSpeedKmh(11, 'Laufen')).toBe(11)
  })
})
