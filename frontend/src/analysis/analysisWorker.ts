import { calculateAnalysis } from './analysisEngine'
import { calculateAnalysis as calculateDashboardAnalysis } from './localAnalysis'
import type { UserConfig, Workout } from '../types/workout'

self.onmessage = (event: MessageEvent<{ workouts: Workout[]; config: UserConfig }>) => {
  try {
    const { workouts, config } = event.data
    self.postMessage({
      analysisResult: calculateAnalysis(workouts, config),
      dashboardSummary: calculateDashboardAnalysis(workouts, config),
    })
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Analyse konnte nicht berechnet werden.' })
  }
}
