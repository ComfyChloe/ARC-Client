<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, computed } from 'vue'
import type { HRDataPoint } from '../composables/useHeartRateChart'
const props = defineProps<{
  data: HRDataPoint[]
  isLive: boolean
  minBpm: number | null
  maxBpm: number | null
  avgBpm: number | null
}>()
const emit = defineEmits<{
  pan: [offsetMs: number]
  zoom: [factor: number, centerTimeMs: number]
}>()
const canvasRef = ref<HTMLCanvasElement | null>(null)
const containerRef = ref<HTMLDivElement | null>(null)
let ctx: CanvasRenderingContext2D | null = null
let animFrame: number | null = null
let dpr = 1
let canvasW = 0
let canvasH = 0
const PADDING = { top: 16, right: 16, bottom: 36, left: 52 }
const crosshair = ref<{ x: number; y: number; time: number; value: number } | null>(null)
const isDragging = ref(false)
let dragStartX = 0
let dragLastX = 0
const isDark = ref(false)
let themeObserver: MutationObserver | null = null
function getPlotRect() {
  return {
    x: PADDING.left,
    y: PADDING.top,
    w: canvasW - PADDING.left - PADDING.right,
    h: canvasH - PADDING.top - PADDING.bottom
  }
}
function getLineColor() { return '#e74c3c' }
function getGridColor() { return isDark.value ? '#2c3e50' : '#e8e8e8' }
function getTextColor() { return isDark.value ? '#95a5a6' : '#888' }
function getBgColor() { return isDark.value ? '#1a1a2e' : '#ffffff' }
function getCrosshairColor() { return isDark.value ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.12)' }
function getTimeRange() {
  const d = props.data
  if (d.length === 0) return { minT: 0, maxT: 1 }
  const minT = d[0].time
  const maxT = d[d.length - 1].time
  const range = maxT - minT
  if (range < 5000) return { minT: minT - 2500, maxT: maxT + 2500 }
  return { minT, maxT }
}
function getValueRange() {
  const d = props.data
  if (d.length === 0) return { minV: 40, maxV: 200 }
  let mn = Infinity, mx = -Infinity
  for (const p of d) {
    if (p.value < mn) mn = p.value
    if (p.value > mx) mx = p.value
  }
  const pad = Math.max(5, (mx - mn) * 0.12)
  return { minV: Math.max(0, mn - pad), maxV: mx + pad }
}
function timeToX(t: number): number {
  const { minT, maxT } = getTimeRange()
  const plot = getPlotRect()
  if (maxT === minT) return plot.x + plot.w / 2
  return plot.x + ((t - minT) / (maxT - minT)) * plot.w
}
function xToTime(x: number): number {
  const { minT, maxT } = getTimeRange()
  const plot = getPlotRect()
  return minT + ((x - plot.x) / plot.w) * (maxT - minT)
}
function valueToY(v: number): number {
  const { minV, maxV } = getValueRange()
  const plot = getPlotRect()
  if (maxV === minV) return plot.y + plot.h / 2
  return plot.y + plot.h - ((v - minV) / (maxV - minV)) * plot.h
}
function draw() {
  if (!ctx) return
  ctx.clearRect(0, 0, canvasW, canvasH)
  ctx.fillStyle = getBgColor()
  ctx.fillRect(0, 0, canvasW, canvasH)
  const plot = getPlotRect()
  const data = props.data
  if (data.length === 0) {
    ctx.fillStyle = getTextColor()
    ctx.font = '14px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('No data — start HypeRate to see live heart rate', canvasW / 2, canvasH / 2)
    return
  }
  const { minT, maxT } = getTimeRange()
  const { minV, maxV } = getValueRange()
  drawGrid(plot, minT, maxT, minV, maxV)
  drawLine(data, plot)
  drawCrosshair(plot)
  drawYLabels(plot, minV, maxV)
  drawXLabels(plot, minT, maxT)
  drawStatsOverlay()
}
function drawGrid(plot: { x: number; y: number; w: number; h: number }, minT: number, maxT: number, minV: number, maxV: number) {
  if (!ctx) return
  ctx.strokeStyle = getGridColor()
  ctx.lineWidth = 1
  const ySteps = niceSteps(minV, maxV, 5)
  for (const v of ySteps) {
    const y = Math.round(valueToY(v)) + 0.5
    if (y < plot.y || y > plot.y + plot.h) continue
    ctx.beginPath()
    ctx.moveTo(plot.x, y)
    ctx.lineTo(plot.x + plot.w, y)
    ctx.stroke()
  }
  const rangeMs = maxT - minT
  const xStepMs = niceTimeStep(rangeMs)
  const startT = Math.ceil(minT / xStepMs) * xStepMs
  for (let t = startT; t <= maxT; t += xStepMs) {
    const x = Math.round(timeToX(t)) + 0.5
    if (x < plot.x || x > plot.x + plot.w) continue
    ctx.beginPath()
    ctx.moveTo(x, plot.y)
    ctx.lineTo(x, plot.y + plot.h)
    ctx.stroke()
  }
}
function drawLine(data: HRDataPoint[], plot: { x: number; y: number; w: number; h: number }) {
  if (!ctx || data.length === 0) return
  const len = data.length
  const maxRender = 800
  const stride = len > maxRender ? Math.ceil(len / maxRender) : 1
  ctx.strokeStyle = getLineColor()
  ctx.lineWidth = 2
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.beginPath()
  let started = false
  for (let i = 0; i < len; i += stride) {
    const x = timeToX(data[i].time)
    const y = valueToY(data[i].value)
    if (x < plot.x - 2 || x > plot.x + plot.w + 2) {
      if (started) {
        ctx.stroke()
        ctx.beginPath()
        started = false
      }
      continue
    }
    if (!started) {
      ctx.moveTo(x, y)
      started = true
    } else {
      const ni = i + stride < len ? i + stride : len - 1
      if (ni !== i) {
        const nx = timeToX(data[ni].time)
        const ny = valueToY(data[ni].value)
        ctx.quadraticCurveTo(x, y, (x + nx) / 2, (y + ny) / 2)
      } else {
        ctx.lineTo(x, y)
      }
    }
  }
  if (started) ctx.stroke()
}
function drawCrosshair(plot: { x: number; y: number; w: number; h: number }) {
  if (!ctx || !crosshair.value) return
  const ch = crosshair.value
  if (ch.x < plot.x || ch.x > plot.x + plot.w) return
  if (ch.y < plot.y || ch.y > plot.y + plot.h) return
  ctx.strokeStyle = getCrosshairColor()
  ctx.lineWidth = 1
  ctx.setLineDash([4, 4])
  ctx.beginPath()
  ctx.moveTo(ch.x, plot.y)
  ctx.lineTo(ch.x, plot.y + plot.h)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(plot.x, ch.y)
  ctx.lineTo(plot.x + plot.w, ch.y)
  ctx.stroke()
  ctx.setLineDash([])
  const timeStr = formatTime(ch.time)
  const valStr = `${ch.value} bpm`
  ctx.font = '11px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif'
  const tw = ctx.measureText(timeStr).width + 12
  const th = 20
  let tx = ch.x + 10
  if (tx + tw > plot.x + plot.w) tx = ch.x - tw - 10
  let ty = ch.y - th - 6
  if (ty < plot.y) ty = ch.y + 6
  ctx.fillStyle = isDark.value ? '#2c3e50' : '#f8f9fa'
  ctx.strokeStyle = isDark.value ? '#454545' : '#ddd'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.roundRect(tx, ty, tw, th, 4)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = getTextColor()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(timeStr, tx + tw / 2, ty + th / 2)
  ctx.fillStyle = '#e74c3c'
  const vw = ctx.measureText(valStr).width + 12
  let vx = ch.x + 10
  if (vx + vw > plot.x + plot.w) vx = ch.x - vw - 10
  let vy = ty - th - 4
  if (vy < plot.y) vy = ch.y + th + 6
  ctx.fillStyle = isDark.value ? '#2c3e50' : '#f8f9fa'
  ctx.strokeStyle = isDark.value ? '#454545' : '#ddd'
  ctx.beginPath()
  ctx.roundRect(vx, vy, vw, th, 4)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = '#e74c3c'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(valStr, vx + vw / 2, vy + th / 2)
  ctx.fillStyle = getLineColor()
  ctx.beginPath()
  ctx.arc(ch.x, ch.y, 4, 0, Math.PI * 2)
  ctx.fill()
}
function drawYLabels(plot: { x: number; y: number; w: number; h: number }, minV: number, maxV: number) {
  if (!ctx) return
  ctx.fillStyle = getTextColor()
  ctx.font = '10px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif'
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  const steps = niceSteps(minV, maxV, 5)
  for (const v of steps) {
    const y = valueToY(v)
    if (y < plot.y || y > plot.y + plot.h) continue
    ctx.fillText(String(Math.round(v)), plot.x - 6, y)
  }
}
function drawXLabels(plot: { x: number; y: number; w: number; h: number }, minT: number, maxT: number) {
  if (!ctx) return
  ctx.fillStyle = getTextColor()
  ctx.font = '10px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  const rangeMs = maxT - minT
  const stepMs = niceTimeStep(rangeMs)
  const startT = Math.ceil(minT / stepMs) * stepMs
  for (let t = startT; t <= maxT; t += stepMs) {
    const x = timeToX(t)
    if (x < plot.x || x > plot.x + plot.w) continue
    ctx.fillText(formatTimeShort(t, rangeMs), x, plot.y + plot.h + 6)
  }
}
function drawStatsOverlay() {
  if (!ctx) return
  const { minBpm, maxBpm, avgBpm } = props
  if (minBpm === null && maxBpm === null && avgBpm === null) return
  ctx.font = '11px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  const items: Array<{ label: string; value: string; color: string }> = []
  if (props.data.length > 0) {
    items.push({ label: 'NOW', value: `${props.data[props.data.length - 1].value}`, color: '#e74c3c' })
  }
  if (minBpm !== null) items.push({ label: 'MIN', value: String(minBpm), color: '#2ecc71' })
  if (avgBpm !== null) items.push({ label: 'AVG', value: String(avgBpm), color: '#f39c12' })
  if (maxBpm !== null) items.push({ label: 'MAX', value: String(maxBpm), color: '#3498db' })
  let ox = PADDING.left + 8
  const oy = PADDING.top + 8
  for (const item of items) {
    ctx.fillStyle = getTextColor()
    ctx.fillText(`${item.label}: `, ox, oy)
    ox += ctx.measureText(`${item.label}: `).width
    ctx.fillStyle = item.color
    ctx.fillText(item.value, ox, oy)
    ox += ctx.measureText(item.value).width + 14
  }
}
function niceSteps(min: number, max: number, maxCount: number): number[] {
  if (max <= min) return [min]
  const range = max - min
  const rawStep = range / maxCount
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)))
  const norm = rawStep / mag
  let step: number
  if (norm < 1.5) step = 1 * mag
  else if (norm < 3.5) step = 2 * mag
  else if (norm < 7.5) step = 5 * mag
  else step = 10 * mag
  const steps: number[] = []
  const start = Math.ceil(min / step) * step
  for (let v = start; v <= max; v += step) {
    steps.push(Math.round(v * 100) / 100)
  }
  return steps
}
function niceTimeStep(rangeMs: number): number {
  if (rangeMs < 30_000) return 5_000
  if (rangeMs < 2 * 60_000) return 15_000
  if (rangeMs < 10 * 60_000) return 60_000
  if (rangeMs < 60 * 60_000) return 5 * 60_000
  if (rangeMs < 4 * 60 * 60_000) return 30 * 60_000
  if (rangeMs < 24 * 60 * 60_000) return 60 * 60_000
  if (rangeMs < 3 * 24 * 60 * 60_000) return 6 * 60 * 60_000
  return 24 * 60 * 60_000
}
function formatTime(ms: number): string {
  const d = new Date(ms)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}
function formatTimeShort(ms: number, rangeMs: number): string {
  const d = new Date(ms)
  if (rangeMs < 60 * 60_000) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  if (rangeMs < 24 * 60 * 60_000) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}
function resize() {
  const container = containerRef.value
  const canvas = canvasRef.value
  if (!container || !canvas) return
  const rect = container.getBoundingClientRect()
  dpr = window.devicePixelRatio || 1
  canvasW = rect.width
  canvasH = rect.height
  canvas.width = canvasW * dpr
  canvas.height = canvasH * dpr
  canvas.style.width = canvasW + 'px'
  canvas.style.height = canvasH + 'px'
  ctx = canvas.getContext('2d')
  if (ctx) ctx.scale(dpr, dpr)
  scheduleDraw()
}
let pendingDraw = false
function scheduleDraw() {
  if (pendingDraw) return
  pendingDraw = true
  animFrame = requestAnimationFrame(() => {
    animFrame = null
    pendingDraw = false
    draw()
  })
}
function handleMouseMove(e: MouseEvent) {
  const canvas = canvasRef.value
  if (!canvas) return
  const rect = canvas.getBoundingClientRect()
  const mx = e.clientX - rect.left
  const my = e.clientY - rect.top
  if (isDragging.value) {
    const dx = e.clientX - dragLastX
    dragLastX = e.clientX
    if (Math.abs(dx) > 1) {
      const plot = getPlotRect()
      const { minT, maxT } = getTimeRange()
      const rangeMs = maxT - minT
      const offsetMs = -(dx / plot.w) * rangeMs
      emit('pan', offsetMs)
    }
    return
  }
  const plot = getPlotRect()
  if (mx < plot.x || mx > plot.x + plot.w || my < plot.y || my > plot.y + plot.h) {
    crosshair.value = null
    scheduleDraw()
    return
  }
  const time = xToTime(mx)
  const data = props.data
  if (data.length === 0) { crosshair.value = null; return }
  let closest = data[0]
  let closestDist = Math.abs(data[0].time - time)
  for (let i = 1; i < data.length; i++) {
    const dist = Math.abs(data[i].time - time)
    if (dist < closestDist) {
      closest = data[i]
      closestDist = dist
    }
  }
  crosshair.value = { x: timeToX(closest.time), y: valueToY(closest.value), time: closest.time, value: closest.value }
  scheduleDraw()
}
function handleMouseDown(e: MouseEvent) {
  if (e.button !== 0) return
  isDragging.value = true
  dragStartX = e.clientX
  dragLastX = e.clientX
}
function handleMouseUp() {
  isDragging.value = false
}
function handleMouseLeave() {
  isDragging.value = false
  crosshair.value = null
  scheduleDraw()
}
function handleWheel(e: WheelEvent) {
  e.preventDefault()
  const canvas = canvasRef.value
  if (!canvas) return
  const rect = canvas.getBoundingClientRect()
  const mx = e.clientX - rect.left
  const centerTime = xToTime(mx)
  const factor = e.deltaY > 0 ? 1.2 : 0.833
  emit('zoom', factor, centerTime)
}
let resizeObserver: ResizeObserver | null = null
onMounted(() => {
  isDark.value = document.body.classList.contains('dark-theme')
  themeObserver = new MutationObserver(() => {
    isDark.value = document.body.classList.contains('dark-theme')
    scheduleDraw()
  })
  themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] })
  resizeObserver = new ResizeObserver(resize)
  if (containerRef.value) resizeObserver.observe(containerRef.value)
  resize()
})
onUnmounted(() => {
  themeObserver?.disconnect()
  resizeObserver?.disconnect()
  if (animFrame !== null) cancelAnimationFrame(animFrame)
})
watch(() => [props.data, props.isLive, props.minBpm, props.maxBpm, props.avgBpm], () => { scheduleDraw() }, { deep: false })
</script>
<template>
  <div ref="containerRef" class="hr-chart-container">
    <canvas
      ref="canvasRef"
      class="hr-chart-canvas"
      @mousemove="handleMouseMove"
      @mousedown="handleMouseDown"
      @mouseup="handleMouseUp"
      @mouseleave="handleMouseLeave"
      @wheel.prevent="handleWheel"
    />
    <div v-if="isLive" class="hr-live-badge">
      <span class="hr-live-dot" /> LIVE
    </div>
  </div>
</template>
<style scoped>
.hr-chart-container {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 200px;
  border-radius: 6px;
  overflow: hidden;
}
.hr-chart-canvas {
  display: block;
  width: 100%;
  height: 100%;
  cursor: crosshair;
}
.hr-live-badge {
  position: absolute;
  top: 8px;
  right: 8px;
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 3px 10px;
  border-radius: 10px;
  background: rgba(46, 204, 113, 0.15);
  border: 1px solid rgba(46, 204, 113, 0.3);
  color: #2ecc71;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.5px;
  pointer-events: none;
}
.hr-live-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #2ecc71;
  animation: hr-pulse 1.5s ease-in-out infinite;
}
@keyframes hr-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(0.7); }
}
:global(body.dark-theme) .hr-chart-container {
  background: #1a1a2e;
}
</style>
