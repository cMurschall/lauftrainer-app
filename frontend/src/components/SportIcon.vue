<script lang="ts" setup>
import { computed } from 'vue'

const props = defineProps<{ sport?: string }>()
const kind = computed(() => {
  const value = (props.sport || '').toLowerCase()
  if (value.includes('cycl') || value.includes('rad') || value.includes('bike')) return 'cycling'
  if (value.includes('swim') || value.includes('schwimm')) return 'swimming'
  if (value.includes('hike') || value.includes('wand')) return 'hiking'
  if (value.includes('walk') || value.includes('geh')) return 'walking'
  if (value.includes('run') || value.includes('lauf')) return 'running'
  return 'other'
})
</script>

<template>
  <span class="sport-icon" :class="`sport-icon-${kind}`" aria-hidden="true">
    <svg v-if="kind === 'running'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"><circle cx="15.5" cy="4.5" r="2"/><path d="m13.5 8-2.2 4.2 3.1 2.1 2.3 5.2M11.6 12.2l-4.3-.4L5 15M13.7 9.2l3.7 2.1 2.7-1.2"/></svg>
    <svg v-else-if="kind === 'cycling'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.7"><circle cx="6" cy="17" r="3.5"/><circle cx="18" cy="17" r="3.5"/><path d="m6 17 4-7 4 7m-4-7h4l2 7M9 10H7"/></svg>
    <svg v-else-if="kind === 'swimming'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"><circle cx="16" cy="6" r="2"/><path d="m14.5 9-4 3 3 2 3-3 2.5 2M3 17c2 0 2.5 1.5 4.5 1.5S10 17 12 17s2.5 1.5 4.5 1.5S19 17 21 17M3 20c2 0 2.5 1.5 4.5 1.5S10 20 12 20s2.5 1.5 4.5 1.5S19 20 21 20"/></svg>
    <svg v-else-if="kind === 'hiking'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"><path d="m3 20 6-9 3 4 3-5 6 10H3Z"/><path d="m13 7 2-3 2 3M15 4v4"/></svg>
    <svg v-else-if="kind === 'walking'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"><circle cx="14.5" cy="4.5" r="2"/><path d="m13.5 8-1 5 3 2 1.5 5M12.5 10l-4 3-2 4M12.5 13l-3-1"/></svg>
    <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"><circle cx="12" cy="12" r="8"/><path d="M8 12h8M12 8v8"/></svg>
  </span>
</template>
