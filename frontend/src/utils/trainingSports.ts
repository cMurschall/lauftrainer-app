import { normalizeSport } from '../analysis/analysisEngine'
import { TRAINING_SPORT_CATEGORIES, type TrainingSportCategory, type Workout } from '../types/workout'

const KNOWN_LOOKUP = new Map(TRAINING_SPORT_CATEGORIES.map((sport) => [sport.toLowerCase(), sport]))

/** Legacy / alias labels folded into the current training categories. */
const TRAINING_ALIASES: Record<string, TrainingSportCategory> = {
  running: 'Running',
  run: 'Running',
  jogging: 'Running',
  cycling: 'Cycling',
  ride: 'Cycling',
  bike: 'Cycling',
  biking: 'Cycling',
  swimming: 'Swimming',
  swim: 'Swimming',
  hiking: 'Hiking',
  hike: 'Hiking',
  walking: 'Hiking',
  walk: 'Hiking',
  trekking: 'Hiking',
  cardio: 'Cardio',
  ergometer: 'Cardio',
  indoor: 'Cardio',
  treadmill: 'Cardio',
  elliptical: 'Cardio',
  crosstrainer: 'Cardio',
  spinning: 'Cardio',
  rowing: 'Cardio',
  row: 'Cardio',
  strength: 'Strength',
  mobility: 'Mobility',
  yoga: 'Mobility',
}

const WORKOUT_TO_TRAINING: Record<string, TrainingSportCategory | undefined> = {
  Running: 'Running',
  Cycling: 'Cycling',
  Swimming: 'Swimming',
  Hiking: 'Hiking',
  Walking: 'Hiking',
  Triathlon: 'Running',
}

export function isKnownTrainingSport(value: string): value is TrainingSportCategory {
  const key = value.trim().toLowerCase()
  return KNOWN_LOOKUP.has(key) || Boolean(TRAINING_ALIASES[key])
}

export function canonicalizeTrainingSport(value: string): string {
  const trimmed = value.trim().replace(/\s+/g, ' ')
  if (!trimmed) return ''
  const key = trimmed.toLowerCase()
  const known = KNOWN_LOOKUP.get(key) || TRAINING_ALIASES[key]
  if (known) return known
  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`.slice(0, 40)
}

export function normalizeAvailableSportsList(values: Array<string | undefined | null>): string[] {
  const result: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    const next = canonicalizeTrainingSport(String(value || ''))
    if (!next) continue
    const key = next.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(next)
  }
  return result
}

/** Map a workout sport into a selectable training-sport option. */
export function trainingSportFromWorkoutSport(sport: string): string {
  const normalized = normalizeSport(sport)
  const mapped = WORKOUT_TO_TRAINING[normalized]
  if (mapped) return mapped
  const alias = TRAINING_ALIASES[normalized.toLowerCase()] || TRAINING_ALIASES[sport.trim().toLowerCase()]
  if (alias) return alias
  if (normalized === 'Other' || !normalized) {
    const raw = sport.trim()
    return raw && raw.toLowerCase() !== 'other' ? canonicalizeTrainingSport(raw) : ''
  }
  return canonicalizeTrainingSport(normalized)
}

export function sportsFromWorkouts(workouts: Array<Pick<Workout, 'sport'>>): string[] {
  return normalizeAvailableSportsList(workouts.map((workout) => trainingSportFromWorkoutSport(workout.sport)))
}

/** Plan API keys for known sports; custom sports stay as display labels. */
export function toPlanAvailableSports(availableSports: string[] | undefined, strengthTraining = false): string[] {
  const keys = normalizeAvailableSportsList(availableSports || []).map((sport) => {
    if (isKnownTrainingSport(sport)) return canonicalizeTrainingSport(sport).toLowerCase()
    return sport
  })
  if (strengthTraining && !keys.map((item) => item.toLowerCase()).includes('strength')) keys.push('strength')
  return [...new Set(keys)]
}

export function trainingFrequencyFromPreferredDays(days: string[] | undefined): number {
  const count = (days || []).filter(Boolean).length
  return Math.max(1, Math.min(7, count || 3))
}
