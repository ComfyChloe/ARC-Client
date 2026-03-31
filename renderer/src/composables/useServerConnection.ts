import { ref, shallowRef, triggerRef, onMounted } from 'vue'
import { useElectronAPI } from './useElectronAPI'
import { debugLog } from './useDebugLog'

export interface AvatarInfo {
  id: string
  name: string | null
  displayName: string
  username: string
}

export interface PanelInfo {
  panelName: string
  connectionCount: number
  isActive: boolean
  panelEnabled: boolean
  isPublic: boolean
  hasPassword: boolean
  allowFriends: boolean
  activeLinkCount: number
  friendLinkCount: number
  publicLinkCount: number
  safetyEnabled: boolean
  safety2Enabled: boolean
  safety3Enabled: boolean
  safety4Enabled: boolean
  safety5Enabled: boolean
}

const connectionStatus = ref<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected')
const isConnected = ref(false)
const isAuthenticated = ref(false)
const currentUser = ref<{ username: string } | null>(null)
const currentAvatar = ref<AvatarInfo | null>(null)
const parameters = shallowRef<Record<string, any>>({})
const panelConnectionsData = ref<Record<string, PanelInfo>>({})
const wsForwardingEnabled = ref(false)
const loading = ref(false)
const error = ref<string | null>(null)
const savedUsername = ref('')
const savedPassword = ref('')
const savePasswordChecked = ref(false)
let serverConnectionInitialized = false
let serverConnectionInitPromise: Promise<void> | null = null

export function useServerConnection() {
  const api = useElectronAPI()

  async function loadSavedCredentials() {
    const lastUser = await api.getLastUsername()
    if (lastUser) {
      savedUsername.value = lastUser
      debugLog(`Last username loaded: ${lastUser}`)
    }
    const result = await api.getSavedPassword()
    if (result?.password) {
      savedPassword.value = result.password
      savePasswordChecked.value = true
      debugLog('Saved password loaded from configuration (encrypted)')
    }
  }
  async function authenticate(username: string, password: string) {
    if (isAuthenticated.value && isConnected.value) {
      await disconnect()
      return
    }
    if (!username || !password) {
      debugLog('Please enter username and password', 'error')
      return
    }
    loading.value = true
    error.value = null
    connectionStatus.value = 'connecting'
    debugLog('Connecting to server...')
    const result = await api.authenticate({ username, password })
    loading.value = false
    if (result.success) {
      isConnected.value = true
      isAuthenticated.value = true
      currentUser.value = result.user ?? { username }
      debugLog(`Successfully authenticated as ${username}`)
      await api.setLastUsername(username.trim().toLowerCase())
    } else {
      error.value = result.error ?? 'Authentication failed'
      connectionStatus.value = 'error'
      debugLog(`Authentication failed: ${result.error ?? 'Unknown error'}`, 'error')
    }
  }
  async function disconnect() {
    await api.disconnectServer()
    isConnected.value = false
    isAuthenticated.value = false
    currentUser.value = null
    currentAvatar.value = null
    parameters.value = {}
    panelConnectionsData.value = {}
    connectionStatus.value = 'disconnected'
    debugLog('Disconnected from server')
  }
  async function unloadAvatar() {
    if (!isAuthenticated.value || !isConnected.value || !currentUser.value) return
    await api.sendWebSocketMessage('avatar-unload', { username: currentUser.value.username })
  }
  async function toggleSavePassword(checked: boolean, password: string) {
    savePasswordChecked.value = checked
    if (checked && password) {
      await api.setSavedPassword(password)
    } else if (!checked) {
      await api.setSavedPassword('')
    }
  }
  async function savePassword(password: string) {
    if (savePasswordChecked.value && password) {
      await api.setSavedPassword(password)
    }
  }
  async function toggleWsForwarding() {
    const result = await api.setWebSocketForwarding(!wsForwardingEnabled.value)
    if (result.success) {
      wsForwardingEnabled.value = result.enabled
    }
  }
  function getDisplayNameFromId(avatarId: string): string {
    if (avatarId.startsWith('avtr_')) {
      return `Avatar ${avatarId.substring(5, 13)}`
    }
    return avatarId.length > 16 ? `${avatarId.substring(0, 16)}...` : avatarId
  }
  async function initialize() {
    if (serverConnectionInitialized) return
    if (serverConnectionInitPromise) return serverConnectionInitPromise
    serverConnectionInitPromise = (async () => {
      await loadSavedCredentials()
      const settings = await api.getAppSettings()
      wsForwardingEnabled.value = settings?.enableWebSocketForwarding ?? false
      api.onWebSocketStatus((data: any) => {
        const status = data.status ?? (data.connected ? 'connected' : 'disconnected')
        connectionStatus.value = status
        debugLog(`WebSocket status changed to: ${status}`)
        if (status === 'connected') {
          isConnected.value = true
          debugLog('Connected to WebSocket server')
        } else if (status === 'disconnected') {
          isConnected.value = false
          isAuthenticated.value = false
          currentUser.value = null
          currentAvatar.value = null
          parameters.value = {}
          panelConnectionsData.value = {}
          debugLog('Disconnected from WebSocket server - performed memory cleanup')
        }
      })
      api.onWebSocketError((data: any) => {
        debugLog(`WebSocket connection error: ${data.error ?? 'Unknown error'}${data.attempts ? ` (Attempt ${data.attempts}/${data.maxAttempts})` : ''}`, 'error')
      })
      api.onWebSocketAuthenticated((data: any) => {
        isAuthenticated.value = true
        currentUser.value = { username: data.username }
        debugLog(`Authenticated as ${data.username} in room ${data.room ?? 'unknown'}`)
      })
      api.onWebSocketAvatarChange((data: any) => {
        if (!data.id) {
          currentAvatar.value = null
          parameters.value = {}
          debugLog(`Avatar unloaded for user ${data.username ?? 'unknown'}`)
          return
        }
        const displayName = data.name ?? getDisplayNameFromId(data.id)
        currentAvatar.value = {
          id: data.id,
          name: data.name ?? null,
          displayName,
          username: data.username
        }
        debugLog(`Avatar changed: ${displayName} for user ${data.username ?? 'unknown'}`)
      })
      api.onWebSocketParameterUpdate((data: any) => {
        if (data.parameters) {
          Object.assign(parameters.value, data.parameters)
          triggerRef(parameters)
        }
      })
      api.onWebSocketPanelConnectionsUpdate((data: any) => {
        panelConnectionsData.value = data ?? {}
      })
      api.onAppSettings((settings: any) => {
        wsForwardingEnabled.value = settings?.enableWebSocketForwarding ?? false
      })
      api.onWebSocketServerMessage((data: any) => {
        debugLog(`Server message: ${data.message || JSON.stringify(data)}`)
      })
      if (savedUsername.value && savedPassword.value) {
        debugLog('Auto-connecting with saved credentials...')
        setTimeout(() => {
          authenticate(savedUsername.value, savedPassword.value)
        }, 500)
      }
      serverConnectionInitialized = true
    })()
    await serverConnectionInitPromise
  }

  onMounted(async () => {
    await initialize()
  })

  return {
    connectionStatus,
    isConnected,
    isAuthenticated,
    currentUser,
    currentAvatar,
    parameters,
    panelConnectionsData,
    wsForwardingEnabled,
    loading,
    error,
    savedUsername,
    savedPassword,
    savePasswordChecked,
    authenticate,
    disconnect,
    unloadAvatar,
    toggleSavePassword,
    savePassword,
    toggleWsForwarding
  }
}
