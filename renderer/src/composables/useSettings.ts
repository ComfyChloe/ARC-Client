import { ref, onMounted, onUnmounted } from 'vue'
import { useElectronAPI } from './useElectronAPI'

type ServerType = 'live' | 'beta' | 'custom'

const SERVER_URLS: Record<ServerType, string> = {
  live: 'wss://arcosc.app:48255',
  beta: 'wss://beta.arcosc.app:48255',
  custom: 'wss://127.0.0.1:48255'
}

export function useSettings() {
  const api = useElectronAPI()
  const serverUrl = ref('wss://arcosc.app:48255')
  const activeServer = ref<ServerType>('live')
  const theme = ref<'light' | 'dark'>('light')
  const snowEnabled = ref(true)
  const logLevel = ref('info')
  const clientVersion = ref('')
  const runtimeDisplay = ref('00:00:00')
  let startTime = Date.now()
  let runtimeInterval: ReturnType<typeof setInterval> | null = null

  function detectServer(url: string): ServerType {
    if (url.includes('beta.arcosc.app')) return 'beta'
    if (url.includes('arcosc.app')) return 'live'
    return 'custom'
  }
  function updateRuntime() {
    const elapsed = Date.now() - startTime
    const h = Math.floor(elapsed / 3600000)
    const m = Math.floor((elapsed % 3600000) / 60000)
    const s = Math.floor((elapsed % 60000) / 1000)
    runtimeDisplay.value = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  async function loadSettings() {
    const config = await api.getServerConfig()
    serverUrl.value = config.websocketServerUrl ?? 'wss://arcosc.app:48255'
    activeServer.value = detectServer(serverUrl.value)
    const settings = await api.getAppSettings()
    theme.value = settings?.theme ?? 'light'
    applyTheme(theme.value)
    snowEnabled.value = settings?.snowEnabled !== false
    logLevel.value = settings?.logLevel ?? 'info'
    const ver = await api.getClientVersion()
    clientVersion.value = ver ?? ''
  }
  function applyTheme(t: 'light' | 'dark') {
    if (t === 'dark') {
      document.body.classList.add('dark-theme')
    } else {
      document.body.classList.remove('dark-theme')
    }
    theme.value = t
  }
  async function toggleTheme() {
    const newTheme = theme.value === 'light' ? 'dark' : 'light'
    applyTheme(newTheme)
    const settings = await api.getAppSettings()
    settings.theme = newTheme
    await api.setAppSettings(settings)
  }
  async function toggleSnow() {
    snowEnabled.value = !snowEnabled.value
    const settings = await api.getAppSettings()
    settings.snowEnabled = snowEnabled.value
    await api.setAppSettings(settings)
  }
  async function switchToServer(type: ServerType) {
    const url = type === 'custom' ? serverUrl.value : SERVER_URLS[type]
    serverUrl.value = url
    activeServer.value = type
    await api.setConfig({ websocketServerUrl: url })
  }
  async function updateCustomServerUrl(url: string) {
    if (url.includes('arcosc.app') || url.includes('beta.arcosc.app')) return
    serverUrl.value = url
    activeServer.value = 'custom'
    await api.setConfig({ websocketServerUrl: url })
  }
  async function updateLogLevel(level: string) {
    logLevel.value = level
    const settings = await api.getAppSettings()
    settings.logLevel = level
    await api.setAppSettings(settings)
  }
  async function getDebugStats() {
    return api.getDebugStats()
  }
  async function getMemoryStats() {
    return api.getMemoryStats()
  }
  async function forceMemoryCleanup() {
    return api.forceMemoryCleanup()
  }
  async function clearDebugLogs() {
    return api.clearDebugLogs()
  }

  onMounted(async () => {
    await loadSettings()
    startTime = Date.now()
    updateRuntime()
    runtimeInterval = setInterval(updateRuntime, 1000)
  })
  onUnmounted(() => {
    if (runtimeInterval) clearInterval(runtimeInterval)
  })

  return {
    serverUrl,
    activeServer,
    theme,
    snowEnabled,
    logLevel,
    clientVersion,
    runtimeDisplay,
    toggleTheme,
    toggleSnow,
    switchToServer,
    updateCustomServerUrl,
    updateLogLevel,
    getDebugStats,
    getMemoryStats,
    forceMemoryCleanup,
    clearDebugLogs
  }
}
