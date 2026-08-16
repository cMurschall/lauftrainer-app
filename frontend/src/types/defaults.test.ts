import { describe, expect, it } from 'vitest'
import { defaultUserConfig, normalizeUserConfig } from '../types/defaults'

describe('user config defaults', () => {
  it('strips removed legacy fields and keeps preferred days', () => {
    const normalized = normalizeUserConfig({
      ...defaultUserConfig(),
      name: 'Ada',
      personalNotes: 'old',
      trainingFrequencyPerWeek: 5,
      maxWeeklyTrainingMinutes: 240,
      maxTrainingMinutesPerDay: { monday: 60 },
      preferredTrainingDays: ['tuesday', 'thursday'],
      availableSports: ['Running', 'yoga', 'Yoga', ''],
    } as never)

    expect(normalized).not.toHaveProperty('name')
    expect(normalized).not.toHaveProperty('personalNotes')
    expect(normalized).not.toHaveProperty('trainingFrequencyPerWeek')
    expect(normalized).not.toHaveProperty('maxWeeklyTrainingMinutes')
    expect(normalized).not.toHaveProperty('maxTrainingMinutesPerDay')
    expect(normalized.preferredTrainingDays).toEqual(['tuesday', 'thursday'])
    expect(normalized.availableSports).toEqual(['Running', 'Mobility'])
  })

  it('falls back to defaults when preferred days or sports are empty', () => {
    const normalized = normalizeUserConfig({
      preferredTrainingDays: [],
      availableSports: [],
    })
    expect(normalized.preferredTrainingDays).toEqual(['monday', 'wednesday', 'friday'])
    expect(normalized.availableSports).toEqual(['Running'])
  })
})
