// ====
// OpenShockPage state factory — sibling script module for OpenShockPage.vue.
// Owns connection token entry, share-link login form, control-tab state,
// link sharing state, and control logs fetching/formatting.
// Shared cross-page state lives in composables/useOpenShock.ts.
// Call createOpenShockPageState() once from <script setup>.
// ====
import { ref, computed, watch } from 'vue'
import { useOpenShock, type OpenShockShocker } from '../composables/useOpenShock'
import { useElectronAPI } from '../composables/useElectronAPI'

export function createOpenShockPageState() {
  const { status, allShockers, loading, error, activeTab, refreshShockers, connect, disconnect, clearSavedToken, sendControl, quickCommand, createShareLink, login, logout } = useOpenShock()
  // -- Connection --
  const apiToken = ref('')
  const showTokenInput = computed(() => !status.value.hasApiToken && !status.value.connected)
  async function handleConnect() {
    if (!apiToken.value.trim()) return
    await connect(apiToken.value.trim())
    apiToken.value = ''
  }
  // -- Login for public share links --
  const loginEmail = ref('')
  const loginPassword = ref('')
  const loginFeedback = ref('')
  const loginLoading = ref(false)
  const showLoginForm = ref(false)
  async function handleLogin() {
    if (!loginEmail.value.trim() || !loginPassword.value.trim()) return
    loginLoading.value = true
    loginFeedback.value = ''
    const result = await login(loginEmail.value.trim(), loginPassword.value.trim())
    loginLoading.value = false
    if (result.success) {
      loginFeedback.value = ''
      loginEmail.value = ''
      loginPassword.value = ''
      showLoginForm.value = false
    } else {
      loginFeedback.value = result.error || 'Login failed'
    }
  }
  async function handleLogout() {
    await logout()
    loginFeedback.value = ''
  }
  // -- Control tab --
  const selectedShocker = ref<OpenShockShocker | null>(null)
  const intensity = ref(30)
  const duration = ref(500)
  const controlFeedback = ref('')
  function selectShocker(shocker: OpenShockShocker) { selectedShocker.value = shocker }
  async function handleControl(type: 'Shock' | 'Vibrate' | 'Sound' | 'Stop') {
    if (!selectedShocker.value) return; controlFeedback.value = ''
    await sendControl([{ id: selectedShocker.value.id, type, intensity: type === 'Stop' ? undefined : intensity.value, duration: type === 'Stop' ? undefined : duration.value }])
    controlFeedback.value = type === 'Stop' ? 'Stop sent' : type + ' sent (' + intensity.value + '%, ' + duration.value + 'ms)'
    setTimeout(() => { controlFeedback.value = '' }, 2000)
  }
  // -- Link Sharing tab --
  const sharingShockerId = ref('')
  const sharePermissions = ref({ shock: false, vibrate: true, sound: true, live: false })
  const shareLimits = ref({ intensity: 50, duration: 5000 })
  const generatedLink = ref('')
  const generatedShareCode = ref('')
  const shareError = ref('')
  async function handleGenerateLink() {
    if (!sharingShockerId.value) return; shareError.value = ''; generatedLink.value = ''; generatedShareCode.value = ''
    const result = await createShareLink(sharingShockerId.value, { ...sharePermissions.value }, { ...shareLimits.value })
    if (!result) { shareError.value = error.value || 'Failed to create share'; return }
    if (result.url) { generatedLink.value = result.url }
    if (result.shareCode) { generatedShareCode.value = result.shareCode }
    if (result.sessionExpired) { showLoginForm.value = true; shareError.value = result.error || 'Session expired' }
    if (result.error && !result.sessionExpired && !result.url && !result.shareCode) { shareError.value = result.error }
  }
  async function copyGeneratedLink() { if (generatedLink.value) await navigator.clipboard.writeText(generatedLink.value).catch(() => {}) }
  async function copyShareCode() { if (generatedShareCode.value) await navigator.clipboard.writeText(generatedShareCode.value).catch(() => {}) }
  // -- Logs tab --
  const api = useElectronAPI()
  const controlLogs = ref<any[]>([])
  const logLimit = ref(50)
  const logLoading = ref(false)
  async function fetchLogs() {
    logLoading.value = true
    try {
      controlLogs.value = await api.openShockGetControlLogs(logLimit.value) || []
    } catch (e: unknown) { console.error('Failed to fetch logs:', e) }
    logLoading.value = false
  }
  function formatTime(ts: number) {
    const d = new Date(ts)
    const now = Date.now()
    const diff = Math.floor((now - ts) / 1000)
    let rel = ''
    if (diff < 60) rel = diff + 's ago'
    else if (diff < 3600) rel = Math.floor(diff / 60) + 'm ago'
    else if (diff < 86400) rel = Math.floor(diff / 3600) + 'h ago'
    else rel = Math.floor(diff / 86400) + 'd ago'
    return rel + ' (' + d.toLocaleTimeString() + ')'
  }
  async function loadMoreLogs() { logLimit.value += 50; await fetchLogs() }
  watch(activeTab, (tab) => { if (tab === 'logs') void fetchLogs() })
  return {
    // composable state
    status,
    allShockers,
    loading,
    error,
    activeTab,
    refreshShockers,
    disconnect,
    clearSavedToken,
    quickCommand,
    // connection
    apiToken,
    showTokenInput,
    handleConnect,
    // login
    loginEmail,
    loginPassword,
    loginFeedback,
    loginLoading,
    showLoginForm,
    handleLogin,
    handleLogout,
    // control
    selectedShocker,
    intensity,
    duration,
    controlFeedback,
    selectShocker,
    handleControl,
    // sharing
    sharingShockerId,
    sharePermissions,
    shareLimits,
    generatedLink,
    generatedShareCode,
    shareError,
    handleGenerateLink,
    copyGeneratedLink,
    copyShareCode,
    // logs
    controlLogs,
    logLimit,
    logLoading,
    fetchLogs,
    formatTime,
    loadMoreLogs
  }
}
