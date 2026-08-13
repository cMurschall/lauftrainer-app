<script lang="ts" setup>
defineProps<{
  visible: boolean
  ios: boolean
  title: string
  description: string
  iosDescription: string
  installLabel: string
  dismissLabel: string
}>()

const emit = defineEmits<{ install: []; dismiss: [] }>()
</script>

<template>
  <aside v-if="visible" class="pwa-install-banner" role="status">
    <div>
      <strong>{{ title }}</strong>
      <p>{{ ios ? iosDescription : description }}</p>
    </div>
    <div class="pwa-install-actions">
      <button v-if="!ios" class="button primary" type="button" @click="emit('install')">{{ installLabel }}</button>
      <button class="text-button" type="button" @click="emit('dismiss')">{{ dismissLabel }}</button>
    </div>
  </aside>
</template>
