import { onMounted, onUnmounted, type Ref, watch } from 'vue'
import type { ThemePreference } from '../types/settings'

export function useTheme(theme: Ref<ThemePreference>) {
  const media = window.matchMedia('(prefers-color-scheme: dark)')

  const apply = () => {
    const dark = theme.value === 'dark' || (theme.value === 'system' && media.matches)
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  }

  const handleSystemChange = () => {
    if (theme.value === 'system') apply()
  }

  watch(theme, apply, { immediate: true })
  onMounted(() => media.addEventListener('change', handleSystemChange))
  onUnmounted(() => media.removeEventListener('change', handleSystemChange))
}
