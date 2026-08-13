import {describe, expect, it} from 'vitest'
import {parsePolarJson} from './json'

describe('parsePolarJson', () => {
    it('liest Polar ISO-8601-Dauern als Sekunden', () => {
        const workout = parsePolarJson(JSON.stringify({
            id: 'run-1', start_time: '2025-12-06T11:26:58Z', duration: 'PT3428.529S', distance: 6489,
            sport: 'RUNNING', heart_rate: {average: 137}
        }), 'exercise.json')
        expect(workout.durationSeconds).toBeCloseTo(3428.529)
        expect(workout.distanceKm).toBeCloseTo(6.489)
        expect(workout.averageHeartRate).toBe(137)
    })
})
