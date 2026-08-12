import { describe, expect, it } from 'vitest'
import { parsePolarCsv } from './csv'

describe('parsePolarCsv', () => {
  it('normalisiert eine Polar-Zusammenfassung', () => {
    const csv = 'Name,Sport,Date,Duration,Total distance (km),Average heart rate (bpm),Calories\nMorning Run,RUNNING,11-08-2026,00:45:30,"7,20",142,500'
    const workout = parsePolarCsv(csv, 'run.csv')
    expect(workout.sport).toBe('RUNNING')
    expect(workout.durationSeconds).toBe(2730)
    expect(workout.distanceKm).toBe(7.2)
    expect(workout.averageHeartRate).toBe(142)
  })

  it('liest quoted CSV-Werte und Detailmesswerte', () => {
    const csv = 'Name,Sport,Date,Duration,Total distance (km),Average heart rate (bpm),Calories\nRun,RUNNING,14-09-2025,00:30:06,"3,87",144,426\nSample rate,Time,HR (bpm),Speed (km/h),Altitude (m),Distances (m)\n1,00:00:01,92,4.2,16,1.2'
    const workout = parsePolarCsv(csv, 'detail.csv')
    expect(workout.distanceKm).toBe(3.87)
    expect(workout.records[0].heartRateBpm).toBe(92)
    expect(workout.records[0].distanceM).toBe(1.2)
  })
})
