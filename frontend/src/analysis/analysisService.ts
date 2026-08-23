import { ref } from 'vue'
import { workoutDb, type AnalysisCacheEntry } from '../db/database'
import { calculateAnalysis } from './analysisEngine'
import { calculateAnalysis as calculateDashboardAnalysis } from './localAnalysis'
import type { AnalysisSummary, UserConfig, Workout } from '../types/workout'
import type { AnalysisResult } from './analysisEngine'
import { diagnosticLog } from '../services/logger'
import { cloneWorkoutsForAnalysis } from '../utils/workoutSummary'
import { plain } from '../utils/clone'

export const ANALYSIS_ALGORITHM_VERSION = 'analysis-v3-vo2max'

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
    // Strip GPS coordinates from records before postMessage to keep payloads smaller.
    const payload = { workouts: cloneWorkoutsForAnalysis(workouts), config: plain(config) }
    diagnosticLog('analysis.worker.start', { workoutCount: workouts.length })
    worker.onmessage = (event) => {
      worker.terminate()
      if (event.data.error) {
        diagnosticLog('analysis.worker.error', { message: event.data.error })
        reject(new Error(event.data.error))
      } else {
        diagnosticLog('analysis.worker.success', { workoutCount: workouts.length })
        resolve(event.data)
      }
    }
    worker.onerror = (event) => {
      worker.terminate()
      const message = event.message || 'Analyse konnte nicht berechnet werden.'
      diagnosticLog('analysis.worker.error', { message })
      reject(new Error(message))
    }
    try {
      worker.postMessage(payload)
    } catch (error) {
      worker.terminate()
      const message = error instanceof Error ? error.message : String(error)
      diagnosticLog('analysis.worker.clone-error', { message })
      reject(new Error(`Analyse-Daten konnten nicht an den Worker übertragen werden: ${message}`))
    }
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
      diagnosticLog('analysis.cache.hit', { workoutCount: workouts.length })
      analysisResult.value = cached.analysisResult
      dashboardSummary.value = cached.dashboardSummary
      isCalculating.value = false
      return
    }
    isCalculating.value = true
    diagnosticLog('analysis.cache.miss', { workoutCount: workouts.length })
    try {
      const result = await calculateInWorker(workouts, config)
      if (activeKey !== cacheKey) return
      analysisResult.value = result.analysisResult
      dashboardSummary.value = result.dashboardSummary
      const entry: AnalysisCacheEntry = { id: 'analysis', cacheKey, createdAt: new Date().toISOString(), ...result }
      await workoutDb.saveAnalysisCache(entry)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Analyse konnte nicht berechnet werden.'
      diagnosticLog('analysis.failed', { message, workoutCount: workouts.length })
      if (activeKey === cacheKey) calculationError.value = message
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
