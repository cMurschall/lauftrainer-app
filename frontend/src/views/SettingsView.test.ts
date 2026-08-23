import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import SettingsView from './SettingsView.vue'
import { useSettingsStore } from '../stores/settings'

async function mountSettings() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/settings', name: 'settings', component: SettingsView }],
  })
  await router.push('/settings')
  await router.isReady()
  return mount(SettingsView, {
    global: {
      plugins: [pinia, router],
      stubs: { Transition: false },
    },
  })
}

beforeEach(() => {
  localStorage.clear()
})

describe('SettingsView connectors', () => {
  it('shows sync button disabled without an active connected source', async () => {
    const wrapper = await mountSettings()
    useSettingsStore().connectors = [
      { id: 'polar', name: 'Polar', active: true, connected: false },
      { id: 'strava', name: 'Strava', active: true, connected: false },
    ]
    await wrapper.vm.$nextTick()
    const button = wrapper.get('[data-testid="sync-connectors-button"]')
    expect(button.attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toMatch(/automatically|automatisch/)
  })

  it('enables sync button when a connector is active and connected', async () => {
    const wrapper = await mountSettings()
    useSettingsStore().connectors = [
      { id: 'polar', name: 'Polar', active: true, connected: false },
      { id: 'strava', name: 'Strava', active: true, connected: true },
    ]
    await wrapper.vm.$nextTick()
    const button = wrapper.get('[data-testid="sync-connectors-button"]')
    expect(button.attributes('disabled')).toBeUndefined()
    expect(button.text()).toMatch(/Sync now|Jetzt synchronisieren/)
  })
})
