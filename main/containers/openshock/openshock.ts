import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import debug from '../../services/debugger'
import configManager from '../../services/configManager'

interface OpenShockSecrets {
  openshock?: { apiToken: string; baseUrl?: string }
}

interface ShockerModel {
  id: string
  name: string
  rfid: string
  createdOn: string
  model: string
  isPaused: boolean
}

interface DeviceWithShockers {
  id: string
  name: string
  createdOn: string
  shockers: ShockerModel[]
}

interface SharedShockerOwner {
  id: string
  name: string
  image: string
  devices: { id: string; name: string; shockers: ShockerPermissions[] }[]
}

interface ShockerPermissions {
  id: string
  name: string
  isPaused: boolean
  permissions: { vibrate: boolean; sound: boolean; shock: boolean; live: boolean }
  limits: { intensity: number; duration: number }
}

interface ShareInfo {
  paused: boolean
  sharedWith: { name: string; id: string; image: string }
  createdOn: string
  permissions: { vibrate: boolean; sound: boolean; shock: boolean; live: boolean }
  limits: { intensity: number; duration: number }
}

interface TokenResponse {
  id: string
  name: string
  createdAt: string
  lastUsedAt: string
  permissions: { shockers: { use: boolean; edit: boolean; pause: boolean }; devices: { edit: boolean; auth: boolean }; users: { delete: boolean } }
}

interface LogEntry {
  id: string
  shockerId: string
  sender: { id: string; name: string; image: string }
  controlType: string
  intensity: number
  duration: number
  timestamp: string
}

const API_PATHS = {
  SHOCKERS_OWN: '/1/shockers/own',
  SHOCKERS_SHARED: '/1/shockers/shared',
  SHOCKERS_CONTROL: '/2/shockers/control',
  SHOCKERS_LOGS: '/1/shockers',
  TOKENS: '/1/tokens',
  DEVICES: '/1/devices',
  VERSION: '/1'
} as const

class OpenShock {
  enabled: boolean
  connected: boolean
  apiToken: string | null
  baseUrl: string
  devices: DeviceWithShockers[]
  sharedShockers: SharedShockerOwner[]
  onStatusChange: ((status: Record<string, unknown>) => void) | null
  onDeviceUpdate: ((devices: DeviceWithShockers[]) => void) | null
  private secrets: OpenShockSecrets | null
  private closing: boolean
  private sessionCookie: string | null
  private loggedInUsername: string | null

  constructor() {
    this.enabled = false
    this.connected = false
    this.apiToken = null
    this.baseUrl = 'https://api.openshock.app'
    this.devices = []
    this.sharedShockers = []
    this.onStatusChange = null
    this.onDeviceUpdate = null
    this.secrets = null
    this.closing = false
    this.sessionCookie = null
    this.loggedInUsername = null
    debug.info('OpenShock container initialized')
  }

  async init(): Promise<void> {
    // Priority: saved encrypted token > secrets.json
    const savedToken = configManager.getSavedOpenShockToken()
    if (savedToken) {
      this.apiToken = savedToken
      debug.info('OpenShock: API token loaded from saved config')
    }
    this.secrets = this.loadSecrets()
    if (!this.apiToken && this.secrets?.openshock?.apiToken) {
      this.apiToken = this.secrets.openshock.apiToken
      debug.info('OpenShock: API token loaded from secrets.json')
    }
    if (this.secrets?.openshock?.baseUrl) {
      this.baseUrl = this.secrets.openshock.baseUrl
    }
    // Load saved session cookie for public share links
    const savedSessionCookie = configManager.getSavedOpenShockSessionCookie()
    if (savedSessionCookie) {
      this.sessionCookie = savedSessionCookie
      this.loggedInUsername = configManager.getOpenShockSessionUsername() || null
      debug.info('OpenShock: Session cookie loaded from saved config')
    }
    if (!this.apiToken) {
      debug.info('OpenShock: No API token found (not configured)')
      return
    }
    // Auto-connect with saved token (fire-and-forget; page polls status)
    this.autoConnect()
  }

  private async autoConnect(): Promise<void> {
    if (this.connected || this.closing) return
    this.enabled = true
    try {
      await this.listOwnShockers()
      this.connected = true
      debug.info('OpenShock: Auto-connected with saved token')
      this.notifyStatusChange()
    } catch (error: unknown) {
      this.connected = false
      debug.warn(`OpenShock: Auto-connect failed (token may be invalid) - ${(error as Error).message}`)
      this.notifyStatusChange()
    }
  }

  private loadSecrets(): OpenShockSecrets | null {
    const candidatePaths = [
      path.join(process.cwd(), 'secrets.json'),
      path.join(app.getAppPath(), 'secrets.json'),
      path.resolve(__dirname, '..', '..', '..', 'secrets.json')
    ]
    for (const secretsPath of [...new Set(candidatePaths)]) {
      try {
        if (!fs.existsSync(secretsPath)) continue
        const secrets = JSON.parse(fs.readFileSync(secretsPath, 'utf8'))
        if (secrets.openshock?.apiToken) return secrets
      } catch (error: unknown) {
        debug.warn(`OpenShock: Failed to read secrets from ${secretsPath}: ${(error as Error).message}`)
      }
    }
    return null
  }

  private async fetchApi<T>(urlPath: string, method: 'GET' | 'POST' | 'PATCH' | 'DELETE' = 'GET', body?: unknown, options?: { useCookie?: boolean }): Promise<T> {
    const url = `${this.baseUrl}${urlPath}`
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (options?.useCookie && this.sessionCookie) {
      headers['Cookie'] = `openshock_session=${this.sessionCookie}`
    } else if (this.apiToken) {
      headers['OpenShockToken'] = this.apiToken
    }
    const init: RequestInit = { method, headers }
    if (body !== undefined) {
      init.body = JSON.stringify(body)
    }
    const res = await fetch(url, init)
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`OpenShock API ${res.status}: ${text}`)
    }
    const json = await res.json() as { data?: T; message?: string }
    return (json.data ?? json) as T
  }

  getStatus(): { enabled: boolean; connected: boolean; hasApiToken: boolean; deviceCount: number; baseUrl: string; loggedIn: boolean; loggedInUsername: string | null } {
    return {
      enabled: this.enabled,
      connected: this.connected,
      hasApiToken: !!this.apiToken,
      deviceCount: this.devices.length,
      baseUrl: this.baseUrl,
      loggedIn: !!this.sessionCookie,
      loggedInUsername: this.loggedInUsername
    }
  }

  async listOwnShockers(): Promise<DeviceWithShockers[]> {
    this.devices = await this.fetchApi<DeviceWithShockers[]>(API_PATHS.SHOCKERS_OWN)
    this.notifyDeviceUpdate()
    return this.devices
  }

  async listSharedShockers(): Promise<SharedShockerOwner[]> {
    this.sharedShockers = await this.fetchApi<SharedShockerOwner[]>(API_PATHS.SHOCKERS_SHARED)
    return this.sharedShockers
  }

  async createShareCode(
    shockerId: string,
    permissions: { shock: boolean; vibrate: boolean; sound: boolean; live: boolean },
    limits: { intensity: number; duration: number }
  ): Promise<{ success: boolean; url?: string; shareCode?: string; error?: string; sessionExpired?: boolean }> {
    // Build the frontend URL
    let frontendUrl = 'https://openshock.app'
    try {
      const meta = await this.fetchApi<{ frontendUrl: string }>(API_PATHS.VERSION)
      if (meta.frontendUrl) frontendUrl = meta.frontendUrl
    } catch { /* use default */ }
    // If we have a session cookie, try public share creation
    if (this.sessionCookie) {
      try {
        const publicShareId = await this.fetchApi<string>(
          '/1/shares/links',
          'POST',
          { name: 'ARC-Client Share', expiresOn: null },
          { useCookie: true }
        )
        await this.fetchApi(
          `/1/shares/links/${publicShareId}/${shockerId}`,
          'POST',
          undefined,
          { useCookie: true }
        )
        const shareUrl = `${frontendUrl}/s/${publicShareId}`
        debug.info(`OpenShock: Public share link created for ${shockerId}: ${shareUrl}`)
        return { success: true, url: shareUrl }
      } catch (publicErr: unknown) {
        const errMsg = (publicErr as Error).message
        debug.warn(`OpenShock: Public share creation failed (${errMsg})`)
        if (errMsg.includes('401')) {
          this.sessionCookie = null
          this.loggedInUsername = null
          configManager.setSavedOpenShockSessionCookie('')
          configManager.setOpenShockSessionUsername('')
          return { success: false, sessionExpired: true, error: 'Session expired — please log in again' }
        }
      }
    }
    // Fallback: create a share code (claimable by another user via WebUI)
    try {
      const codeId = await this.fetchApi<string>(
        `/1/shockers/${shockerId}/shares`,
        'POST',
        { permissions, limits }
      )
      debug.info(`OpenShock: Share code created for ${shockerId}: ${codeId}`)
      return { success: true, shareCode: codeId }
    } catch (err: unknown) {
      return { success: false, error: (err as Error).message }
    }
  }

  async sendControl(
    shocks: Array<{ id: string; type: 'Shock' | 'Vibrate' | 'Sound' | 'Stop'; intensity?: number; duration?: number }>
  ): Promise<void> {
    await this.fetchApi(API_PATHS.SHOCKERS_CONTROL, 'POST', { shocks, customName: 'ARC-Client' })
    debug.info(`OpenShock: Control sent to ${shocks.length} shocker(s)`)
  }

  async pauseShocker(shockerId: string, pause: boolean): Promise<boolean> {
    return this.fetchApi<boolean>(`/1/shockers/${shockerId}/pause`, 'POST', { pause })
  }

  async listShockerShares(shockerId: string): Promise<ShareInfo[]> {
    return this.fetchApi<ShareInfo[]>(`/1/shockers/${shockerId}/shares`)
  }

  async deleteShareCode(shockerId: string, sharedWithUserId: string): Promise<void> {
    await this.fetchApi(`/1/shockers/${shockerId}/shares/${sharedWithUserId}`, 'DELETE')
    debug.info(`OpenShock: Share removed for ${shockerId}`)
  }

  async pauseShare(shockerId: string, sharedWithUserId: string, pause: boolean): Promise<boolean> {
    return this.fetchApi<boolean>(`/1/shockers/${shockerId}/shares/${sharedWithUserId}/pause`, 'POST', { pause })
  }

  async listTokens(): Promise<TokenResponse[]> {
    return this.fetchApi<TokenResponse[]>(API_PATHS.TOKENS)
  }

  async createToken(name: string, permissions: Record<string, boolean>): Promise<{ id: string; token: string }> {
    return this.fetchApi<{ id: string; token: string }>(API_PATHS.TOKENS, 'POST', { name, permissions })
  }

  async deleteToken(tokenId: string): Promise<void> {
    await this.fetchApi(`/1/tokens/${tokenId}`, 'DELETE')
    debug.info(`OpenShock: Token ${tokenId} deleted`)
  }

  async getShockerLogs(shockerId: string, page = 1, size = 20): Promise<LogEntry[]> {
    return this.fetchApi<LogEntry[]>(`/1/shockers/${shockerId}/logs?page=${page}&size=${size}`)
  }

  async getServerVersion(): Promise<{ version: string; frontendUrl: string; shortLinkUrl: string }> {
    return this.fetchApi<{ version: string; frontendUrl: string; shortLinkUrl: string }>(API_PATHS.VERSION)
  }

  // -- Session cookie auth (for public share links) --
  async loginWithCredentials(email: string, password: string): Promise<{ success: boolean; username?: string; error?: string }> {
    const url = `${this.baseUrl}/1/account/login`
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        try {
          const problem = JSON.parse(text) as { title?: string; message?: string; type?: string }
          if (problem.title === 'AccountOAuthOnly' || (problem.type && problem.type.includes('OAuthOnly'))) {
            return { success: false, error: 'This account uses OAuth login (Discord/Google). Please log in via the OpenShock website and create an API token instead.' }
          }
          return { success: false, error: problem.message || problem.title || `Login failed (${res.status})` }
        } catch {
          return { success: false, error: `Login failed (${res.status})` }
        }
      }
      // Extract session cookie from Set-Cookie header
      const setCookieHeader = res.headers.get('Set-Cookie') || ''
      const sessionMatch = setCookieHeader.match(/openshock_session=([^;]+)/)
      if (!sessionMatch) {
        return { success: false, error: 'Login succeeded but session cookie not found in response' }
      }
      this.sessionCookie = sessionMatch[1]
      this.loggedInUsername = email
      configManager.setSavedOpenShockSessionCookie(sessionMatch[1])
      configManager.setOpenShockSessionUsername(email)
      debug.info(`OpenShock: Logged in as ${email}`)
      return { success: true, username: email }
    } catch (err: unknown) {
      return { success: false, error: (err as Error).message }
    }
  }
  async logout(): Promise<{ success: boolean }> {
    if (this.sessionCookie) {
      try {
        await fetch(`${this.baseUrl}/1/account/logout`, {
          method: 'POST',
          headers: { Cookie: `openshock_session=${this.sessionCookie}` }
        })
      } catch { /* ignore — best-effort server-side logout */ }
    }
    this.sessionCookie = null
    this.loggedInUsername = null
    configManager.setSavedOpenShockSessionCookie('')
    configManager.setOpenShockSessionUsername('')
    debug.info('OpenShock: Logged out')
    return { success: true }
  }
  getLoginStatus(): { loggedIn: boolean; username: string | null } {
    return { loggedIn: !!this.sessionCookie, username: this.loggedInUsername }
  }
  notifyStatusChange(): void {
    if (this.closing) return
    if (typeof this.onStatusChange === 'function') {
      this.onStatusChange(this.getStatus())
    }
  }

  notifyDeviceUpdate(): void {
    if (this.closing) return
    if (typeof this.onDeviceUpdate === 'function') {
      this.onDeviceUpdate(this.devices)
    }
  }

  async start(apiToken: string): Promise<{ success: boolean; error?: string }> {
    if (this.closing) return { success: false, error: 'Container is shutting down' }
    this.apiToken = apiToken
    this.enabled = true
    try {
      await this.listOwnShockers()
      this.connected = true
      // Persist token encrypted for next launch
      configManager.setSavedOpenShockToken(apiToken)
      debug.info('OpenShock: Connected and token saved')
      this.notifyStatusChange()
      return { success: true }
    } catch (error: unknown) {
      this.connected = false
      debug.error(`OpenShock: Connect failed - ${(error as Error).message}`)
      this.notifyStatusChange()
      return { success: false, error: (error as Error).message }
    }
  }

  async stop(): Promise<{ success: boolean }> {
    this.enabled = false
    this.connected = false
    this.devices = []
    debug.info('OpenShock: Disconnected')
    this.notifyStatusChange()
    return { success: true }
  }

  clearSavedToken(): boolean {
    this.apiToken = null
    debug.info('OpenShock: Saved token cleared')
    return configManager.setSavedOpenShockToken('')
  }

  async close(): Promise<void> {
    this.closing = true
    await this.stop()
    debug.info('OpenShock container closed')
  }
}

export default OpenShock
