import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'
import './styles.css'
import { workoutDb } from './db/database'

async function prepareInitialTheme() {
  try {
    const settings = await workoutDb.getAppSettings()
    const preference = settings?.theme
    if (preference === 'dark' || preference === 'light' || preference === 'system') {
      localStorage.setItem('lauftrainer-theme', preference)
      const dark =
        preference === 'dark' || (preference === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
      document.documentElement.dataset.theme = dark ? 'dark' : 'light'
      document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
    }
  } catch {
    // The app can still start with the synchronous HTML fallback theme.
  }
}

prepareInitialTheme().finally(() => {
  createApp(App).use(createPinia()).use(router).mount('#app')
})
