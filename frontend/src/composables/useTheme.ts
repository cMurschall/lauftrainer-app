import { onMounted, onUnmounted, type Ref, watch } from 'vue'
import type { ThemePreference } from '../types/settings'
import { diagnosticLog } from '../services/logger'

export function useTheme(theme: Ref<ThemePreference>) {
  const media = window.matchMedia('(prefers-color-scheme: dark)')

  const apply = (reason: string) => {
    const dark = theme.value === 'dark' || (theme.value === 'system' && media.matches)
    const resolved = dark ? 'dark' : 'light'
    const previous = document.documentElement.dataset.theme || '(unset)'
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
    diagnosticLog('theme.apply', {
      reason,
      preference: theme.value,
      systemPrefersDark: media.matches,
      resolved,
      previousResolved: previous,
      changed: previous !== resolved,
    })
  }

  const handleSystemChange = () => {
    diagnosticLog('theme.system-change', { preference: theme.value, systemPrefersDark: media.matches })
    if (theme.value === 'system') apply('system-media-query-change')
  }

  watch(theme, (value, previous) => apply(`preference-change:${previous ?? '(initial)'}->${value}`), {
    immediate: true,
  })
  onMounted(() => media.addEventListener('change', handleSystemChange))
  onUnmounted(() => media.removeEventListener('change', handleSystemChange))
}
