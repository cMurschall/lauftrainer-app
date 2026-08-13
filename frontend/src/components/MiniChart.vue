<script setup lang="ts">
const props = withDefaults(defineProps<{ series: Array<{ name: string; values: number[]; color: string }>; labels: string[]; stacked?: boolean }>(), { stacked: false })
const width = 720; const height = 220; const pad = 28
function points(values: number[], max: number, offset = 0) { return values.map((value, index) => `${pad + (width - pad * 2) * (index / Math.max(1, values.length - 1))},${height - pad - ((value + offset) / Math.max(1, max)) * (height - pad * 2)}`).join(' ') }
function maxValue() { return Math.max(1, ...props.series.flatMap(s => s.values.map(v => Math.abs(v)))) }
</script>
<template><div class="mini-chart"><svg viewBox="0 0 720 220" role="img" aria-label="chart"><line x1="28" y1="192" x2="692" y2="192" stroke="currentColor" opacity=".2"/><polyline v-for="item in series" :key="item.name" :points="points(item.values, maxValue())" fill="none" :stroke="item.color" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><template v-for="(label, index) in labels" :key="`${label}-${index}`"><text v-if="index === 0 || index === labels.length - 1" :x="index ? 676 : 28" y="214" text-anchor="middle">{{ label }}</text></template></svg><div class="chart-legend"><span v-for="item in series" :key="item.name"><i :style="{ background: item.color }"></i>{{ item.name }}</span></div></div></template>
