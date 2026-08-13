import { Decoder, Stream } from '@garmin/fitsdk'
import type { ActivityRecord, Workout } from '../types/workout'

type FitMessage = Record<string, unknown>
const numeric = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.replace(',', '.').trim())
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}
const dateValue = (value: unknown) =>
  value instanceof Date ? value : typeof value === 'string' || typeof value === 'number' ? new Date(value) : undefined

export function parseFit(buffer: ArrayBuffer, fileName: string): Workout {
  const stream = Stream.fromArrayBuffer(buffer)
  if (!Decoder.isFIT(stream)) throw new Error(`${fileName}: keine gültige FIT-Datei.`)
  stream.reset()
  const decoded = new Decoder(stream).read({
    convertDateTimesToDates: true,
    applyScaleAndOffset: true,
    convertTypesToStrings: true,
  })
  if (decoded.errors.length) throw new Error(`${fileName}: FIT-Datei konnte nicht vollständig gelesen werden.`)
  const messages = decoded.messages as unknown as Record<string, FitMessage[] | undefined>
  const sessions = messages.sessionMesgs || []
  const session = sessions[0] || {}
  const records: ActivityRecord[] = (messages.recordMesgs || []).map((record, index) => {
    const timestamp = dateValue(record.timestamp)
    const first = dateValue((messages.recordMesgs || [])[0]?.timestamp)
    return {
      elapsedSeconds:
        timestamp && first
          ? Math.max(0, (timestamp.getTime() - first.getTime()) / 1000)
          : numeric(record.elapsedTime) || index,
      heartRateBpm: numeric(record.heartRate),
      speedKmh: numeric(record.speed) !== undefined ? numeric(record.speed)! * 3.6 : undefined,
      altitudeM: numeric(record.altitude),
      distanceM: numeric(record.distance),
      powerW: numeric(record.power),
      latitude:
        numeric(record.positionLat) !== undefined ? (numeric(record.positionLat)! * 180) / 2147483648 : undefined,
      longitude:
        numeric(record.positionLong) !== undefined ? (numeric(record.positionLong)! * 180) / 2147483648 : undefined,
    }
  })
  const start =
    dateValue(session.startTime) ||
    dateValue(records.length ? (messages.recordMesgs || [])[0]?.timestamp : undefined) ||
    new Date()
  const durationSeconds =
    numeric(session.totalTimerTime) || numeric(session.totalElapsedTime) || records.at(-1)?.elapsedSeconds || 0
  const distanceM = numeric(session.totalDistance) || records.at(-1)?.distanceM
  const heartRates = records
    .map((record) => record.heartRateBpm)
    .filter((value): value is number => value !== undefined)
  return {
    id: `fit-${fileName}-${start.toISOString()}`,
    source: 'fit',
    name: fileName,
    sport: String(session.sport || 'RUNNING'),
    rawSport: String(session.sport || 'RUNNING'),
    date: start.toISOString(),
    durationSeconds,
    distanceKm: distanceM !== undefined ? distanceM / 1000 : undefined,
    averageHeartRate:
      numeric(session.avgHeartRate) ||
      (heartRates.length ? heartRates.reduce((a, b) => a + b, 0) / heartRates.length : undefined),
    calories: numeric(session.totalCalories),
    ascentM: numeric(session.totalAscent),
    records,
    importedAt: new Date().toISOString(),
    elevationGainM: numeric(session.totalAscent),
    averageSpeedKmh: numeric(session.avgSpeed) !== undefined ? numeric(session.avgSpeed)! * 3.6 : undefined,
    maxSpeedKmh: numeric(session.maxSpeed) !== undefined ? numeric(session.maxSpeed)! * 3.6 : undefined,
    averagePowerW: numeric(session.avgPower),
    maxPowerW: numeric(session.maxPower),
    normalizedPowerW: numeric(session.normalizedPower),
  }
}
