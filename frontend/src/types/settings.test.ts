import { describe, expect, it } from 'vitest'
import { normalizeAppSettings, normalizeMapDetailsConsent } from '../types/settings'

describe('map details consent settings', () => {
  it('normalizes known consent values and falls back to unset', () => {
    expect(normalizeMapDetailsConsent('allowed')).toBe('allowed')
    expect(normalizeMapDetailsConsent('denied')).toBe('denied')
    expect(normalizeMapDetailsConsent('unset')).toBe('unset')
    expect(normalizeMapDetailsConsent('nope')).toBe('unset')
    expect(normalizeMapDetailsConsent(undefined)).toBe('unset')
  })

  it('fills mapDetailsConsent when migrating older app settings', () => {
    const normalized = normalizeAppSettings({
      theme: 'dark',
      locale: 'de',
      connectors: [],
      coachStyle: 'mentor',
    })
    expect(normalized.mapDetailsConsent).toBe('unset')
    expect(normalized.coachStyle).toBe('mentor')
  })
})
