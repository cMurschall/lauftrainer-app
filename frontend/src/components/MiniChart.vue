<script lang="ts" setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  BarController,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
  type ChartOptions,
  type Plugin,
} from 'chart.js'
import { Chart } from 'vue-chartjs'

// The controllers must be registered explicitly: the dev server pulls them in via
// `chart.js/auto`, but a production build tree-shakes anything not imported here.
ChartJS.register(
  CategoryScale,
  LinearScale,
  LineController,
  BarController,
  PointElement,
  LineElement,
  BarElement,
  Tooltip,
  Legend,
  Filler,
)

// Touch devices never fire a `mouseout` on the canvas, so a tooltip opened by a tap
// stays visible forever. One shared listener closes every chart that was not tapped.
type TooltipOwner = { canvas: () => HTMLCanvasElement | null; dismiss: () => void }
const tooltipOwners = new Set<TooltipOwner>()

function dismissOtherTooltips(event: Event) {
  const target = event.target as Node | null
  for (const owner of tooltipOwners) {
    const canvas = owner.canvas()
    if (canvas && target && (canvas === target || canvas.contains(target))) continue
    owner.dismiss()
  }
}

function registerTooltipOwner(owner: TooltipOwner) {
  if (!tooltipOwners.size) {
    document.addEventListener('pointerdown', dismissOtherTooltips, true)
  }
  tooltipOwners.add(owner)
}

function unregisterTooltipOwner(owner: TooltipOwner) {
  tooltipOwners.delete(owner)
  if (!tooltipOwners.size) {
    document.removeEventListener('pointerdown', dismissOtherTooltips, true)
  }
}

export type MiniChartSeries = {
  name: string
  values: Array<number | null>
  color: string
  axis?: 'left' | 'right'
  pointRadius?: number
  borderWidth?: number
  type?: 'line' | 'bar'
  fill?: boolean | number
  borderDash?: number[]
  showLine?: boolean
}

export type MiniChartReferenceLine = {
  y: number
  color?: string
  axis?: 'left' | 'right'
  dash?: number[]
}

export type MiniChartBand = {
  yMin: number
  yMax: number
  color: string
  axis?: 'left' | 'right'
}

const props = withDefaults(
  defineProps<{
    series: MiniChartSeries[]
    labels: string[]
    /** Absolute dates (or richer titles) for tooltips when `labels` are relative. */
    tooltipLabels?: string[]
    yUnit?: string
    rightYUnit?: string
    type?: 'line' | 'bar'
    stacked?: boolean
    dynamicY?: boolean
    includeZero?: boolean
    maxTicksLimit?: number
    referenceLines?: MiniChartReferenceLine[]
    bands?: MiniChartBand[]
  }>(),
  {
    tooltipLabels: () => [],
    yUnit: '',
    type: 'line',
    stacked: false,
    dynamicY: false,
    includeZero: false,
    maxTicksLimit: 6,
    referenceLines: () => [],
    bands: () => [],
  },
)

const rootEl = ref<HTMLElement | null>(null)

function currentCanvas(): HTMLCanvasElement | null {
  return rootEl.value?.querySelector('canvas') ?? null
}

const tooltipOwner: TooltipOwner = {
  canvas: currentCanvas,
  dismiss: () => {
    const canvas = currentCanvas()
    const chart = canvas ? ChartJS.getChart(canvas) : undefined
    if (!chart) return
    const tooltip = chart.tooltip
    if (!chart.getActiveElements().length && !tooltip?.getActiveElements().length) return
    chart.setActiveElements([])
    tooltip?.setActiveElements([], { x: 0, y: 0 })
    chart.update('none')
  },
}

onMounted(() => registerTooltipOwner(tooltipOwner))
onBeforeUnmount(() => unregisterTooltipOwner(tooltipOwner))

function resolveColor(value: string): string {
  const match = value.match(/^var\((--[^)]+)\)$/)
  if (!match) return value
  return getComputedStyle(document.documentElement).getPropertyValue(match[1]).trim() || value
}

function formatChartValue(value: number | null, unit = props.yUnit): string {
  if (value === null || !Number.isFinite(value)) return '–'
  const digits = unit === 'efficiency' || unit === 'idx' ? 3 : unit === '%' || unit === 'acwr' ? 2 : 1
  return Number(value.toFixed(digits)).toString()
}

const hasRightAxis = computed(
  () => Boolean(props.rightYUnit) || props.series.some((item) => item.axis === 'right'),
)

const isMixed = computed(() => props.series.some((item) => (item.type || props.type) !== props.type))

const chartValues = computed(() =>
  props.series.flatMap((item) => item.values).filter((value): value is number => value !== null && Number.isFinite(value)),
)
const chartMax = computed(() => (chartValues.value.length ? Math.max(...chartValues.value) : 0))
const chartMin = computed(() => (chartValues.value.length ? Math.min(...chartValues.value) : 0))
const chartPadding = computed(() => Math.max((chartMax.value - chartMin.value) * 0.1, 0.001))

const yMin = computed(() => {
  if (!props.dynamicY) return 0
  let min = chartMin.value - chartPadding.value
  if (props.includeZero) min = Math.min(min, 0)
  return min
})
const yMax = computed(() => {
  if (!props.dynamicY) return props.yUnit === '%' ? 100 : undefined
  let max = chartMax.value + chartPadding.value
  if (props.includeZero) max = Math.max(max, 0)
  return max
})

const overlaysPlugin = computed<Plugin>(() => ({
  id: 'miniChartOverlays',
  beforeDraw(chart) {
    const { ctx, chartArea } = chart
    if (!chartArea) return
    for (const band of props.bands) {
      const scale = chart.scales[band.axis === 'right' ? 'yRight' : 'y']
      if (!scale) continue
      const top = Math.min(Math.max(scale.getPixelForValue(band.yMax), chartArea.top), chartArea.bottom)
      const bottom = Math.min(Math.max(scale.getPixelForValue(band.yMin), chartArea.top), chartArea.bottom)
      if (Math.abs(bottom - top) < 0.5) continue
      ctx.save()
      ctx.fillStyle = resolveColor(band.color)
      ctx.fillRect(chartArea.left, Math.min(top, bottom), chartArea.right - chartArea.left, Math.abs(bottom - top))
      ctx.restore()
    }
    for (const line of props.referenceLines) {
      const scale = chart.scales[line.axis === 'right' ? 'yRight' : 'y']
      if (!scale) continue
      const y = scale.getPixelForValue(line.y)
      if (y < chartArea.top || y > chartArea.bottom) continue
      ctx.save()
      ctx.strokeStyle = resolveColor(line.color || 'var(--muted)')
      ctx.lineWidth = 1
      ctx.setLineDash(line.dash || [4, 4])
      ctx.beginPath()
      ctx.moveTo(chartArea.left, y)
      ctx.lineTo(chartArea.right, y)
      ctx.stroke()
      ctx.restore()
    }
  },
}))

const data = computed(() => ({
  labels: props.labels,
  datasets: props.series.map((item) => {
    const color = resolveColor(item.color)
    const seriesType = item.type || props.type
    const isBar = seriesType === 'bar'
    return {
      type: seriesType,
      label: item.name,
      data: item.values,
      borderColor: color,
      backgroundColor: isBar
        ? color
        : item.fill
          ? typeof item.fill === 'number'
            ? color
            : color
          : color,
      pointRadius: item.pointRadius ?? (isBar ? 0 : 0),
      pointHoverRadius: 4,
      borderWidth: isBar ? 0 : (item.borderWidth ?? 2),
      borderDash: item.borderDash,
      borderRadius: isBar ? 2 : undefined,
      tension: 0.28,
      fill: item.fill ?? false,
      showLine: item.showLine ?? true,
      yAxisID: item.axis === 'right' ? 'yRight' : 'y',
      order: isBar ? 2 : 1,
    }
  }),
}))

const options = computed<ChartOptions>(() => ({
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: 'index', intersect: false },
  plugins: {
    legend: {
      position: 'bottom',
      labels: { color: resolveColor('var(--muted)'), usePointStyle: true, boxWidth: 8, padding: 14 },
    },
    tooltip: {
      callbacks: {
        title: (items) => {
          const index = items[0]?.dataIndex
          if (index != null && props.tooltipLabels[index]) return props.tooltipLabels[index]
          return items[0]?.label ?? ''
        },
        label: (context) => {
          const axisId = (context.dataset as { yAxisID?: string }).yAxisID
          const unit = axisId === 'yRight' ? props.rightYUnit || props.yUnit : props.yUnit
          return `${context.dataset.label || ''}: ${formatChartValue(context.parsed.y, unit)} ${unit || ''}`.trim()
        },
      },
    },
  },
  layout: { padding: { top: 8, right: 4, bottom: 2, left: 2 } },
  scales: {
    x: {
      stacked: props.stacked,
      grid: { display: false },
      ticks: {
        color: resolveColor('var(--muted)'),
        maxTicksLimit: props.maxTicksLimit,
        maxRotation: 0,
        autoSkip: true,
      },
    },
    y: {
      stacked: props.stacked,
      beginAtZero: !props.dynamicY,
      min: props.dynamicY ? yMin.value : 0,
      max: props.dynamicY ? yMax.value : props.yUnit === '%' ? 100 : undefined,
      ...(props.stacked && props.yUnit === '%' ? { grace: '5%' } : {}),
      grid: { color: resolveColor('var(--border)') },
      ticks: {
        color: resolveColor('var(--muted)'),
        maxTicksLimit: props.maxTicksLimit,
        callback: (value) =>
          `${formatChartValue(typeof value === 'number' ? value : Number(value))} ${props.yUnit}`.trim(),
      },
    },
    ...(hasRightAxis.value
      ? {
          yRight: {
            position: 'right' as const,
            beginAtZero: true,
            grid: { drawOnChartArea: false },
            ticks: {
              color: resolveColor('var(--muted)'),
              maxTicksLimit: props.maxTicksLimit,
              callback: (value: string | number) =>
                `${formatChartValue(typeof value === 'number' ? value : Number(value), props.rightYUnit)} ${
                  props.rightYUnit || ''
                }`.trim(),
            },
          },
        }
      : {}),
  },
}))
</script>
<template>
  <div ref="rootEl" class="mini-chart">
    <div class="mini-chart-canvas">
      <Chart
        :type="type"
        :data="data"
        :options="options"
        :plugins="[overlaysPlugin]"
        :key="`${type}-${isMixed}-${hasRightAxis}-${labels.length}`"
      />
    </div>
  </div>
</template>
