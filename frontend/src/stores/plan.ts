import { defineStore } from 'pinia'
import { ref } from 'vue'
import { workoutDb } from '../db/database'
import { requestTrainingPlan } from '../services/aiService'
import { getBalance } from '../services/billingService'
import { diagnosticLog } from '../services/logger'
import type { TrainingPlan } from '../types/workout'
import { plain } from '../utils/clone'
import { useI18n } from '../i18n'
import { useUiStore } from './ui'
import { useWorkoutStore } from './workouts'
import { useSettingsStore } from './settings'
import { useAnalysisStore } from './analysis'

const emptyPlan = (): TrainingPlan => ({ week_summary: { focus_title: '', goal_description: '' }, days: [] })
const frontendLocalMode = () => ['mock', 'local'].includes(import.meta.env.VITE_TRAINING_PLAN_MODE)

export const usePlanStore = defineStore('plan', () => {
  const plan = ref<TrainingPlan>(emptyPlan())
  const completedPlanDays = ref<string[]>([])

  async function load() {
    const savedPlan = await workoutDb.getPlan()
    diagnosticLog('plan.load.startup', {
      found: Boolean(savedPlan),
      dayCount: savedPlan?.plan?.days.length || 0,
      completedDayCount: savedPlan?.completedDays?.length || 0,
    })
    if (savedPlan?.plan) {
      plan.value = savedPlan.plan
      completedPlanDays.value = savedPlan.completedDays || []
    }
  }

  async function createPlan() {
    const ui = useUiStore()
    const workouts = useWorkoutStore()
    const settings = useSettingsStore()
    const analysis = useAnalysisStore()
    const { locale, t } = useI18n()

    if (plan.value.days.length && !window.confirm(t.value.confirmReplacePlan)) return
    if (!ui.consent) {
      ui.notify(t.value.consent, 'info')
      return
    }
    ui.loading = true
    ui.dismissNotification()
    const planRequestId = crypto.randomUUID()
    diagnosticLog('plan.create.start', {
      planRequestId,
      workoutCount: workouts.workouts.length,
      locale: locale.value,
    })
    try {
      if (!analysis.analysisResult) await analysis.refreshAnalysis()
      const result = await requestTrainingPlan(
        workouts.workouts,
        settings.config,
        analysis.analysisResult,
        settings.goals,
        locale.value,
      )
      diagnosticLog('plan.create.response', {
        planRequestId,
        dayCount: result.plan.days.length,
        days: result.plan.days.map((day) => day.day),
        hasWeekSummary: Boolean(result.plan.week_summary),
        debug: Boolean(result.debug),
      })
      plan.value = result.plan
      completedPlanDays.value = []
      diagnosticLog('plan.save.start', {
        planRequestId,
        dayCount: plan.value.days.length,
        hasWeekSummary: Boolean(plan.value.week_summary),
      })
      await workoutDb.savePlan(plain(plan.value))
      const persistedPlan = await workoutDb.getPlan()
      diagnosticLog('plan.save.verified', {
        planRequestId,
        found: Boolean(persistedPlan?.plan),
        dayCount: persistedPlan?.plan?.days.length || 0,
        days: persistedPlan?.plan?.days.map((day) => day.day) || [],
      })
      if (!frontendLocalMode()) ui.credits = await getBalance()
      ui.notify(result.debug ? 'Demo-Plan geladen: Gemini-Key ist noch nicht konfiguriert.' : t.value.planSaved, 'success')
    } catch (error) {
      diagnosticLog('plan.create.error', {
        planRequestId,
        error: error instanceof Error ? error.message : String(error),
      })
      ui.notify(t.value.aiFailed, 'error')
    } finally {
      ui.loading = false
    }
  }

  async function togglePlanDay(day: string) {
    completedPlanDays.value = completedPlanDays.value.includes(day)
      ? completedPlanDays.value.filter((item) => item !== day)
      : [...completedPlanDays.value, day]
    await workoutDb.savePlanWithStatus(plain(plan.value), plain(completedPlanDays.value))
  }

  function reset() {
    plan.value = emptyPlan()
    completedPlanDays.value = []
  }

  return {
    plan,
    completedPlanDays,
    load,
    createPlan,
    togglePlanDay,
    reset,
  }
})
