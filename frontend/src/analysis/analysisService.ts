import { ref } from 'vue'
import { workoutDb, type AnalysisCacheEntry } from '../db/database'
import { calculateAnalysis } from './analysisEngine'
import { calculateAnalysis as calculateDashboardAnalysis } from './localAnalysis'
import type { AnalysisSummary, UserConfig, Workout } from '../types/workout'
import type { AnalysisResult } from './analysisEngine'

export const ANALYSIS_ALGORITHM_VERSION = 'analysis-v1'

function stableValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${key}:${stableValue((value as Record<string, unknown>)[key])}`)
      .join('|')}}`
  return JSON.stringify(value)
}

function fingerprint(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16)
}

export async function createAnalysisCacheKey(workouts: Workout[], config: UserConfig): Promise<string> {
  const revision = await workoutDb.getWorkoutRevision()
  return `${ANALYSIS_ALGORITHM_VERSION}:${revision}:${fingerprint(
    stableValue({
      config: { hrZones: config.hrZones, thresholds: config.thresholds },
    }),
  )}`
}

function calculateInMainThread(workouts: Workout[], config: UserConfig) {
  return {
    analysisResult: calculateAnalysis(workouts, config),
    dashboardSummary: calculateDashboardAnalysis(workouts, config),
  }
}

function calculateInWorker(
  workouts: Workout[],
  config: UserConfig,
): Promise<{ analysisResult: AnalysisResult; dashboardSummary: AnalysisSummary }> {
  if (typeof Worker === 'undefined') return Promise.resolve(calculateInMainThread(workouts, config))
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./analysisWorker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event) => {
      worker.terminate()
      if (event.data.error) reject(new Error(event.data.error))
      else resolve(event.data)
    }
    worker.onerror = (event) => {
      worker.terminate()
      reject(new Error(event.message || 'Analyse konnte nicht berechnet werden.'))
    }
    worker.postMessage({ workouts, config })
  })
}

export function useAnalysis() {
  const analysisResult = ref<AnalysisResult | null>(null)
  const dashboardSummary = ref<AnalysisSummary | null>(null)
  const isCalculating = ref(false)
  const calculationError = ref('')
  let activeKey = ''

  async function loadAnalysis(workouts: Workout[], config: UserConfig) {
    const cacheKey = await createAnalysisCacheKey(workouts, config)
    activeKey = cacheKey
    calculationError.value = ''
    const cached = await workoutDb.getAnalysisCache(cacheKey)
    if (activeKey !== cacheKey) return
    if (cached) {
      analysisResult.value = cached.analysisResult
      dashboardSummary.value = cached.dashboardSummary
      isCalculating.value = false
      return
    }
    isCalculating.value = true
    try {
      const result = await calculateInWorker(workouts, config)
      if (activeKey !== cacheKey) return
      analysisResult.value = result.analysisResult
      dashboardSummary.value = result.dashboardSummary
      const entry: AnalysisCacheEntry = { id: 'analysis', cacheKey, createdAt: new Date().toISOString(), ...result }
      await workoutDb.saveAnalysisCache(entry)
    } catch (error) {
      if (activeKey === cacheKey)
        calculationError.value = error instanceof Error ? error.message : 'Analyse konnte nicht berechnet werden.'
    } finally {
      if (activeKey === cacheKey) isCalculating.value = false
    }
  }

  function invalidateAnalysis() {
    activeKey = ''
    analysisResult.value = null
    dashboardSummary.value = null
    calculationError.value = ''
  }

  return { analysisResult, dashboardSummary, isCalculating, calculationError, loadAnalysis, invalidateAnalysis }
}
