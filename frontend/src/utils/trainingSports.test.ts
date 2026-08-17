import { describe, expect, it } from 'vitest'
import {
  canonicalizeTrainingSport,
  sportsFromWorkouts,
  toPlanAvailableSports,
  trainingFrequencyFromPreferredDays,
  trainingSportFromWorkoutSport,
} from './trainingSports'

describe('trainingSports', () => {
  it('canonicalizes known and custom sports', () => {
    expect(canonicalizeTrainingSport('running')).toBe('Running')
    expect(canonicalizeTrainingSport('rowing')).toBe('Cardio')
    expect(canonicalizeTrainingSport('  yoga flow  ')).toBe('Yoga flow')
  })

  it('maps workout sports into selectable options', () => {
    expect(trainingSportFromWorkoutSport('run')).toBe('Running')
    expect(trainingSportFromWorkoutSport('Climbing')).toBe('Climbing')
    expect(sportsFromWorkouts([{ sport: 'Running' }, { sport: 'Ski' }, { sport: 'run' }])).toEqual(['Running', 'Ski'])
  })

  it('builds plan whitelist with custom labels intact', () => {
    expect(toPlanAvailableSports(['Cycling', 'Ski'], true)).toEqual(['cycling', 'Ski', 'strength'])
    expect(trainingFrequencyFromPreferredDays(['monday', 'friday'])).toBe(2)
    expect(trainingFrequencyFromPreferredDays([])).toBe(3)
  })
})
