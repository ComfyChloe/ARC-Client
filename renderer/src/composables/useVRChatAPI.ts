import { computed, onMounted, ref } from 'vue'
import { useElectronAPI } from './useElectronAPI'

export interface VRChatUser {
  displayName: string
  id: string
  profilePicOverride?: string
  currentAvatarThumbnailImageUrl?: string
}

export interface VRChatApiStatus {
  enabled: boolean
  authenticated: boolean
  currentUser: VRChatUser | null
  pending2FA: boolean
  twoFactorMethods: string[]
  pipelineConnected: boolean
}

export interface VRChatStats {
  uploadedAvatars: number
  favoritedAvatars: number
  friendsOnline: number
}

const defaultStatus: VRChatApiStatus = {
  enabled: false,
  authenticated: false,
  currentUser: null,
  pending2FA: false,
  twoFactorMethods: [],
  pipelineConnected: false
}

const status = ref<VRChatApiStatus>({ ...defaultStatus })
const stats = ref<VRChatStats | null>(null)
const linkStatus = ref<'unknown' | 'linked' | 'unlinked'>('unknown')
const websocketConnected = ref(false)
const autoLoginAttempted = ref(false)
const loading = ref(false)
const error = ref<string | null>(null)
const twoFactorCode = ref('')
const loginUsername = ref('')
const loginPassword = ref('')
let vrchatApiInitialized = false
let vrchatApiInitPromise: Promise<void> | null = null
let vrchatApiPipelineListenerRegistered = false
let vrchatApiWebSocketListenerRegistered = false

export function useVRChatAPI() {
  const api = useElectronAPI()

  const isAuthenticated = computed(() => status.value.authenticated)
  const isPending2FA = computed(() => status.value.pending2FA)

  async function loadWebSocketStatus() {
    const wsStatus = await api.getWebSocketStatus()
    websocketConnected.value = !!wsStatus?.isConnected
  }

  async function checkLinkStatus() {
    if (!status.value.authenticated || !websocketConnected.value) {
      linkStatus.value = 'unknown'
      return
    }
    try {
      const result = await api.checkVRChatLink()
      linkStatus.value = result.linked ? 'linked' : 'unlinked'
    } catch (checkError) {
      const message = checkError instanceof Error ? checkError.message : String(checkError)
      if (message.includes('Not connected to ARC WebSocket server')) {
        linkStatus.value = 'unknown'
        return
      }
      throw checkError
    }
  }

  async function loadStatus() {
    const nextStatus = await api.vrchatApiGetStatus()
    status.value = { ...defaultStatus, ...nextStatus }
    if (status.value.authenticated) {
      await checkLinkStatus()
    } else {
      linkStatus.value = 'unknown'
    }
  }

  async function loadStats() {
    if (!status.value.authenticated) {
      stats.value = null
      return
    }
    const nextStats = await api.vrchatApiGetStats()
    if (nextStats) {
      stats.value = nextStats
    }
  }

  async function login() {
    if (!loginUsername.value || !loginPassword.value) return
    loading.value = true
    error.value = null
    const result = await api.vrchatApiLogin({ username: loginUsername.value, password: loginPassword.value })
    loading.value = false
    if (result.error) {
      error.value = result.error
      return
    }
    if (result.requires2FA) {
      status.value = {
        ...status.value,
        pending2FA: true,
        twoFactorMethods: result.methods || []
      }
      return
    }
    await loadWebSocketStatus()
    await loadStatus()
    if (status.value.authenticated) {
      await loadStats()
    }
  }

  async function verify2FA() {
    if (!twoFactorCode.value) return
    loading.value = true
    error.value = null
    const method = status.value.twoFactorMethods.includes('emailOtp') ? 'emailOtp' : 'totp'
    const result = await api.vrchatApiVerify2FA({ code: twoFactorCode.value, type: method })
    loading.value = false
    twoFactorCode.value = ''
    if (result.error) {
      error.value = result.error
      return
    }
    status.value = { ...status.value, pending2FA: false }
    await loadWebSocketStatus()
    await loadStatus()
    if (status.value.authenticated) {
      await loadStats()
    }
  }

  function cancel2FA() {
    status.value = { ...status.value, pending2FA: false, twoFactorMethods: [] }
    twoFactorCode.value = ''
  }

  async function restoreSession() {
    if (autoLoginAttempted.value) return
    autoLoginAttempted.value = true
    const result = await api.vrchatApiRestoreSession()
    if (result.success) {
      await loadWebSocketStatus()
      await loadStatus()
      if (status.value.authenticated) {
        await loadStats()
      }
    }
  }

  async function logout() {
    await api.vrchatApiLogout()
    status.value = { ...defaultStatus }
    stats.value = null
    linkStatus.value = 'unknown'
  }

  async function shareWithARC() {
    if (!status.value.currentUser) return
    const result = await api.sendVRChatLink(status.value.currentUser.id, status.value.currentUser.displayName)
    await checkLinkStatus()
    return result
  }

  async function initialize() {
    if (vrchatApiInitialized) return
    if (vrchatApiInitPromise) return vrchatApiInitPromise
    vrchatApiInitPromise = (async () => {
      await loadWebSocketStatus()
      await loadStatus()
      if (!status.value.authenticated) {
        await restoreSession()
      } else {
        await loadStats()
        await checkLinkStatus()
      }
      if (!vrchatApiPipelineListenerRegistered) {
        api.onVRChatPipelineEvent(async () => {
          await loadStatus()
          if (status.value.authenticated) {
            await loadStats()
            await checkLinkStatus()
          } else {
            stats.value = null
            linkStatus.value = 'unknown'
          }
        })
        vrchatApiPipelineListenerRegistered = true
      }
      if (!vrchatApiWebSocketListenerRegistered) {
        api.onWebSocketStatus((data: any) => {
          const nextConnected = (data.status ?? (data.connected ? 'connected' : 'disconnected')) === 'connected'
          websocketConnected.value = nextConnected
          if (!nextConnected) {
            linkStatus.value = 'unknown'
            return
          }
          if (status.value.authenticated) {
            void checkLinkStatus()
          }
        })
        vrchatApiWebSocketListenerRegistered = true
      }
      vrchatApiInitialized = true
    })()
    return vrchatApiInitPromise
  }

  onMounted(() => { void initialize() })

  return {
    status,
    stats,
    linkStatus,
    loading,
    error,
    loginUsername,
    loginPassword,
    twoFactorCode,
    isAuthenticated,
    isPending2FA,
    login,
    verify2FA,
    cancel2FA,
    logout,
    loadStatus,
    loadStats,
    shareWithARC,
    checkLinkStatus,
    restoreSession,
    initialize
  }
}