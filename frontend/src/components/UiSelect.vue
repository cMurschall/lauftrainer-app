<script setup lang="ts">
import {
  SelectContent,
  SelectItem,
  SelectItemText,
  SelectRoot,
  SelectTrigger,
  SelectValue,
  SelectViewport,
} from 'reka-ui'

defineProps<{
  modelValue: string
  options: Array<{ label: string; value: string }>
  ariaLabel: string
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
</script>

<template>
  <SelectRoot :model-value="modelValue" @update:model-value="emit('update:modelValue', $event)">
    <SelectTrigger class="ui-select-trigger" :aria-label="ariaLabel">
      <SelectValue />
      <span class="ui-select-chevron" aria-hidden="true">⌄</span>
    </SelectTrigger>
    <SelectContent class="ui-select-content" :side-offset="5">
      <SelectViewport class="ui-select-viewport">
        <SelectItem v-for="option in options" :key="option.value" :value="option.value" class="ui-select-item">
          <SelectItemText>{{ option.label }}</SelectItemText>
        </SelectItem>
      </SelectViewport>
    </SelectContent>
  </SelectRoot>
</template>
