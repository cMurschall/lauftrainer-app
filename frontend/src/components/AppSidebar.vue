<script lang="ts" setup>
import { useI18n } from '../i18n'

const { t } = useI18n()
</script>
<template>
  <aside class="sidebar">
    <div class="brand">
      <span class="brand-mark"><img src="/lauftrainer-strava-icon.png" alt="" /></span>
      <div>
        <strong>LaufTrainer</strong><small>{{ t.coach }}</small>
      </div>
    </div>
    <nav :aria-label="t.navigation" class="nav">
      <RouterLink class="nav-link" exact-active-class="is-active" to="/">
        <span aria-hidden="true" class="nav-icon"
          ><svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1.8"
          >
            <path d="m3 10 9-7 9 7" />
            <path d="M5 9v11h14V9" />
            <path d="M9 20v-6h6v6" /></svg></span
        ><span>{{ t.dashboard }}</span
        ><span aria-hidden="true" class="nav-arrow">›</span>
      </RouterLink>
      <RouterLink class="nav-link" exact-active-class="is-active" to="/training">
        <span aria-hidden="true" class="nav-icon"
          ><svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1.8"
          >
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" /></svg></span
        ><span>{{ t.trainingNav }}</span
        ><span aria-hidden="true" class="nav-arrow">›</span>
      </RouterLink>
      <RouterLink class="nav-link" exact-active-class="is-active" to="/analysis">
        <span aria-hidden="true" class="nav-icon"
          ><svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1.8"
          >
            <path d="M4 19V5" />
            <path d="M4 19h16" />
            <path d="m7 15 3-4 3 2 5-7" /></svg></span
        ><span>{{ t.analysisNav }}</span
        ><span aria-hidden="true" class="nav-arrow">›</span>
      </RouterLink>
      <RouterLink class="nav-link" exact-active-class="is-active" to="/settings">
        <span aria-hidden="true" class="nav-icon"
          ><svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1.8"
          >
            <circle cx="12" cy="12" r="3" />
            <path
              d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"
            /></svg></span
        ><span>{{ t.settingsNav }}</span
        ><span aria-hidden="true" class="nav-arrow">›</span>
      </RouterLink>
    </nav>
    <span class="badge">{{ t.offlineReady }}</span>
  </aside>
</template>
