<script lang="ts" setup>
defineProps<{
  summary: string
  paragraphs: readonly string[]
}>()
</script>
<template>
  <details class="chart-help">
    <summary>{{ summary }}</summary>
    <p v-for="(paragraph, index) in paragraphs" :key="index">{{ paragraph }}</p>
  </details>
</template>
