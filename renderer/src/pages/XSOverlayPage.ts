// ====
// XSOverlayPage state factory — sibling script module for XSOverlayPage.vue.
// Owns status labels, config display computed values, and notification
// type helpers. Shared state lives in composables/useXSOverlay.ts.
// Call createXSOverlayPageState() once from <script setup>.
// ====
import { computed } from 'vue'
import { useXSOverlay } from '../composables/useXSOverlay'

export function createXSOverlayPageState() {
  const {
    status,
    autostart,
    dbLogs,
    toggle,
    toggleAutostart,
    updateConfig
  } = useXSOverlay()
  const statusClass = computed(() => {
    const s = status.value
    if (!s.enabled) return 'status-disconnected'
    if (s.connected && s.xsOverlayRunning) return 'status-connected'
    if (!s.xsOverlayRunning) return 'status-error'
    return 'status-connecting'
  })
  const statusText = computed(() => {
    const s = status.value
    if (!s.enabled) return 'Disabled'
    if (s.connected && s.xsOverlayRunning) return 'Connected to XS Overlay'
    if (!s.xsOverlayRunning) return 'XS Overlay not detected'
    return 'Connecting...'
  })
  const toggleButtonLabel = computed(() => {
    const s = status.value
    if (s.enabled) return 'Stop Notifications'
    return 'Start Notifications'
  })
  const toggleButtonDisabled = computed(() => false)
  const currentOpacity = computed(() => status.value.config?.notificationOpacity ?? 1)
  const currentVolume = computed(() => status.value.config?.notificationVolume ?? 0.7)
  const currentTimeout = computed(() => status.value.config?.notificationTimeout ?? 5)
  function toggleNotificationType(key: 'panelConnections' | 'avatarChanges') {
    const current = status.value.config?.notifications?.[key] ?? true
    const notifications = status.value.config?.notifications ?? { panelConnections: true, avatarChanges: true }
    updateConfig({ notifications: { ...notifications, [key]: !current } })
  }
  function formatTime(value: string | number): string {
    if (typeof value === 'string') return value
    return new Date(value).toLocaleString()
  }
  function notificationTypeIcon(type: string): string {
    switch (type) {
      case 'panel-connection': return '\uD83D\uDD17'
      case 'panel-disconnection': return '\uD83D\uDD13'
      case 'avatar-change': return '\uD83D\uDC64'
      case 'error': return '\u26A0\uFE0F'
      default: return '\u2139\uFE0F'
    }
  }
  function notificationTypeClass(type: string): string {
    switch (type) {
      case 'panel-connection': return 'notif-connect'
      case 'panel-disconnection': return 'notif-disconnect'
      case 'avatar-change': return 'notif-avatar'
      case 'error': return 'notif-error'
      default: return 'notif-info'
    }
  }
  return {
    status,
    autostart,
    dbLogs,
    toggle,
    toggleAutostart,
    updateConfig,
    statusClass,
    statusText,
    toggleButtonLabel,
    toggleButtonDisabled,
    currentOpacity,
    currentVolume,
    currentTimeout,
    toggleNotificationType,
    formatTime,
    notificationTypeIcon,
    notificationTypeClass
  }
}
