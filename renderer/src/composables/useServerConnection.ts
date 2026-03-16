import { ref, shallowRef, onMounted, onUnmounted } from 'vue'
import { useElectronAPI } from './useElectronAPI'

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
let paramUpdateTimer: ReturnType<typeof setTimeout> | null = null
let serverConnectionInitialized = false
let serverConnectionInitPromise: Promise<void> | null = null

export function useServerConnection() {
  const api = useElectronAPI()

  async function loadSavedCredentials() {
    const lastUser = await api.getLastUsername()
    if (lastUser) savedUsername.value = lastUser
    const result = await api.getSavedPassword()
    if (result?.password) {
      savedPassword.value = result.password
      savePasswordChecked.value = true
    }
  }
  async function authenticate(username: string, password: string) {
    if (isAuthenticated.value && isConnected.value) {
      await disconnect()
      return
    }
    if (!username || !password) return
    loading.value = true
    error.value = null
    connectionStatus.value = 'connecting'
    const result = await api.authenticate({ username, password })
    loading.value = false
    if (result.success) {
      isConnected.value = true
      isAuthenticated.value = true
      currentUser.value = result.user ?? { username }
      await api.setLastUsername(username.trim().toLowerCase())
    } else {
      error.value = result.error ?? 'Authentication failed'
      connectionStatus.value = 'error'
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
        if (status === 'connected') {
          isConnected.value = true
        } else if (status === 'disconnected') {
          isConnected.value = false
          isAuthenticated.value = false
          currentUser.value = null
          currentAvatar.value = null
          parameters.value = {}
          panelConnectionsData.value = {}
        }
      })
      api.onWebSocketError((_data: any) => {
      })
      api.onWebSocketAuthenticated((data: any) => {
        isAuthenticated.value = true
        currentUser.value = { username: data.username }
      })
      api.onWebSocketAvatarChange((data: any) => {
        if (!data.id) {
          currentAvatar.value = null
          parameters.value = {}
          return
        }
        currentAvatar.value = {
          id: data.id,
          name: data.name ?? null,
          displayName: data.name ?? getDisplayNameFromId(data.id),
          username: data.username
        }
      })
      api.onWebSocketParameterUpdate((data: any) => {
        if (data.parameters) {
          parameters.value = { ...parameters.value, ...data.parameters }
          if (paramUpdateTimer) clearTimeout(paramUpdateTimer)
          paramUpdateTimer = setTimeout(() => {
            parameters.value = { ...parameters.value }
            paramUpdateTimer = null
          }, 250)
        }
      })
      api.onWebSocketPanelConnectionsUpdate((data: any) => {
        panelConnectionsData.value = data ?? {}
      })
      api.onAppSettings((settings: any) => {
        wsForwardingEnabled.value = settings?.enableWebSocketForwarding ?? false
      })
      if (savedUsername.value && savedPassword.value) {
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
  onUnmounted(() => {
    if (paramUpdateTimer) clearTimeout(paramUpdateTimer)
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
