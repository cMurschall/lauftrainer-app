<script lang="ts" setup>
const props = withDefaults(defineProps<{
  series: Array<{ name: string; values: number[]; color: string }>;
  labels: string[];
  stacked?: boolean
}>(), {stacked: false})
const width = 720;
const height = 220;
const pad = 28

function points(values: number[], max: number, offset = 0) {
  return values.map((value, index) => `${pad + (width - pad * 2) * (index / Math.max(1, values.length - 1))},${height - pad - ((value + offset) / Math.max(1, max)) * (height - pad * 2)}`).join(' ')
}

function maxValue() {
  return Math.max(1, ...props.series.flatMap(s => s.values.map(v => Math.abs(v))))
}
</script>
<template>
  <div class="mini-chart">
    <svg aria-label="chart" role="img" viewBox="0 0 720 220">
      <line opacity=".2" stroke="currentColor" x1="28" x2="692" y1="192" y2="192"/>
      <polyline v-for="item in series" :key="item.name" :points="points(item.values, maxValue())" :stroke="item.color"
                fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="3"/>
      <template v-for="(label, index) in labels" :key="`${label}-${index}`">
        <text v-if="index === 0 || index === labels.length - 1" :x="index ? 676 : 28" text-anchor="middle" y="214">
          {{ label }}
        </text>
      </template>
    </svg>
    <div class="chart-legend"><span v-for="item in series" :key="item.name"><i :style="{ background: item.color }"></i>{{
        item.name
      }}</span></div>
  </div>
</template>
