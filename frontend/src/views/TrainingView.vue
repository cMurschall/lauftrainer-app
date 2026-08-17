<script lang="ts" setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from '../i18n'
import type { TrainingPlanDay } from '../types/workout'
import { useWorkoutStore } from '../stores/workouts'
import { usePlanStore } from '../stores/plan'
import { useUiStore } from '../stores/ui'
import { canCreatePlan, createPlanButtonMode, isTrainingPlanLocalMode } from '../utils/dashboardUi'
import PageHeader from '../components/PageHeader.vue'

const workouts = useWorkoutStore()
const planStore = usePlanStore()
const ui = useUiStore()

const { summaries } = storeToRefs(workouts)
const { plan, completedPlanDates } = storeToRefs(planStore)
const { credits, loading, consent } = storeToRefs(ui)

const { t, locale } = useI18n()
const localMode = isTrainingPlanLocalMode()

const planMinutes = computed(() => plan.value.days.reduce((sum, day) => sum + day.total_duration_minutes, 0))
const completedCount = computed(
  () => plan.value.days.filter((day) => day.date && completedPlanDates.value.includes(day.date)).length,
)
const hasPlan = computed(() => plan.value.days.length > 0)
const buttonMode = computed(() => createPlanButtonMode({ hasPlan: hasPlan.value }))

const planDescription = (day: TrainingPlanDay) => {
  const description = day.description?.trim() || ''
  if (day.session_type === 'rest') {
    if (description && !description.startsWith('Converted to rest:') && !description.startsWith('TESTPLAN')) {
      return description
    }
    return t.value.restDayDescription
  }
  if (description.startsWith('TESTPLAN')) {
    return day.total_duration_minutes === 0
      ? t.value.restDayDescriptionFallback
      : t.value.testPlanFocusDescription(day.target_focus)
  }
  return description || t.value.restDayDescriptionFallback
}

const showPlanSteps = (day: TrainingPlanDay) =>
  day.workout_steps.some((step) => Boolean(step.step_instruction?.trim() || step.step_duration?.trim()))

const createEnabled = computed(() =>
  canCreatePlan({
    consent: consent.value,
    workoutCount: summaries.value.length,
    loading: loading.value,
    credits: credits.value,
    localMode,
  }),
)

const createHint = computed(() => {
  if (!summaries.value.length || loading.value) return ''
  if (!consent.value) return t.value.needConsent
  if (!localMode && credits.value < 1) return t.value.needCredits
  return ''
})

const planStepIndex = ref(0)
let planStepTimer: number | undefined

const planStepText = computed(() => {
  const steps = t.value.creatingPlanSteps
  return steps[Math.min(planStepIndex.value, steps.length - 1)]
})

watch(loading, (isLoading) => {
  window.clearInterval(planStepTimer)
  if (!isLoading) return
  planStepIndex.value = 0
  planStepTimer = window.setInterval(() => {
    const steps = t.value.creatingPlanSteps
    if (planStepIndex.value < steps.length - 1) planStepIndex.value += 1
  }, 1600)
})

onBeforeUnmount(() => window.clearInterval(planStepTimer))

const planDayLabel = (day: TrainingPlanDay) => {
  const weekday = t.value[day.day]
  if (!day.date) return weekday
  const formatted = new Intl.DateTimeFormat(locale.value, { day: '2-digit', month: '2-digit' }).format(
    new Date(`${day.date}T12:00:00`),
  )
  return `${weekday}, ${formatted}`
}

const planSportLabel = (day: TrainingPlanDay) => {
  if (day.session_type === 'rest') return t.value.restDay
  if (day.sport_label?.trim()) return day.sport_label.trim()
  return t.value[day.sport]
}

const planDayKey = (day: TrainingPlanDay, index: number) => day.date || `${day.day}-${index}`
const isPlanDayCompleted = (day: TrainingPlanDay) => Boolean(day.date && completedPlanDates.value.includes(day.date))

const planNotesDraft = ref('')

async function submitPlan() {
  if (!createEnabled.value) return
  if (hasPlan.value && !window.confirm(t.value.confirmReplacePlan)) return
  const notes = planNotesDraft.value
  planNotesDraft.value = ''
  await planStore.createPlan(notes)
}
</script>

<template>
  <PageHeader :label="t.trainingNav" :meta="t.trainingIntro" />

  <div class="dashboard-flow" :class="{ 'has-plan': hasPlan }">
    <!-- Full week plan -->
    <section v-if="hasPlan" class="card plan dashboard-plan">
      <div class="plan-heading">
        <div class="plan-heading-title">
          <h3>{{ t.nextSevenDays }}</h3>
          <span class="plan-badge">{{ t.aiPlanBadge }}</span>
        </div>
        <div class="plan-summary">
          <strong>{{ planMinutes }} min</strong>
          <span>{{ completedCount }}/{{ plan.days.length }} {{ t.planCompleted }}</span>
        </div>
      </div>
      <p class="muted plan-disclaimer">{{ t.aiDisclaimer }}</p>
      <div
        v-if="plan.week_summary?.focus_title || plan.week_summary?.goal_description"
        class="week-summary rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3"
      >
        <strong class="font-semibold text-emerald-600 dark:text-emerald-400">{{
          plan.week_summary?.focus_title || t.weekFocus
        }}</strong>
        <p v-if="plan.week_summary?.goal_description" class="text-xs italic text-zinc-600 dark:text-zinc-400">
          {{ plan.week_summary.goal_description }}
        </p>
      </div>
      <article
        v-for="(day, index) in plan.days"
        :key="planDayKey(day, index)"
        class="plan-day"
        :class="{ completed: isPlanDayCompleted(day) }"
      >
        <label class="plan-check">
          <input :checked="isPlanDayCompleted(day)" type="checkbox" @change="planStore.togglePlanDate(day.date)" />
          <span>
            <strong class="plan-day-name">{{ planDayLabel(day) }}</strong>
            <small>{{ day.target_focus }}</small>
          </span>
        </label>
        <div class="plan-day-meta">
          <span class="plan-sport">{{ planSportLabel(day) }}</span>
          <strong>{{ day.total_duration_minutes }} min</strong>
        </div>
        <p>{{ planDescription(day) }}</p>
        <ul v-if="showPlanSteps(day)" class="plan-steps">
          <li
            v-for="step in day.workout_steps"
            :key="`${planDayKey(day, index)}-${step.step_duration}-${step.step_instruction}`"
          >
            <div class="plan-step-meta">
              <strong class="plan-step-duration">{{ step.step_duration }}</strong>
              <span class="plan-step-intensity">{{ step.step_intensity }}</span>
            </div>
            <span class="plan-step-instruction">{{ step.step_instruction }}</span>
          </li>
        </ul>
      </article>
    </section>

    <!-- Plan generation card -->
    <section class="card ai-plan-card" :class="{ compact: hasPlan }">
      <div class="credits-summary">
        <p class="eyebrow">{{ t.creditLabel }}</p>
        <strong class="metric">{{ credits }}</strong>
        <span class="muted">{{ t.creditPerPlan }}</span>
        <RouterLink class="button primary credits-link" to="/pricing">{{ t.buyCredits }}</RouterLink>
        <p class="muted credits-device-note">{{ t.creditsDeviceNote }}</p>
      </div>
      <p class="eyebrow">{{ t.aiPlan }}</p>
      <p>{{ t.aiDescription }}</p>
      <p class="muted ai-disclaimer">{{ t.aiDisclaimer }}</p>
      <label class="consent">
        <input :checked="consent" type="checkbox" @change="ui.consent = ($event.target as HTMLInputElement).checked" />
        {{ t.consent }}
      </label>
      <div v-if="consent" class="plan-notes">
        <label class="plan-notes-label" for="plan-notes-input">{{ t.planContext }}</label>
        <p class="field-help">{{ t.planContextHelp }}</p>
        <textarea
          id="plan-notes-input"
          v-model="planNotesDraft"
          rows="3"
          :placeholder="t.planContextPlaceholder"
        ></textarea>
      </div>
      <button
        :disabled="!createEnabled"
        class="button full primary"
        type="button"
        data-testid="create-plan-button"
        @click="submitPlan"
      >
        {{ loading ? t.creatingPlan : buttonMode === 'replace' ? t.replacePlan : t.createPlan }}
      </button>
      <div v-if="loading" class="plan-progress" role="status" aria-live="polite">
        <div class="plan-progress-bar" aria-hidden="true"><span></span></div>
        <p class="plan-progress-step">
          <span class="spinner" aria-hidden="true"></span>
          {{ planStepText }}
        </p>
      </div>
      <p v-else-if="createHint" class="muted create-hint">{{ createHint }}</p>
    </section>
  </div>
</template>
