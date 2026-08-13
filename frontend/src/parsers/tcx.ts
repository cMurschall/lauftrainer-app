import type { ActivityRecord, Workout } from '../types/workout'

const value = (root: Element, tag: string): string | undefined =>
  root.getElementsByTagNameNS('*', tag)[0]?.textContent || root.getElementsByTagName(tag)[0]?.textContent || undefined
const numeric = (root: Element, tag: string) => {
  const result = Number(value(root, tag))
  return Number.isFinite(result) ? result : undefined
}

export function parseTcx(text: string, fileName: string): Workout {
  const xml = new DOMParser().parseFromString(text, 'application/xml')
  if (xml.querySelector('parsererror')) throw new Error(`${fileName}: ungültiges TCX-XML.`)
  const activity = xml.getElementsByTagNameNS('*', 'Activity')[0] || xml.getElementsByTagName('Activity')[0]
  if (!activity) throw new Error(`${fileName}: keine Aktivität gefunden.`)
  const trackpoints = [...activity.getElementsByTagNameNS('*', 'Trackpoint')]
  if (!trackpoints.length) trackpoints.push(...activity.getElementsByTagName('Trackpoint'))
  const records: ActivityRecord[] = trackpoints.map((point, index) => ({
    elapsedSeconds: index,
    heartRateBpm: numeric(point, 'Value'),
    distanceM: numeric(point, 'DistanceMeters'),
    altitudeM: numeric(point, 'AltitudeMeters'),
    latitude: numeric(point, 'LatitudeDegrees'),
    longitude: numeric(point, 'LongitudeDegrees'),
  }))
  const durationSeconds = numeric(activity, 'TotalTimeSeconds') || Math.max(1, records.length)
  const distanceM = numeric(activity, 'DistanceMeters')
  const date = value(activity, 'Id') || new Date().toISOString()
  const heartRates = records.map((record) => record.heartRateBpm).filter((rate): rate is number => rate !== undefined)
  return {
    id: `tcx-${fileName}-${date}`,
    source: 'tcx',
    name: fileName,
    sport: value(activity, 'Sport') || 'RUNNING',
    date,
    durationSeconds,
    distanceKm: distanceM ? distanceM / 1000 : undefined,
    averageHeartRate: heartRates.length ? heartRates.reduce((a, b) => a + b, 0) / heartRates.length : undefined,
    records,
    importedAt: new Date().toISOString(),
  }
}
