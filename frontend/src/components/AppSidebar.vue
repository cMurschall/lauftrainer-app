<script lang="ts" setup>
import { useI18n } from '../i18n'

const { t } = useI18n()
</script>
<template>
  <aside class="sidebar">
    <div class="brand">
      <span class="brand-mark">L</span>
      <div>
        <strong>LaufTrainer</strong><small>{{ t.coach }}</small>
      </div>
    </div>
    <nav :aria-label="t.navigation" class="nav">
      <RouterLink class="nav-link" exact-active-class="is-active" to="/">
        <span aria-hidden="true" class="nav-icon">⌂</span><span>{{ t.dashboard }}</span
        ><span aria-hidden="true" class="nav-arrow">›</span>
      </RouterLink>
      <RouterLink class="nav-link" exact-active-class="is-active" to="/settings">
        <span aria-hidden="true" class="nav-icon">⚙</span><span>{{ t.settingsNav }}</span
        ><span aria-hidden="true" class="nav-arrow">›</span>
      </RouterLink>
      <RouterLink class="nav-link" exact-active-class="is-active" to="/analysis">
        <span aria-hidden="true" class="nav-icon">↗</span><span>{{ t.analysisNav }}</span
        ><span aria-hidden="true" class="nav-arrow">›</span>
      </RouterLink>
    </nav>
    <span class="badge">{{ t.offlineReady }}</span>
  </aside>
</template>
