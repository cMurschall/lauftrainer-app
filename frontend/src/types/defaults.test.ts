import { describe, expect, it } from 'vitest'
import { defaultUserConfig, normalizeUserConfig } from '../types/defaults'

describe('user config defaults', () => {
  it('treats missing or zero weekly minutes as unlimited', () => {
    expect(defaultUserConfig().maxWeeklyTrainingMinutes).toBeUndefined()
    expect(normalizeUserConfig({ ...defaultUserConfig(), maxWeeklyTrainingMinutes: 0 }).maxWeeklyTrainingMinutes).toBeUndefined()
    expect(normalizeUserConfig({ ...defaultUserConfig(), maxWeeklyTrainingMinutes: 240 }).maxWeeklyTrainingMinutes).toBe(240)
  })
})
