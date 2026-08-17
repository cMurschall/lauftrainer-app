<script lang="ts" setup>
defineProps<{ label: string; meta?: string }>()
</script>
<template>
  <header class="page-header">
    <div class="page-header-text">
      <p class="eyebrow page-header-label">{{ label }}</p>
      <p v-if="meta" class="page-header-meta">{{ meta }}</p>
    </div>
    <div v-if="$slots.actions" class="page-header-actions">
      <slot name="actions" />
    </div>
  </header>
</template>
