import {describe, expect, it} from 'vitest'
import {
    calculateEfficiency,
    calculateFosterMetrics,
    calculateHrZoneDistribution,
    calculatePolarization,
    calculateTrainingLoad,
    isoWeekStart
} from './analysisEngine'
import type {UserConfig, Workout} from '../types/workout'

const config: UserConfig = {
    name: 'Test',
    trainingFocus: '',
    preferredTrainingDays: [],
    hrZones: {z1: [90, 106], z2: [107, 124], z3: [125, 142], z4: [143, 160], z5: [161, 179]},
    thresholds: {lthr: 160, hr_max: 186, hr_rest: 55}
}

function workout(partial: Partial<Workout>): Workout {
    return {
        id: Math.random().toString(),
        source: 'unknown',
        name: 'test',
        sport: 'Running',
        date: '01-01-2025',
        durationSeconds: 3600,
        averageHeartRate: 120,
        records: [],
        importedAt: '', ...partial
    }
}

describe('analysis engine', () => {
    it('uses Monday as ISO week start and handles DMY dates', () => {
        expect(isoWeekStart('05-01-2025')).toBe('2024-12-30');
        expect(isoWeekStart('06-01-2025')).toBe('2025-01-06')
    })
    it('fills rest days and computes CTL/ATL/TSB', () => {
        const result = calculateTrainingLoad([workout({
            date: '01-01-2025',
            averageHeartRate: 155
        }), workout({date: '03-01-2025', averageHeartRate: 155})], config);
        expect(result).toHaveLength(3);
        expect(result[1].trimp).toBe(0);
        expect(result[2].ctl).toBeGreaterThan(0);
        expect(result[2].atl).toBeGreaterThan(result[2].ctl)
    })
    it('calculates Foster zero-standard-deviation fallback', () => {
        const result = calculateFosterMetrics([workout({date: '06-01-2025'}), workout({date: '07-01-2025'})], config);
        expect(result[0].monotony).toBe(result[0].load / 2);
        expect(result[0].strain).toBe(result[0].monotony * result[0].load)
    })
    it('does not invent a polarization index for empty Z2', () => {
        const result = calculatePolarization([workout({averageHeartRate: 100})], config);
        expect(result[0].z1Pct).toBe(100);
        expect(result[0].polarizationIndex).toBeUndefined()
    })
    it('weights heart-rate zones by record elapsed time', () => {
        const result = calculateHrZoneDistribution([workout({
            records: [{
                elapsedSeconds: 0,
                heartRateBpm: 100
            }, {elapsedSeconds: 10, heartRateBpm: 120}, {elapsedSeconds: 30, heartRateBpm: 170}]
        })], config);
        expect(result[0].minutes[0]).toBeCloseTo(10 / 60);
        expect(result[0].minutes[1]).toBeCloseTo(20 / 60)
    })
    it('filters invalid efficiency values', () => {
        expect(calculateEfficiency([workout({
            distanceKm: 10,
            durationSeconds: 3600,
            averageHeartRate: 150
        }), workout({distanceKm: undefined})])).toHaveLength(1)
    })
})
