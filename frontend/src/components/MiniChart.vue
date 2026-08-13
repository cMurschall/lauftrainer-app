<script lang="ts" setup>
import {computed} from 'vue'
import {BarElement, CategoryScale, Chart as ChartJS, Filler, Legend, LinearScale, LineElement, PointElement, Tooltip} from 'chart.js'
import {Line} from 'vue-chartjs'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Tooltip, Legend, Filler)

const props = withDefaults(defineProps<{
  series: Array<{ name: string; values: number[]; color: string; axis?: 'left' | 'right' }>
  labels: string[]
  yUnit?: string
  rightYUnit?: string
}>(), {yUnit: ''})

function resolveColor(value: string): string {
    const match = value.match(/^var\((--[^)]+)\)$/)
    return match ? getComputedStyle(document.documentElement).getPropertyValue(match[1]).trim() : value
}

const data = computed(() => ({
    labels: props.labels,
    datasets: props.series.map(item => {
        const color = resolveColor(item.color)
        return {
            label: item.name,
            data: item.values,
            borderColor: color,
            backgroundColor: color,
            pointRadius: 2,
            pointHoverRadius: 4,
            borderWidth: 2,
            tension: .28,
            fill: false,
            yAxisID: item.axis === 'right' ? 'yRight' : 'y'
        }
    })
}))

const options = computed(() => ({
    responsive: true,
    maintainAspectRatio: false,
    interaction: {mode: 'index' as const, intersect: false},
    plugins: {
        legend: {position: 'bottom' as const, labels: {color: resolveColor('var(--muted)'), usePointStyle: true, boxWidth: 8, padding: 14}},
        tooltip: {callbacks: {label: (context: {dataset: {label?: string}; parsed: {y: number | null}}) => `${context.dataset.label || ''}: ${context.parsed.y ?? '–'} ${props.yUnit}`}}
    },
    scales: {
        x: {grid: {display: false}, ticks: {color: resolveColor('var(--muted)'), maxTicksLimit: 4, maxRotation: 0, autoSkip: true}},
        y: {beginAtZero: false, grid: {color: 'rgba(255,255,255,.08)'}, ticks: {color: resolveColor('var(--muted)'), maxTicksLimit: 4, callback: (value: string | number) => `${value} ${props.yUnit}`}},
        ...(props.rightYUnit ? {yRight: {position: 'right' as const, beginAtZero: false, grid: {drawOnChartArea: false}, ticks: {color: resolveColor('var(--muted)'), maxTicksLimit: 4, callback: (value: string | number) => `${value} ${props.rightYUnit}`}}} : {})
    }
}))
</script>
<template>
  <div class="mini-chart"><div class="mini-chart-canvas"><Line :data="data" :options="options"/></div></div>
</template>
