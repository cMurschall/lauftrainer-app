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
        <span aria-hidden="true" class="nav-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"><path d="m3 10 9-7 9 7"/><path d="M5 9v11h14V9"/><path d="M9 20v-6h6v6"/></svg></span><span>{{ t.dashboard }}</span
        ><span aria-hidden="true" class="nav-arrow">›</span>
      </RouterLink>
      <RouterLink class="nav-link" exact-active-class="is-active" to="/settings">
        <span aria-hidden="true" class="nav-icon">⚙</span><span>{{ t.settingsNav }}</span
        ><span aria-hidden="true" class="nav-arrow">›</span>
      </RouterLink>
      <RouterLink class="nav-link" exact-active-class="is-active" to="/analysis">
        <span aria-hidden="true" class="nav-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"><path d="M4 19V5"/><path d="M4 19h16"/><path d="m7 15 3-4 3 2 5-7"/></svg></span><span>{{ t.analysisNav }}</span
        ><span aria-hidden="true" class="nav-arrow">›</span>
      </RouterLink>
    </nav>
    <span class="badge">{{ t.offlineReady }}</span>
  </aside>
</template>
