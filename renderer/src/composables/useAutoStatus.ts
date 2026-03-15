import { ref, onMounted } from 'vue'
import { useElectronAPI } from './useElectronAPI'

export interface StatusType {
  value: string | null
  label: string
  color: string
  icon: string
}

export const STATUS_TYPES: StatusType[] = [
  { value: null, label: 'None (message only)', color: '#888888', icon: '\u26AB' },
  { value: 'join me', label: 'Join Me', color: '#3498db', icon: '\uD83D\uDD35' },
  { value: 'active', label: 'Online', color: '#2ecc71', icon: '\uD83D\uDFE2' },
  { value: 'ask me', label: 'Ask Me', color: '#f39c12', icon: '\uD83D\uDFE0' },
  { value: 'busy', label: 'Do Not Disturb', color: '#e74c3c', icon: '\uD83D\uDD34' }
]

export const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export interface Preset {
  id: number
  name: string
  statusType: string | null
  statusMessage: string
}

export interface ScheduleEntry {
  id: string
  name: string
  daysOfWeek: number[]
  startTime: string
  endTime: string
  presetId: number
  enabled: boolean
  fallbackStatusType: string | null
}

export interface AutoStatusSettings {
  cooldownSeconds: number
  timeFormat: string
  alwaysAllowOverride: boolean
  [key: string]: any
}

export interface AutoStatusStatus {
  lastAppliedPresetId: number | null
  externallySet: boolean
  avatarGuardActive: boolean
  vrchatApiAvailable: boolean
  lastOscValue: number
  [key: string]: any
}

export function useAutoStatus() {
  const api = useElectronAPI()
  const presets = ref<Preset[]>([])
  const schedule = ref<ScheduleEntry[]>([])
  const settings = ref<AutoStatusSettings>({ cooldownSeconds: 10, timeFormat: '24h', alwaysAllowOverride: false })
  const status = ref<AutoStatusStatus>({ lastAppliedPresetId: null, externallySet: false, avatarGuardActive: false, vrchatApiAvailable: false, lastOscValue: 0 })

  async function refresh() {
    const [config, s] = await Promise.all([
      api.autoStatusGetConfig(),
      api.autoStatusGetStatus()
    ])
    presets.value = config.presets ?? []
    schedule.value = config.schedule ?? []
    settings.value = { cooldownSeconds: 10, timeFormat: '24h', alwaysAllowOverride: false, ...config.settings }
    status.value = { lastAppliedPresetId: null, externallySet: false, avatarGuardActive: false, vrchatApiAvailable: false, lastOscValue: 0, ...s }
  }
  async function createPreset() {
    const usedIds = presets.value.map(p => p.id)
    let nextId: number | null = null
    for (let i = 1; i <= 8; i++) {
      if (!usedIds.includes(i)) { nextId = i; break }
    }
    if (nextId === null) return
    await api.autoStatusSetPreset({ id: nextId, name: `Preset ${nextId}`, statusType: 'active', statusMessage: '' })
    await refresh()
  }
  async function updatePreset(preset: Preset) {
    await api.autoStatusSetPreset(preset)
    await refresh()
  }
  async function deletePreset(id: number) {
    await api.autoStatusDeletePreset(String(id))
    await refresh()
  }
  async function testPreset(id: number) {
    const result = await api.autoStatusTestPreset(String(id))
    return result
  }
  async function addSchedule(entry: { daysOfWeek: number[]; startTime: string; endTime: string; presetId: number; name: string; fallbackStatusType: string | null }) {
    const result = await api.autoStatusAddSchedule(entry)
    await refresh()
    return result
  }
  async function updateSchedule(entryId: string, updates: Partial<ScheduleEntry>) {
    await api.autoStatusUpdateSchedule(entryId, updates)
    await refresh()
  }
  async function deleteSchedule(entryId: string) {
    await api.autoStatusDeleteSchedule(entryId)
    await refresh()
  }
  async function updateSettings(updates: Partial<AutoStatusSettings>) {
    await api.autoStatusUpdateSettings(updates)
    settings.value = { ...settings.value, ...updates }
  }

  onMounted(() => {
    refresh()
    api.onAutoStatusUpdate((data: any) => {
      status.value = { ...status.value, ...data }
    })
  })

  return {
    presets,
    schedule,
    settings,
    status,
    refresh,
    createPreset,
    updatePreset,
    deletePreset,
    testPreset,
    addSchedule,
    updateSchedule,
    deleteSchedule,
    updateSettings
  }
}
