import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import TrainingView from './TrainingView.vue'
import { useWorkoutStore } from '../stores/workouts'
import { usePlanStore } from '../stores/plan'
import { useSettingsStore } from '../stores/settings'
import { useUiStore } from '../stores/ui'
import type { Workout } from '../types/workout'

vi.mock('../utils/dashboardUi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/dashboardUi')>()
  return {
    ...actual,
    isTrainingPlanLocalMode: () => mockedLocalMode,
  }
})

let mockedLocalMode = true

const sampleWorkout: Workout = {
  id: 'w1',
  source: 'tcx',
  name: 'Run',
  sport: 'Running',
  date: '2026-08-10',
  durationSeconds: 1800,
  distanceKm: 5,
  records: [],
  importedAt: '',
}

const samplePlan = {
  start_date: '2026-08-10',
  week_summary: { focus_title: 'Base', goal_description: 'Build aerobic fitness.' },
  days: [
    {
      date: '2026-08-10',
      day: 'monday' as const,
      sport: 'running' as const,
      session_type: 'training' as const,
      title: 'Easy',
      description: 'Easy run',
      target_focus: 'Base',
      total_duration_minutes: 40,
      workout_steps: [],
    },
  ],
}

async function mountTraining() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/training', name: 'training', component: TrainingView },
      { path: '/pricing', name: 'pricing', component: { template: '<div />' } },
      { path: '/settings', name: 'settings', component: { template: '<div />' } },
    ],
  })
  await router.push('/training')
  await router.isReady()
  return mount(TrainingView, {
    global: {
      plugins: [pinia, router],
      stubs: { Transition: false },
    },
  })
}

beforeEach(() => {
  mockedLocalMode = true
  localStorage.clear()
})

describe('TrainingView UX', () => {
  it('disables create without consent and shows primary create without a plan', async () => {
    const wrapper = await mountTraining()
    const workouts = useWorkoutStore()
    const ui = useUiStore()
    workouts.workouts = [sampleWorkout]
    ui.consent = false
    await wrapper.vm.$nextTick()

    const button = wrapper.get('[data-testid="create-plan-button"]')
    expect(button.text()).toMatch(/Create plan|Plan erstellen/)
    expect(button.classes()).toContain('primary')
    expect(button.attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toMatch(/consent|Einverständnis|Please consent|Bitte zuerst/i)
  })

  it('shows replace primary when a plan exists and enables create in local mode with consent', async () => {
    const wrapper = await mountTraining()
    const workouts = useWorkoutStore()
    const plan = usePlanStore()
    const ui = useUiStore()
    workouts.workouts = [sampleWorkout]
    plan.plan = samplePlan
    ui.consent = true
    ui.credits = 0
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toMatch(/Next 7 days|Nächste 7 Tage/)
    const button = wrapper.get('[data-testid="create-plan-button"]')
    expect(button.text()).toMatch(/Replace plan|Plan ersetzen/)
    expect(button.classes()).toContain('primary')
    expect(button.attributes('disabled')).toBeUndefined()
  })

  it('disables create for zero credits outside local mode', async () => {
    mockedLocalMode = false
    const wrapper = await mountTraining()
    const workouts = useWorkoutStore()
    const ui = useUiStore()
    workouts.workouts = [sampleWorkout]
    ui.consent = true
    ui.credits = 0
    await wrapper.vm.$nextTick()
    const button = wrapper.get('[data-testid="create-plan-button"]')
    expect(button.attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toMatch(/1 credit|1 Credit/)
  })

  it('shows workout blocker hint and sync CTA when connected but no local workouts', async () => {
    const wrapper = await mountTraining()
    const settings = useSettingsStore()
    settings.connectors = [
      { id: 'polar', name: 'Polar', active: true, connected: false },
      { id: 'strava', name: 'Strava', active: true, connected: true },
    ]
    await wrapper.vm.$nextTick()
    const button = wrapper.get('[data-testid="create-plan-button"]')
    expect(button.attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toMatch(/at least one workout|Mindestens ein Training/i)
    expect(wrapper.find('[data-testid="training-sync-button"]').exists()).toBe(true)
  })

  it('shows connect CTA when no workouts and no connected source', async () => {
    const wrapper = await mountTraining()
    useSettingsStore().connectors = [
      { id: 'polar', name: 'Polar', active: true, connected: false },
      { id: 'strava', name: 'Strava', active: true, connected: false },
    ]
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toMatch(/Connect training source|Trainingsquelle verbinden/)
    expect(wrapper.find('[data-testid="training-sync-button"]').exists()).toBe(false)
  })

  it('hides plan notes until the user opts in', async () => {
    const wrapper = await mountTraining()
    expect(wrapper.find('[data-testid="plan-notes-input"]').exists()).toBe(false)
    await wrapper.get('[data-testid="plan-context-toggle"]').setValue(true)
    expect(wrapper.find('[data-testid="plan-notes-input"]').exists()).toBe(true)
    expect(wrapper.text()).toMatch(/7 days|7 Tage/)
  })
})
