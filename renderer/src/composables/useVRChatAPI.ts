import { ref, onMounted, computed } from 'vue'
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

export function useVRChatAPI() {
  const api = useElectronAPI()
  const status = ref<VRChatApiStatus>({ ...defaultStatus })
  const stats = ref<VRChatStats | null>(null)
  const linkStatus = ref<'unknown' | 'linked' | 'unlinked'>('unknown')
  const autoLoginAttempted = ref(false)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const twoFactorCode = ref('')
  const loginUsername = ref('')
  const loginPassword = ref('')

  const isAuthenticated = computed(() => status.value.authenticated)
  const isPending2FA = computed(() => status.value.pending2FA)

  async function loadStatus() {
    const s = await api.vrchatApiGetStatus()
    status.value = { ...defaultStatus, ...s }
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
      status.value = { ...status.value, pending2FA: true, twoFactorMethods: result.methods || [] }
    } else {
      await loadStatus()
      if (status.value.authenticated) await loadStats()
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
    await loadStatus()
    if (status.value.authenticated) await loadStats()
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
      await loadStatus()
      if (status.value.authenticated) await loadStats()
    }
  }
  async function logout() {
    await api.vrchatApiLogout()
    status.value = { ...defaultStatus }
    stats.value = null
    linkStatus.value = 'unknown'
  }
  async function loadStats() {
    const s = await api.vrchatApiGetStats()
    if (s) stats.value = s
  }
  async function shareWithARC() {
    if (!status.value.currentUser) return
    const result = await api.sendVRChatLink(status.value.currentUser.id, status.value.currentUser.displayName)
    return result
  }
  async function checkLinkStatus() {
    const result = await api.checkVRChatLink()
    linkStatus.value = result.linked ? 'linked' : 'unlinked'
  }

  onMounted(async () => {
    await loadStatus()
    if (!status.value.authenticated) {
      await restoreSession()
    } else {
      await loadStats()
    }
    api.onVRChatPipelineEvent((_data: any) => {
      // Pipeline events (friend-online/offline, notifications) can be handled here
    })
  })

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
    restoreSession
  }
}
