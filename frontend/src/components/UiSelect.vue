<script setup lang="ts">
defineProps<{
  modelValue: string
  options: Array<{ label: string; value: string }>
  ariaLabel: string
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
</script>

<template>
  <select
    :aria-label="ariaLabel"
    :value="modelValue"
    class="ui-select"
    @change="emit('update:modelValue', ($event.target as HTMLSelectElement).value)"
  >
    <option v-for="option in options" :key="option.value" :value="option.value">
      {{ option.label }}
    </option>
  </select>
</template>
