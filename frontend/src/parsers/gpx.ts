import type { ActivityRecord, Workout } from '../types/workout'

const number = (value: string | null | undefined) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

const childText = (root: Element, tag: string) =>
  root.getElementsByTagNameNS('*', tag)[0]?.textContent || root.getElementsByTagName(tag)[0]?.textContent

function distanceMeters(a: ActivityRecord, b: ActivityRecord): number {
  if (a.latitude === undefined || a.longitude === undefined || b.latitude === undefined || b.longitude === undefined)
    return 0
  const radians = (value: number) => (value * Math.PI) / 180
  const lat = radians(b.latitude - a.latitude),
    lon = radians(b.longitude - a.longitude)
  const start = radians(a.latitude),
    end = radians(b.latitude)
  const haversine = Math.sin(lat / 2) ** 2 + Math.cos(start) * Math.cos(end) * Math.sin(lon / 2) ** 2
  return 6371000 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
}

export function parseGpx(text: string, fileName: string): Workout {
  const xml = new DOMParser().parseFromString(text, 'application/xml')
  if (xml.querySelector('parsererror')) throw new Error(`${fileName}: ungültiges GPX-XML.`)
  const points = [...xml.getElementsByTagNameNS('*', 'trkpt')]
  if (!points.length) points.push(...xml.getElementsByTagName('trkpt'))
  if (!points.length) throw new Error(`${fileName}: keine Trackpoints gefunden.`)
  const raw = points.map((point) => ({
    latitude: number(point.getAttribute('lat')),
    longitude: number(point.getAttribute('lon')),
    altitudeM: number(childText(point, 'ele')),
    time: childText(point, 'time'),
  }))
  const firstTime = raw.find((point) => point.time)?.time
  const start = firstTime ? Date.parse(firstTime) : undefined
  const records: ActivityRecord[] = raw.map((point, index) => ({
    elapsedSeconds: start !== undefined && point.time ? Math.max(0, (Date.parse(point.time) - start) / 1000) : index,
    altitudeM: point.altitudeM,
    latitude: point.latitude,
    longitude: point.longitude,
    distanceM: index ? undefined : 0,
  }))
  let distanceM = 0
  let ascentM = 0
  for (let index = 1; index < records.length; index += 1) {
    distanceM += distanceMeters(records[index - 1], records[index])
    records[index].distanceM = distanceM
    const previous = records[index - 1].altitudeM,
      current = records[index].altitudeM
    if (previous !== undefined && current !== undefined && current > previous) ascentM += current - previous
  }
  const durationSeconds = records[records.length - 1].elapsedSeconds
  const date = firstTime || childText(xml.documentElement, 'time') || new Date().toISOString()
  return {
    id: `gpx-${fileName}-${date}`,
    source: 'gpx',
    name: fileName,
    sport: 'RUNNING',
    date,
    durationSeconds: Math.max(0, durationSeconds),
    distanceKm: distanceM / 1000,
    ascentM,
    records,
    importedAt: new Date().toISOString(),
  }
}
