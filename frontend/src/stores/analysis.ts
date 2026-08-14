import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { workoutDb } from '../db/database'
import { useAnalysis } from '../analysis/analysisService'
import type { AnalysisSummary } from '../types/workout'
import { useWorkoutStore } from './workouts'
import { useSettingsStore } from './settings'

const emptyAnalysis: AnalysisSummary = { totalDistanceKm: 0, totalDurationMinutes: 0, weekly: [], zoneMinutes: {} }

export const useAnalysisStore = defineStore('analysis', () => {
  const { analysisResult, dashboardSummary, isCalculating, calculationError, loadAnalysis, invalidateAnalysis } =
    useAnalysis()

  const analysis = computed<AnalysisSummary>(() => dashboardSummary.value || emptyAnalysis)

  let analysisRefreshTimer: ReturnType<typeof setTimeout> | undefined

  async function refreshAnalysis() {
    const workouts = useWorkoutStore()
    const settings = useSettingsStore()
    await loadAnalysis(workouts.workouts, settings.config)
  }

  function scheduleAnalysisRefresh() {
    if (analysisRefreshTimer) clearTimeout(analysisRefreshTimer)
    analysisRefreshTimer = setTimeout(() => {
      analysisRefreshTimer = undefined
      void refreshAnalysis()
    }, 150)
  }

  function reset() {
    invalidateAnalysis()
  }

  return {
    analysisResult,
    dashboardSummary,
    analysis,
    isCalculating,
    calculationError,
    refreshAnalysis,
    scheduleAnalysisRefresh,
    reset,
  }
})
