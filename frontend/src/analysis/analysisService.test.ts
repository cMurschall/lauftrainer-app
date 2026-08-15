import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createAnalysisCacheKey, useAnalysis } from './analysisService'
import { workoutDb } from '../db/database'
import type { UserConfig, Workout } from '../types/workout'

const config: UserConfig = {
  trainingFocus: '',
  preferredTrainingDays: [],
  hrZones: { z1: [90, 120] },
  thresholds: { lthr: 160, hr_rest: 55, hr_max: 186 },
}
const workout: Workout = {
  id: 'a',
  source: 'unknown',
  name: 'run',
  sport: 'Running',
  date: '2026-08-10',
  durationSeconds: 1800,
  averageHeartRate: 130,
  records: [],
  importedAt: '',
}

beforeEach(async () => {
  await workoutDb.deleteAll()
  vi.restoreAllMocks()
})

describe('analysis cache service', () => {
  it('changes key for analysis config', async () => {
    const first = await createAnalysisCacheKey([workout], config)
    const second = await createAnalysisCacheKey([workout], {
      ...config,
      thresholds: { ...config.thresholds, lthr: 161 },
    })
    expect(second).not.toBe(first)
  })

  it('calculates on a miss and serves the cached result next time', async () => {
    const service = useAnalysis()
    await service.loadAnalysis([workout], config)
    expect(service.analysisResult.value).not.toBeNull()
    const saveSpy = vi.spyOn(workoutDb, 'saveAnalysisCache')
    await service.loadAnalysis([workout], config)
    expect(saveSpy).not.toHaveBeenCalled()
    expect(service.isCalculating.value).toBe(false)
  })

  it('exposes worker failures and clears loading state', async () => {
    const service = useAnalysis()
    vi.stubGlobal(
      'Worker',
      class {
        onmessage!: (event: MessageEvent) => void
        onerror!: (event: ErrorEvent) => void
        postMessage() {
          this.onerror({ message: 'worker down' } as ErrorEvent)
        }
        terminate() {}
      },
    )
    await service.loadAnalysis([workout], config)
    expect(service.calculationError.value).toContain('worker down')
    expect(service.isCalculating.value).toBe(false)
    vi.unstubAllGlobals()
  })
})
