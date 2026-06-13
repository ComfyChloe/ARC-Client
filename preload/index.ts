import { contextBridge, ipcRenderer } from 'electron'
const api = {
  getConfig: () => ipcRenderer.invoke('get-config'),
  getServerConfig: () => ipcRenderer.invoke('get-server-config'),
  setConfig: (config: any) => ipcRenderer.invoke('set-config', config),
  getAppSettings: () => ipcRenderer.invoke('get-app-settings'),
  setAppSettings: (settings: any) => ipcRenderer.invoke('set-app-settings', settings),
  getWindowState: () => ipcRenderer.invoke('get-window-state'),
  setWindowState: (windowState: any) => ipcRenderer.invoke('set-window-state', windowState),
  enableOsc: () => ipcRenderer.invoke('enable-osc'),
  disableOsc: () => ipcRenderer.invoke('disable-osc'),
  getOscStatus: () => ipcRenderer.invoke('get-osc-status'),
  setOscForwarding: (enabled: boolean) => ipcRenderer.invoke('set-osc-forwarding', enabled),
  // WebSocket API
  connectServer: (credentials: any) => ipcRenderer.invoke('websocket-connect', credentials),
  disconnectServer: () => ipcRenderer.invoke('websocket-disconnect'),
  authenticate: (credentials: any) => ipcRenderer.invoke('websocket-connect', credentials),
  sendOsc: (data: any) => ipcRenderer.invoke('websocket-send-osc', data),
  sendOscLocal: (data: any) => ipcRenderer.invoke('osc-send-local', data),
  testWebSocketSend: () => ipcRenderer.invoke('websocket-test-send'),
  sendWebSocketMessage: (event: string, data: any) => ipcRenderer.invoke('websocket-send-message', event, data),
  getWebSocketStatus: () => ipcRenderer.invoke('websocket-get-status'),
  getWebSocketForwardingStatus: () => ipcRenderer.invoke('websocket-get-forwarding-status'),
  setWebSocketForwarding: (enabled: boolean) => ipcRenderer.invoke('websocket-set-forwarding', enabled),
  // Username storage API
  getLastUsername: () => ipcRenderer.invoke('get-last-username'),
  setLastUsername: (username: string) => ipcRenderer.invoke('set-last-username', username),
  // Password storage API
  getSavedPassword: () => ipcRenderer.invoke('get-saved-password'),
  setSavedPassword: (password: string) => ipcRenderer.invoke('set-saved-password', password),
  // OSC Query unsubscription API
  getOscQueryUnsubscriptions: () => ipcRenderer.invoke('get-oscquery-unsubscriptions'),
  addOscQueryUnsubscription: (path: string) => ipcRenderer.invoke('add-oscquery-unsubscription', path),
  removeOscQueryUnsubscription: (path: string) => ipcRenderer.invoke('remove-oscquery-unsubscription', path),
  // Server-managed blocklist/suppression query API
  getServerBlocklist: () => ipcRenderer.invoke('get-server-blocklist'),
  getServerSuppressions: () => ipcRenderer.invoke('get-server-suppressions'),
  getHardcodedUnsubscriptions: () => ipcRenderer.invoke('get-hardcoded-unsubscriptions'),
  requestUnsuppress: (address: string) => ipcRenderer.invoke('request-unsuppress', address),
  clearAllSuppressions: () => ipcRenderer.invoke('clear-all-suppressions'),
  // OSC Query status and control
  getOscQueryStatus: () => ipcRenderer.invoke('get-oscquery-status'),
  oscQueryForceReconnect: () => ipcRenderer.invoke('oscquery-force-reconnect'),
  oscQueryResetAll: () => ipcRenderer.invoke('oscquery-reset-all'),
  // HypeRate API
  hyperateGetStatus: () => ipcRenderer.invoke('hyperate-get-status'),
  hyperateStart: () => ipcRenderer.invoke('hyperate-start'),
  hyperateStop: () => ipcRenderer.invoke('hyperate-stop'),
  hyperateAddTracker: (deviceId: string, deviceName: string | null = null) => ipcRenderer.invoke('hyperate-add-tracker', deviceId, deviceName),
  hyperateRemoveTracker: (deviceId: string) => ipcRenderer.invoke('hyperate-remove-tracker', deviceId),
  hyperateGetTrackers: () => ipcRenderer.invoke('hyperate-get-trackers'),
  hyperateSetPrimary: (deviceId: string) => ipcRenderer.invoke('hyperate-set-primary', deviceId),
  hyperateUpdateTrackerName: (deviceId: string, newName: string) => ipcRenderer.invoke('hyperate-update-tracker-name', deviceId, newName),
  hyperateUpdateTrackerState: (deviceId: string, enabled: boolean) => ipcRenderer.invoke('hyperate-update-tracker-state', deviceId, enabled),
  hyperateGetAutostart: () => ipcRenderer.invoke('hyperate-get-autostart'),
  hyperateSetAutostart: (enabled: boolean) => ipcRenderer.invoke('hyperate-set-autostart', enabled),
  // HypeRate History API
  hyperateGetHistory: (trackerId: string, fromMs: number, toMs: number, maxPoints?: number) => ipcRenderer.invoke('hyperate-get-history', trackerId, fromMs, toMs, maxPoints),
  hyperateGetStats: (trackerId: string, fromMs: number, toMs: number) => ipcRenderer.invoke('hyperate-get-stats', trackerId, fromMs, toMs),
  hyperateGetHistoryConfig: () => ipcRenderer.invoke('hyperate-get-history-config'),
  hyperateSetHistoryConfig: (config: { retentionDays: number }) => ipcRenderer.invoke('hyperate-set-history-config', config),
  hyperateGetCaptureRate: () => ipcRenderer.invoke('hyperate-get-capture-rate'),
  hyperateSetCaptureRate: (config: { rateMs: number }) => ipcRenderer.invoke('hyperate-set-capture-rate', config),
  // OSCLeash API
  oscleashGetStatus: () => ipcRenderer.invoke('oscleash-get-status'),
  oscleashStart: () => ipcRenderer.invoke('oscleash-start'),
  oscleashStop: () => ipcRenderer.invoke('oscleash-stop'),
  oscleashGetConfig: () => ipcRenderer.invoke('oscleash-get-config'),
  oscleashUpdateConfig: (config: any) => ipcRenderer.invoke('oscleash-update-config', config),
  oscleashGetAutostart: () => ipcRenderer.invoke('oscleash-get-autostart'),
  oscleashSetAutostart: (enabled: boolean) => ipcRenderer.invoke('oscleash-set-autostart', enabled),
  // OscGoesBrrr API
  ogbGetStatus: () => ipcRenderer.invoke('ogb-get-status'),
  ogbStart: () => ipcRenderer.invoke('ogb-start'),
  ogbStop: () => ipcRenderer.invoke('ogb-stop'),
  ogbGetDevices: () => ipcRenderer.invoke('ogb-get-devices'),
  ogbGetConfig: () => ipcRenderer.invoke('ogb-get-config'),
  ogbUpdateConfig: (config: any) => ipcRenderer.invoke('ogb-update-config', config),
  ogbUpdateDeviceBinding: (deviceId: string, binding: any) => ipcRenderer.invoke('ogb-update-device-binding', deviceId, binding),
  ogbUpdateIntifaceConfig: (config: any) => ipcRenderer.invoke('ogb-update-intiface-config', config),
  ogbGetAutostart: () => ipcRenderer.invoke('ogb-get-autostart'),
  ogbSetAutostart: (enabled: boolean) => ipcRenderer.invoke('ogb-set-autostart', enabled),
  // Encryption API
  encryptData: (plaintext: string) => ipcRenderer.invoke('encrypt-data', plaintext),
  decryptData: (encryptedData: string) => ipcRenderer.invoke('decrypt-data', encryptedData),
  // VRChat API
  vrchatApiGetStatus: () => ipcRenderer.invoke('vrchatapi-get-status'),
  vrchatApiLogin: (credentials: any) => ipcRenderer.invoke('vrchatapi-login', credentials),
  vrchatApiVerify2FA: (data: any) => ipcRenderer.invoke('vrchatapi-verify-2fa', data),
  vrchatApiLogout: () => ipcRenderer.invoke('vrchatapi-logout'),
  vrchatApiRestoreSession: () => ipcRenderer.invoke('vrchatapi-restore-session'),
  vrchatApiGetStats: () => ipcRenderer.invoke('vrchatapi-get-stats'),
  // AutoStatus API
  autoStatusGetConfig: () => ipcRenderer.invoke('autostatus-get-config'),
  autoStatusGetStatus: () => ipcRenderer.invoke('autostatus-get-status'),
  autoStatusSetPreset: (preset: any) => ipcRenderer.invoke('autostatus-set-preset', preset),
  autoStatusDeletePreset: (id: string) => ipcRenderer.invoke('autostatus-delete-preset', id),
  autoStatusTestPreset: (id: string) => ipcRenderer.invoke('autostatus-test-preset', id),
  autoStatusAddSchedule: (entry: any) => ipcRenderer.invoke('autostatus-add-schedule', entry),
  autoStatusUpdateSchedule: (entryId: string, updates: any) => ipcRenderer.invoke('autostatus-update-schedule', entryId, updates),
  autoStatusDeleteSchedule: (entryId: string) => ipcRenderer.invoke('autostatus-delete-schedule', entryId),
  autoStatusUpdateSettings: (settings: any) => ipcRenderer.invoke('autostatus-update-settings', settings),
  autoStatusGetLocationRules: () => ipcRenderer.invoke('autostatus-get-location-rules'),
  autoStatusAddLocationRule: (rule: any) => ipcRenderer.invoke('autostatus-add-location-rule', rule),
  autoStatusUpdateLocationRule: (ruleId: string, updates: any) => ipcRenderer.invoke('autostatus-update-location-rule', ruleId, updates),
  autoStatusDeleteLocationRule: (ruleId: string) => ipcRenderer.invoke('autostatus-delete-location-rule', ruleId),
  // Calendar API
  calendarFetch: () => ipcRenderer.invoke('calendar-fetch'),
  calendarGetStatus: () => ipcRenderer.invoke('calendar-get-status'),
  // OpenShock API
  openShockGetStatus: () => ipcRenderer.invoke('openshock-get-status'),
  openShockStart: (apiToken: string) => ipcRenderer.invoke('openshock-start', apiToken),
  openShockStop: () => ipcRenderer.invoke('openshock-stop'),
  openShockClearSavedToken: () => ipcRenderer.invoke('openshock-clear-saved-token'),
  openShockListShockers: () => ipcRenderer.invoke('openshock-list-shockers'),
  openShockListSharedShockers: () => ipcRenderer.invoke('openshock-list-shockers-shared'),
  openShockCreateShareLink: (shockerId: string, permissions: { shock: boolean; vibrate: boolean; sound: boolean; live: boolean }, limits: { intensity: number; duration: number }) => ipcRenderer.invoke('openshock-create-share-link', shockerId, permissions, limits),
  openShockSendControl: (shocks: Array<{ id: string; type: string; intensity?: number; duration?: number }>) => ipcRenderer.invoke('openshock-send-control', shocks),
  openShockPauseShocker: (shockerId: string, pause: boolean) => ipcRenderer.invoke('openshock-pause-shocker', shockerId, pause),
  openShockListShares: (shockerId: string) => ipcRenderer.invoke('openshock-list-shares', shockerId),
  openShockDeleteShare: (shockerId: string, sharedWithUserId: string) => ipcRenderer.invoke('openshock-delete-share', shockerId, sharedWithUserId),
  openShockPauseShare: (shockerId: string, sharedWithUserId: string, pause: boolean) => ipcRenderer.invoke('openshock-pause-share', shockerId, sharedWithUserId, pause),
  openShockListTokens: () => ipcRenderer.invoke('openshock-list-tokens'),
  openShockCreateToken: (name: string, permissions: Record<string, boolean>) => ipcRenderer.invoke('openshock-create-token', name, permissions),
  openShockDeleteToken: (tokenId: string) => ipcRenderer.invoke('openshock-delete-token', tokenId),
  openShockGetLogs: (shockerId: string, page?: number, size?: number) => ipcRenderer.invoke('openshock-get-logs', shockerId, page, size),
  openShockGetControlLogs: (limit?: number, offset?: number) => ipcRenderer.invoke('openshock-get-control-logs', limit, offset),
  openShockLogin: (email: string, password: string) => ipcRenderer.invoke('openshock-login', email, password),
  openShockLogout: () => ipcRenderer.invoke('openshock-logout'),
  openShockGetLoginStatus: () => ipcRenderer.invoke('openshock-get-login-status'),
  openShockClearSavedCredentials: () => ipcRenderer.invoke('openshock-clear-saved-credentials'),
  // XS Overlay API
  arcLinkStart: () => ipcRenderer.invoke('arclink-start'),
  arcLinkStop: () => ipcRenderer.invoke('arclink-stop'),
  arcLinkGetStatus: () => ipcRenderer.invoke('arclink-get-status'),
  // XS Overlay API
  xsOverlayGetStatus: () => ipcRenderer.invoke('xsoverlay-get-status'),
  xsOverlayStart: () => ipcRenderer.invoke('xsoverlay-start'),
  xsOverlayStop: () => ipcRenderer.invoke('xsoverlay-stop'),
  xsOverlayGetConfig: () => ipcRenderer.invoke('xsoverlay-get-config'),
  xsOverlayUpdateConfig: (config: any) => ipcRenderer.invoke('xsoverlay-update-config', config),
  xsOverlayGetAutostart: () => ipcRenderer.invoke('xsoverlay-get-autostart'),
  xsOverlaySetAutostart: (enabled: boolean) => ipcRenderer.invoke('xsoverlay-set-autostart', enabled),
  xsOverlayGetNotificationLogs: (limit?: number, offset?: number) => ipcRenderer.invoke('xsoverlay-get-notification-logs', limit, offset),
  // VRChat account linking
  sendVRChatLink: (vrchatUserId: string, vrchatUsername: string) => ipcRenderer.invoke('send-vrchat-link', vrchatUserId, vrchatUsername),
  checkVRChatLink: () => ipcRenderer.invoke('check-vrchat-link'),
  // Feedback API
  sendFeedback: (feedbackData: any) => ipcRenderer.invoke('send-feedback', feedbackData),
  getFeedbackList: () => ipcRenderer.invoke('get-feedback-list'),
  voteFeedback: (feedbackId: string) => ipcRenderer.invoke('vote-feedback', feedbackId),
  getUserFeedbackStats: () => ipcRenderer.invoke('get-user-feedback-stats'),
  getClientVersion: () => ipcRenderer.invoke('get-client-version'),
  // Debug/Diagnostics API
  getDebugStats: () => ipcRenderer.invoke('get-debug-stats'),
  clearDebugLogs: () => ipcRenderer.invoke('clear-debug-logs'),
  getMemoryStats: () => ipcRenderer.invoke('get-memory-stats'),
  forceMemoryCleanup: () => ipcRenderer.invoke('force-memory-cleanup'),
  // Error logging
  logRendererError: (error: any, context: any) => ipcRenderer.invoke('log-renderer-error', error, context),
  logRendererConsoleError: (args: any, context: any) => ipcRenderer.invoke('log-renderer-console-error', args, context),
  // Event listeners
  onOscReceived: (callback: (data: any) => void) => {
    ipcRenderer.on('osc-received', (_event, data) => callback(data))
  },
  onOscForwarded: (callback: (data: any) => void) => {
    ipcRenderer.on('osc-forwarded', (_event, data) => callback(data))
  },
  onOscReceivedBatch: (callback: (data: any) => void) => {
    ipcRenderer.on('osc-received-batch', (_event, data) => callback(data))
  },
  onOscForwardedBatch: (callback: (data: any) => void) => {
    ipcRenderer.on('osc-forwarded-batch', (_event, data) => callback(data))
  },
  onMemoryPressure: (callback: (data: any) => void) => {
    ipcRenderer.on('memory-pressure', (_event, data) => callback(data))
  },
  onOscServerStatus: (callback: (data: any) => void) => {
    ipcRenderer.on('osc-server-status', (_event, data) => callback(data))
  },
  onOscQueryStatus: (callback: (data: any) => void) => {
    ipcRenderer.on('oscquery-status', (_event, data) => callback(data))
  },
  onParameterBlocklistUpdated: (callback: (data: any) => void) => {
    ipcRenderer.on('parameter-blocklist-updated', (_event, data) => callback(data))
  },
  onParametersSuppressed: (callback: (data: any) => void) => {
    ipcRenderer.on('parameters-suppressed', (_event, data) => callback(data))
  },
  onParametersUnsuppressed: (callback: (data: any) => void) => {
    ipcRenderer.on('parameters-unsuppressed', (_event, data) => callback(data))
  },
  onUnsuppressDenied: (callback: (data: any) => void) => {
    ipcRenderer.on('unsuppress-denied', (_event, data) => callback(data))
  },
  onVRChatConnectionStatus: (callback: (data: any) => void) => {
    ipcRenderer.on('vrchat-connection-status', (_event, data) => callback(data))
  },
  onOscFlowStatus: (callback: (data: any) => void) => {
    ipcRenderer.on('osc-flow-status', (_event, data) => callback(data))
  },
  onWebSocketStatus: (callback: (data: any) => void) => {
    ipcRenderer.on('websocket-status', (_event, data) => callback(data))
  },
  onWebSocketError: (callback: (data: any) => void) => {
    ipcRenderer.on('websocket-error', (_event, data) => callback(data))
  },
  onWebSocketAuthenticated: (callback: (data: any) => void) => {
    ipcRenderer.on('websocket-authenticated', (_event, data) => callback(data))
  },
  onWebSocketOscData: (callback: (data: any) => void) => {
    ipcRenderer.on('websocket-osc-data', (_event, data) => callback(data))
  },
  onWebSocketAvatarChange: (callback: (data: any) => void) => {
    ipcRenderer.on('websocket-avatar-change', (_event, data) => callback(data))
  },
  onWebSocketParameterUpdate: (callback: (data: any) => void) => {
    ipcRenderer.on('websocket-parameter-update', (_event, data) => callback(data))
  },
  onWebSocketServerMessage: (callback: (data: any) => void) => {
    ipcRenderer.on('websocket-server-message', (_event, data) => callback(data))
  },
  onWebSocketPanelConnectionsUpdate: (callback: (data: any) => void) => {
    ipcRenderer.on('websocket-panel-connections-update', (_event, data) => callback(data))
  },
  onAppSettings: (callback: (data: any) => void) => {
    ipcRenderer.on('app-settings', (_event, data) => callback(data))
  },
  onOSCLeashMovement: (callback: (data: any) => void) => {
    ipcRenderer.on('oscleash-movement-data', (_event, data) => callback(data))
  },
  onOSCLeashStatusUpdate: (callback: (data: any) => void) => {
    ipcRenderer.on('oscleash-status-update', (_event, data) => callback(data))
  },
  onHyperateUpdate: (callback: (data: any) => void) => {
    ipcRenderer.on('hyperate-update', (_event, data) => callback(data))
  },
  onOgbStatusUpdate: (callback: (data: any) => void) => {
    ipcRenderer.on('ogb-status-update', (_event, data) => callback(data))
  },
  onAutoStatusUpdate: (callback: (data: any) => void) => {
    ipcRenderer.on('autostatus-update', (_event, data) => callback(data))
  },
  onXsOverlayStatus: (callback: (data: any) => void) => {
    ipcRenderer.on('xsoverlay-status', (_event, data) => callback(data))
  },
  onXsOverlayNotification: (callback: (data: any) => void) => {
    ipcRenderer.on('xsoverlay-notification', (_event, data) => callback(data))
  },
  onFeedbackUpdate: (callback: (data: any) => void) => {
    ipcRenderer.on('feedback-update', (_event, data) => callback(data))
  },
  onVRChatPipelineEvent: (callback: (data: any) => void) => {
    ipcRenderer.on('vrchatapi-pipeline-event', (_event, data) => callback(data))
  },
  onSplashProgress: (callback: (data: any) => void) => {
    ipcRenderer.on('splash-progress', (_event, data) => callback(data))
  },
  removeAllListeners: (channel: string) => {
    ipcRenderer.removeAllListeners(channel)
  },
  // Shell and clipboard API for VRC Timeline
  openExternal: (url: string) => ipcRenderer.invoke('shell-open-external', url),
  clipboardWriteText: (text: string) => ipcRenderer.invoke('clipboard-write-text', text)
}
contextBridge.exposeInMainWorld('electronAPI', api)
export type ElectronAPI = typeof api
