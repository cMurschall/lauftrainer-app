<script lang="ts" setup>
import { computed } from 'vue'
import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
} from 'chart.js'
import { Line } from 'vue-chartjs'
import { Bar } from 'vue-chartjs'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Tooltip, Legend, Filler)

const props = withDefaults(
  defineProps<{
    series: Array<{
      name: string
      values: number[]
      color: string
      axis?: 'left' | 'right'
      pointRadius?: number
      borderWidth?: number
    }>
    labels: string[]
    yUnit?: string
    rightYUnit?: string
    type?: 'line' | 'bar'
    stacked?: boolean
    dynamicY?: boolean
  }>(),
  { yUnit: '', type: 'line', stacked: false, dynamicY: false },
)

function resolveColor(value: string): string {
  const match = value.match(/^var\((--[^)]+)\)$/)
  return match ? getComputedStyle(document.documentElement).getPropertyValue(match[1]).trim() : value
}

function formatChartValue(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '–'
  return Number(value.toFixed(props.yUnit === 'efficiency' ? 3 : 1)).toString()
}

const data = computed(() => ({
  labels: props.labels,
  datasets: props.series.map((item) => {
    const color = resolveColor(item.color)
    return {
      label: item.name,
      data: item.values,
      borderColor: color,
      backgroundColor: color,
      pointRadius: item.pointRadius ?? 0,
      pointHoverRadius: 4,
      borderWidth: item.borderWidth ?? 2,
      tension: 0.28,
      fill: false,
      yAxisID: item.axis === 'right' ? 'yRight' : 'y',
      ...(props.type === 'bar' ? { borderWidth: 0, borderRadius: 2 } : {}),
    }
  }),
}))

const chartComponent = computed(() => (props.type === 'bar' ? Bar : Line))

const chartValues = computed(() => props.series.flatMap((item) => item.values).filter(Number.isFinite))
const chartMax = computed(() => (chartValues.value.length ? Math.max(...chartValues.value) : 0))
const chartMin = computed(() => (chartValues.value.length ? Math.min(...chartValues.value) : 0))
const chartPadding = computed(() => Math.max((chartMax.value - chartMin.value) * 0.1, 0.001))

const options = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: 'index' as const, intersect: false },
  plugins: {
    legend: {
      position: 'bottom' as const,
      labels: { color: resolveColor('var(--muted)'), usePointStyle: true, boxWidth: 8, padding: 14 },
    },
    tooltip: {
      callbacks: {
        label: (context: { dataset: { label?: string }; parsed: { y: number | null } }) =>
          `${context.dataset.label || ''}: ${formatChartValue(context.parsed.y)} ${props.yUnit}`,
      },
    },
  },
  layout: { padding: { top: 8, right: 4, bottom: 2, left: 2 } },
  scales: {
    x: {
      stacked: props.stacked,
      grid: { display: false },
      ticks: { color: resolveColor('var(--muted)'), maxTicksLimit: 4, maxRotation: 0, autoSkip: true },
    },
    y: {
      stacked: props.stacked,
      beginAtZero: !props.dynamicY,
      min: props.dynamicY ? chartMin.value - chartPadding.value : 0,
      max: props.dynamicY ? chartMax.value + chartPadding.value : props.yUnit === '%' ? 100 : undefined,
      ...(props.stacked && props.yUnit === '%' ? { grace: '5%' } : {}),
      grid: { color: 'rgba(255,255,255,.08)' },
      ticks: {
        color: resolveColor('var(--muted)'),
        maxTicksLimit: 4,
        callback: (value: string | number) =>
          `${formatChartValue(typeof value === 'number' ? value : Number(value))} ${props.yUnit}`,
      },
    },
    ...(props.rightYUnit
      ? {
          yRight: {
            position: 'right' as const,
            beginAtZero: false,
            grid: { drawOnChartArea: false },
            ticks: {
              color: resolveColor('var(--muted)'),
              maxTicksLimit: 4,
              callback: (value: string | number) =>
                `${formatChartValue(typeof value === 'number' ? value : Number(value))} ${props.rightYUnit}`,
            },
          },
        }
      : {}),
  },
}))
</script>
<template>
  <div class="mini-chart">
    <div class="mini-chart-canvas"><component :is="chartComponent" :data="data" :options="options" /></div>
  </div>
</template>
