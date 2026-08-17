import { defineStore } from 'pinia'
import { ref } from 'vue'
import { workoutDb } from '../db/database'
import { requestTrainingPlan } from '../services/aiService'
import { getBalance } from '../services/billingService'
import { diagnosticLog } from '../services/logger'
import type { TrainingPlan } from '../types/workout'
import { plain } from '../utils/clone'
import { localDateKey } from '../utils/planDates'
import { useI18n } from '../i18n'
import { useUiStore } from './ui'
import { useWorkoutStore } from './workouts'
import { useSettingsStore } from './settings'
import { useAnalysisStore } from './analysis'

const emptyPlan = (): TrainingPlan => ({
  start_date: '',
  week_summary: { focus_title: '', goal_description: '' },
  days: [],
})
const frontendLocalMode = () => ['mock', 'local'].includes(import.meta.env.VITE_TRAINING_PLAN_MODE)

export const usePlanStore = defineStore('plan', () => {
  const plan = ref<TrainingPlan>(emptyPlan())
  const completedPlanDates = ref<string[]>([])

  async function load() {
    const savedPlan = await workoutDb.getPlan()
    diagnosticLog('plan.load.startup', {
      found: Boolean(savedPlan),
      dayCount: savedPlan?.plan?.days.length || 0,
      completedDateCount: savedPlan?.completedDates?.length || 0,
    })
    if (savedPlan?.plan) {
      plan.value = savedPlan.plan
      completedPlanDates.value = savedPlan.completedDates || []
    }
  }

  async function createPlan(planNotes = '') {
    const ui = useUiStore()
    const workouts = useWorkoutStore()
    const settings = useSettingsStore()
    const analysis = useAnalysisStore()
    const { locale, t } = useI18n()

    if (!ui.consent) {
      ui.notify(t.value.consent, 'info')
      return
    }
    ui.loading = true
    ui.dismissNotification()
    const planRequestId = crypto.randomUUID()
    const planStartDate = localDateKey()
    const previousPlan = plan.value.days.length
      ? {
          start_date: plan.value.start_date,
          week_summary: plan.value.week_summary,
          days: plan.value.days.map((day) => ({
            date: day.date,
            day: day.day,
            sport: day.sport,
            session_type: day.session_type,
            title: day.title,
            total_duration_minutes: day.total_duration_minutes,
            completed: Boolean(day.date && completedPlanDates.value.includes(day.date)),
          })),
        }
      : undefined
    diagnosticLog('plan.create.start', {
      planRequestId,
      workoutCount: workouts.workouts.length,
      locale: locale.value,
      planStartDate,
      coachStyle: settings.coachStyle,
      hasPlanNotes: Boolean(planNotes.trim()),
    })
    try {
      if (!analysis.analysisResult) await analysis.refreshAnalysis()
      const result = await requestTrainingPlan(
        workouts.workouts,
        settings.config,
        analysis.analysisResult,
        settings.goals,
        locale.value,
        {
          planStartDate,
          coachStyle: settings.coachStyle,
          previousPlan,
          planNotes,
        },
      )
      diagnosticLog('plan.create.response', {
        planRequestId,
        dayCount: result.plan.days.length,
        days: result.plan.days.map((day) => day.date || day.day),
        hasWeekSummary: Boolean(result.plan.week_summary),
        debug: Boolean(result.debug),
      })
      plan.value = {
        ...result.plan,
        start_date: result.plan.start_date || result.plan.days[0]?.date || planStartDate,
      }
      completedPlanDates.value = []
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
        days: persistedPlan?.plan?.days.map((day) => day.date || day.day) || [],
      })
      if (!frontendLocalMode()) ui.credits = await getBalance()
      ui.notify(
        result.debug ? 'Demo-Plan geladen: Gemini-Key ist noch nicht konfiguriert.' : t.value.planSaved,
        'success',
      )
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

  async function togglePlanDate(date: string) {
    if (!date) return
    completedPlanDates.value = completedPlanDates.value.includes(date)
      ? completedPlanDates.value.filter((item) => item !== date)
      : [...completedPlanDates.value, date]
    await workoutDb.savePlanWithStatus(plain(plan.value), plain(completedPlanDates.value))
  }

  function reset() {
    plan.value = emptyPlan()
    completedPlanDates.value = []
  }

  return {
    plan,
    completedPlanDates,
    /** @deprecated use completedPlanDates */
    completedPlanDays: completedPlanDates,
    load,
    createPlan,
    togglePlanDate,
    /** @deprecated use togglePlanDate */
    togglePlanDay: togglePlanDate,
    reset,
  }
})
