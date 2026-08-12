<script setup lang="ts">
import { useI18n } from '../i18n'
const { t } = useI18n()
</script>
<template>
  <aside class="sidebar">
    <div class="brand"><span class="brand-mark">L</span><div><strong>LaufTrainer</strong><small>{{ t.coach }}</small></div></div>
    <nav class="nav" :aria-label="t.navigation">
      <RouterLink to="/" class="nav-link" exact-active-class="is-active">
        <span class="nav-icon" aria-hidden="true">⌂</span><span>{{ t.dashboard }}</span><span class="nav-arrow" aria-hidden="true">›</span>
      </RouterLink>
      <RouterLink to="/settings" class="nav-link" exact-active-class="is-active">
        <span class="nav-icon" aria-hidden="true">⚙</span><span>{{ t.settingsNav }}</span><span class="nav-arrow" aria-hidden="true">›</span>
      </RouterLink>
    </nav>
    <span class="badge">{{ t.offlineReady }}</span>
  </aside>
</template>
