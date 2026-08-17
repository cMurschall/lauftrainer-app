import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import DashboardView from './DashboardView.vue'
import { useWorkoutStore } from '../stores/workouts'
import { usePlanStore } from '../stores/plan'
import { useSettingsStore } from '../stores/settings'
import { useAnalysisStore } from '../stores/analysis'
import { localDateKey } from '../utils/planDates'
import type { Workout } from '../types/workout'

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

async function mountDashboard() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'dashboard', component: DashboardView },
      { path: '/settings', name: 'settings', component: { template: '<div />' } },
      { path: '/training', name: 'training', component: { template: '<div />' } },
    ],
  })
  await router.push('/')
  await router.isReady()
  return mount(DashboardView, {
    global: {
      plugins: [pinia, router],
      stubs: { Transition: false },
    },
  })
}

beforeEach(() => {
  localStorage.clear()
})

describe('DashboardView UX', () => {
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

  it('shows a single connect CTA without empty banner, stats, or create plan', async () => {
    const wrapper = await mountDashboard()
    useWorkoutStore().workouts = []
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-banner="empty"]').exists()).toBe(false)
    expect(wrapper.find('.dashboard-stats').exists()).toBe(false)
    expect(wrapper.find('.dashboard-empty-hero').exists()).toBe(true)
    expect(wrapper.text()).toMatch(/Connect training source|Trainingsquelle verbinden/)
  })

  it("shows today's workout widget when today has a planned workout", async () => {
    const wrapper = await mountDashboard()
    const workouts = useWorkoutStore()
    const planStore = usePlanStore()
    workouts.workouts = [sampleWorkout]

    const todayStr = localDateKey()
    planStore.plan = {
      start_date: todayStr,
      week_summary: { focus_title: 'Base', goal_description: 'Build aerobic fitness.' },
      days: [
        {
          date: todayStr,
          day: 'monday' as const,
          sport: 'running' as const,
          session_type: 'training' as const,
          title: 'Easy Run',
          description: 'A very easy active recovery run',
          target_focus: 'Base Endurance',
          total_duration_minutes: 45,
          workout_steps: [],
        },
      ],
    }

    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toMatch(/Today|Heute/)
    expect(wrapper.text()).toMatch(/Easy Run|A very easy active recovery run/)
    expect(wrapper.find('.dashboard-plan').exists()).toBe(true)
  })
})

// Keep analysis store referenced so Pinia initializes cleanly in isolation.
void useAnalysisStore
