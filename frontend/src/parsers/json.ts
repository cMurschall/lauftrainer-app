import type {Workout} from '../types/workout'

export function parsePolarJson(text: string, fileName: string): Workout {
    const raw = JSON.parse(text) as Record<string, unknown>
    const duration = Number(raw.duration || raw.durationSeconds || raw.duration_in_seconds || 0)
    const distance = Number(raw.distance || raw.distanceKm || raw.distance_km || 0)
    const date = String(raw.start_time || raw.startTime || raw.date || raw.start || new Date().toISOString())
    if (!duration && !distance) throw new Error(`${fileName}: JSON enthält keine Workout-Dauer oder Distanz.`)
    return {
        id: `json-${String(raw.id || fileName)}-${date}`,
        source: 'polar-json',
        name: String(raw.name || fileName),
        sport: String(raw.sport || 'RUNNING'),
        date,
        durationSeconds: duration > 10000 ? duration : duration * 60,
        distanceKm: distance > 1000 ? distance / 1000 : distance,
        averageHeartRate: Number(raw.average_heart_rate || raw.averageHeartRate || raw.avg_hr) || undefined,
        calories: Number(raw.calories) || undefined,
        records: [],
        importedAt: new Date().toISOString()
    }
}
