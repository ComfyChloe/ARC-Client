import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useElectronAPI } from './useElectronAPI'
export interface HRDataPoint {
  time: number
  value: number
}
export interface HRStats {
  min: number | null
  max: number | null
  avg: number | null
  count: number
  firstAt: number | null
  lastAt: number | null
}
export interface TimeRange {
  fromMs: number
  toMs: number
}
const RANGE_PRESETS: Record<string, TimeRange> = {
  '60s': { fromMs: 60_000, toMs: 0 },
  '5m': { fromMs: 5 * 60_000, toMs: 0 },
  '15m': { fromMs: 15 * 60_000, toMs: 0 },
  '1h': { fromMs: 60 * 60_000, toMs: 0 },
  '6h': { fromMs: 6 * 60 * 60_000, toMs: 0 },
  '24h': { fromMs: 24 * 60 * 60_000, toMs: 0 },
  '7d': { fromMs: 7 * 24 * 60 * 60_000, toMs: 0 },
  '30d': { fromMs: 30 * 24 * 60 * 60_000, toMs: 0 }
}
const STEP_MS: Record<string, number> = {
  'Raw': 0,
  '2s': 2_000,
  '4s': 4_000,
  '6s': 6_000,
  '8s': 8_000,
  '10s': 10_000,
  '20s': 20_000,
  '30s': 30_000
}
const STEP_OPTIONS = ['Auto', 'Raw', '2s', '4s', '6s', '8s', '10s', '20s', '30s']
const AUTO_TARGET_POINTS = 500
const MAX_QUERY_POINTS = 2000
const MIN_RANGE_MS = 5_000
const MAX_RANGE_MS = 30 * 24 * 60 * 60 * 1000
export function useHeartRateChart() {
  const api = useElectronAPI()
  const chartData = ref<HRDataPoint[]>([])
  const stats = ref<HRStats>({ min: null, max: null, avg: null, count: 0, firstAt: null, lastAt: null })
  const isLive = ref(true)
  const selectedRange = ref('60s')
  const selectedStep = ref('Auto')
  const customFrom = ref<number | null>(null)
  const customTo = ref<number | null>(null)
  const trackerId = ref<string>('')
  const loading = ref(false)
  const retentionDays = ref(7)
  const captureRate = ref(2000)
  const isCustomRange = ref(false)
  const customFromInput = ref('')
  const customToInput = ref('')
  let pollTimer: ReturnType<typeof setInterval> | null = null
  let liveTimer: ReturnType<typeof setInterval> | null = null
  let fetchDebounceTimer: ReturnType<typeof setTimeout> | null = null
  let fetchSeq = 0
  const timeRange = computed<TimeRange>(() => {
    if (customFrom.value !== null && customTo.value !== null) {
      return { fromMs: customFrom.value, toMs: customTo.value }
    }
    const preset = RANGE_PRESETS[selectedRange.value] || RANGE_PRESETS['60s']
    const now = Date.now()
    return { fromMs: now - preset.fromMs, toMs: preset.toMs === 0 ? now : now + preset.toMs }
  })
  function computeMaxPoints(): number | undefined {
    if (selectedStep.value === 'Auto') {
      const range = timeRange.value
      const rangeMs = range.toMs - range.fromMs
      return Math.min(AUTO_TARGET_POINTS, Math.max(30, Math.ceil(rangeMs / 2000)))
    }
    if (selectedStep.value === 'Raw') return undefined
    const stepMs = STEP_MS[selectedStep.value]
    const range = timeRange.value
    const rangeMs = range.toMs - range.fromMs
    return Math.min(MAX_QUERY_POINTS, Math.max(1, Math.ceil(rangeMs / stepMs)))
  }
  async function fetchDataImmediate() {
    if (!trackerId.value) return
    const range = timeRange.value
    const seq = ++fetchSeq
    loading.value = true
    try {
      const maxPoints = computeMaxPoints()
      const result = await api.hyperateGetHistory(trackerId.value, range.fromMs, range.toMs, maxPoints)
      if (seq !== fetchSeq) return
      chartData.value = result?.readings ?? []
      const st = await api.hyperateGetStats(trackerId.value, range.fromMs, range.toMs)
      if (seq !== fetchSeq) return
      stats.value = st ?? stats.value
    } catch {}
    if (seq === fetchSeq) loading.value = false
  }
  function fetchData() {
    if (fetchDebounceTimer) clearTimeout(fetchDebounceTimer)
    fetchDebounceTimer = setTimeout(fetchDataImmediate, 150)
  }
  function fetchDataNow() {
    if (fetchDebounceTimer) { clearTimeout(fetchDebounceTimer); fetchDebounceTimer = null }
    void fetchDataImmediate()
  }
  async function fetchHistoryConfig() {
    try {
      const cfg = await api.hyperateGetHistoryConfig()
      retentionDays.value = cfg?.retentionDays ?? 7
    } catch {}
  }
  async function setRetention(days: number) {
    retentionDays.value = days
    await api.hyperateSetHistoryConfig({ retentionDays: days })
  }
  async function fetchCaptureRate() {
    try {
      const cfg = await api.hyperateGetCaptureRate()
      captureRate.value = cfg?.rateMs ?? 2000
    } catch {}
  }
  async function setCaptureRate(ms: number) {
    captureRate.value = ms
    await api.hyperateSetCaptureRate({ rateMs: ms })
  }
  function toDatetimeLocal(ms: number): string {
    const d = new Date(ms)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  }
  function fromDatetimeLocal(str: string): number {
    return new Date(str).getTime()
  }
  function activateCustomRange() {
    isCustomRange.value = true
    selectedRange.value = ''
    const now = Date.now()
    customFromInput.value = toDatetimeLocal(now - 60 * 60_000)
    customToInput.value = toDatetimeLocal(now)
    if (isLive.value) isLive.value = false
  }
  function applyCustomRange() {
    if (!customFromInput.value || !customToInput.value) return
    const fromMs = fromDatetimeLocal(customFromInput.value)
    const toMs = fromDatetimeLocal(customToInput.value)
    if (isNaN(fromMs) || isNaN(toMs) || fromMs >= toMs) return
    isCustomRange.value = true
    selectedRange.value = ''
    isLive.value = false
    customFrom.value = fromMs
    customTo.value = toMs
    void fetchData()
  }
  function setNow() {
    customToInput.value = toDatetimeLocal(Date.now())
    applyCustomRange()
  }
  function setRange(preset: string) {
    selectedRange.value = preset
    isCustomRange.value = false
    customFrom.value = null
    customTo.value = null
    isLive.value = false
    fetchDataNow()
  }
  function setCustomRange(fromMs: number, toMs: number) {
    customFrom.value = fromMs
    customTo.value = toMs
    isLive.value = false
    fetchData()
  }
  function goLive() {
    isLive.value = true
    isCustomRange.value = false
    selectedRange.value = '60s'
    selectedStep.value = 'Auto'
    customFrom.value = null
    customTo.value = null
    fetchDataNow()
  }
  function setStep(step: string) {
    selectedStep.value = step
    fetchDataNow()
  }
  function onPanOffset(offsetMs: number) {
    if (isLive.value) return
    const range = timeRange.value
    setCustomRange(range.fromMs + offsetMs, range.toMs + offsetMs)
  }
  function onZoom(factor: number, centerTimeMs: number) {
    if (isLive.value) return
    const range = timeRange.value
    const rangeMs = range.toMs - range.fromMs
    if (rangeMs <= 0) return
    const clampedCenter = Math.max(range.fromMs, Math.min(range.toMs, centerTimeMs))
    let newRangeMs = rangeMs * factor
    if (newRangeMs < MIN_RANGE_MS) newRangeMs = MIN_RANGE_MS
    if (newRangeMs > MAX_RANGE_MS) newRangeMs = MAX_RANGE_MS
    if (newRangeMs === rangeMs) return
    const ratio = (clampedCenter - range.fromMs) / rangeMs
    let newFrom = clampedCenter - newRangeMs * ratio
    let newTo = clampedCenter + newRangeMs * (1 - ratio)
    if (newTo - newFrom < MIN_RANGE_MS) {
      const mid = (newFrom + newTo) / 2
      newFrom = mid - MIN_RANGE_MS / 2
      newTo = mid + MIN_RANGE_MS / 2
    }
    setCustomRange(newFrom, newTo)
  }
  function startPolling() {
    stopPolling()
    pollTimer = setInterval(() => {
      if (!isLive.value) void fetchData()
    }, 5000)
  }
  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
    if (fetchDebounceTimer) {
      clearTimeout(fetchDebounceTimer)
      fetchDebounceTimer = null
    }
  }
  function startLiveTimer() {
    stopLiveTimer()
    liveTimer = setInterval(() => {
      if (isLive.value) void fetchData()
    }, 2000)
  }
  function stopLiveTimer() {
    if (liveTimer) {
      clearInterval(liveTimer)
      liveTimer = null
    }
  }
  watch(isLive, (live) => {
    if (live) {
      startLiveTimer()
    } else {
      stopLiveTimer()
    }
  })
  onMounted(() => {
    void fetchHistoryConfig()
    void fetchCaptureRate()
    fetchDataNow()
    startLiveTimer()
    startPolling()
  })
  onUnmounted(() => {
    stopPolling()
    stopLiveTimer()
  })
  return {
    chartData,
    stats,
    isLive,
    selectedRange,
    selectedStep,
    isCustomRange,
    customFromInput,
    customToInput,
    customFrom,
    customTo,
    trackerId,
    loading,
    retentionDays,
    timeRange,
    fetchData,
    fetchDataNow,
    setRange,
    setCustomRange,
    activateCustomRange,
    applyCustomRange,
    setNow,
    goLive,
    setStep,
    onPanOffset,
    onZoom,
    setRetention,
    captureRate,
    setCaptureRate,
    RANGE_PRESETS,
    STEP_OPTIONS,
    toDatetimeLocal
  }
}
