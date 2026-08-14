import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import DashboardView from './DashboardView.vue'
import { useWorkoutStore } from '../stores/workouts'
import { usePlanStore } from '../stores/plan'
import { useSettingsStore } from '../stores/settings'
import { useUiStore } from '../stores/ui'
import { useAnalysisStore } from '../stores/analysis'
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
  week_summary: { focus_title: 'Base', goal_description: 'Build aerobic fitness.' },
  days: [
    {
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

async function mountDashboard() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'dashboard', component: DashboardView },
      { path: '/settings', name: 'settings', component: { template: '<div />' } },
      { path: '/pricing', name: 'pricing', component: { template: '<div />' } },
    ],
  })
  await router.push('/')
  await router.isReady()
  return mount(DashboardView, {
    global: {
      plugins: [pinia, router],
      stubs: { SportIcon: true, Transition: false },
    },
  })
}

beforeEach(() => {
  mockedLocalMode = true
  localStorage.clear()
})

describe('DashboardView UX', () => {
  it('disables create without consent and shows primary create without a plan', async () => {
    const wrapper = await mountDashboard()
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

  it('shows replace secondary when a plan exists and enables create in local mode with consent', async () => {
    const wrapper = await mountDashboard()
    const workouts = useWorkoutStore()
    const plan = usePlanStore()
    const ui = useUiStore()
    workouts.workouts = [sampleWorkout]
    plan.plan = samplePlan
    ui.consent = true
    ui.credits = 0
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toMatch(/Your week|Deine Woche/)
    expect(wrapper.find('.dashboard-flow.has-plan').exists()).toBe(true)
    const button = wrapper.get('[data-testid="create-plan-button"]')
    expect(button.text()).toMatch(/Replace plan|Plan ersetzen/)
    expect(button.classes()).toContain('secondary')
    expect(button.attributes('disabled')).toBeUndefined()
  })

  it('shows soft connector copy when local workouts exist without sync', async () => {
    const wrapper = await mountDashboard()
    useWorkoutStore().workouts = [sampleWorkout]
    useSettingsStore().connectors = [
      { id: 'polar', name: 'Polar', active: true, connected: false },
      { id: 'strava', name: 'Strava', active: true, connected: false },
    ]
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-banner="localData"]').exists()).toBe(true)
    expect(wrapper.text()).toMatch(/Local workouts|Lokale Workouts/)
  })

  it('shows empty-source copy without workouts', async () => {
    const wrapper = await mountDashboard()
    useWorkoutStore().workouts = []
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-banner="empty"]').exists()).toBe(true)
    expect(wrapper.text()).toMatch(/No active training source|Keine aktive Trainingsquelle/)
  })

  it('disables create for zero credits outside local mode', async () => {
    mockedLocalMode = false
    const wrapper = await mountDashboard()
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
})

// Keep analysis store referenced so Pinia initializes cleanly in isolation.
void useAnalysisStore
