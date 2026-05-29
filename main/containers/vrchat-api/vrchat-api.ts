import debug from '../../services/debugger'
import configManager from '../../services/configManager'
import { VRChat } from 'vrchat'
import { app } from 'electron'
import { encryptData, decryptData } from '../../services/encryption'

interface VRCApiConfig {
  enabled: boolean
  authToken: string | null
  twoFactorToken: string | null
}

interface VRCUser {
  id: string
  displayName: string
  username: string
  status?: string
  statusDescription?: string
  [key: string]: unknown
}

interface CookieEntry {
  name: string
  value: string
  domain: string
  path: string
  secure: boolean
  httpOnly: boolean
  expires: number
  options: Record<string, string>
}

class VRChatAPIContainer {
  enabled: boolean
  authenticated: boolean
  currentUser: VRCUser | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  apiClient: any
  config: VRCApiConfig
  twoFactorResolver: ((code: string) => void) | null
  loginPromise: Promise<unknown> | null
  readonly PIPELINE_HEALTH_CHECK_INTERVAL_MS: number
  readonly PIPELINE_QUICK_RECONNECT_MS: number
  readonly PIPELINE_500_BACKOFF_MS: number
  pipelineConnected: boolean
  pipelineReconnecting: boolean
  pipelineReconnectTimeout: ReturnType<typeof setTimeout> | null
  pipelineBackoffUntil: number
  pipelineListenersSetup: boolean
  handlePipelineClose: (() => void) | null
  handlePipelineError: ((event: unknown) => void) | null
  cookieStore: Map<string, unknown>
  onPipelineEvent: ((type: string, data: unknown) => void) | null
  _statusChangeTimestamps: number[]

  constructor() {
    this.enabled = false
    this.authenticated = false
    this.currentUser = null
    this.apiClient = null
    this.config = this.loadConfig()
    this.twoFactorResolver = null
    this.loginPromise = null
    this.PIPELINE_HEALTH_CHECK_INTERVAL_MS = 30000
    this.PIPELINE_QUICK_RECONNECT_MS = 5000
    this.PIPELINE_500_BACKOFF_MS = 180000
    this.pipelineConnected = false
    this.pipelineReconnecting = false
    this.pipelineReconnectTimeout = null
    this.pipelineBackoffUntil = 0
    this.pipelineListenersSetup = false
    this.handlePipelineClose = null
    this.handlePipelineError = null
    this.cookieStore = new Map()
    this.onPipelineEvent = null
    this._statusChangeTimestamps = []
    this.initializeClient()
    debug.info('VRChat API container initialized')
  }
  /**
   * Initialize the VRChat API client with application info and restore saved session.
   */
  initializeClient(): void {
    const appVersion = app.getVersion()
    const appName = 'ARC-OSC-Client'
    const cookieStore = new Map()
    
    // Restore encrypted session tokens
    this.restoreCookies(cookieStore)
    
    // Create keyv-compatible adapter
    const keyvAdapter = {
      get: async (key: string) => cookieStore.get(key),
      set: async (key: string, value: unknown) => cookieStore.set(key, value),
      delete: async (key: string) => cookieStore.delete(key),
      clear: async () => cookieStore.clear()
    }
    
    this.apiClient = new VRChat({
      application: {
        name: appName,
        version: appVersion,
        contact: 'https://github.com/ComfyChloe/ARC-Client'
      },
      authentication: { optimistic: false },
      keyv: keyvAdapter as any,
      verbose: false
    })
    
    this.cookieStore = cookieStore
    debug.info(`VRChat API client initialized (${appName} v${appVersion})`)
  }

  /**
   * Restores encrypted cookies from config into cookie store.
   */
  restoreCookies(cookieStore: Map<string, unknown>): void {
    if (!this.config.authToken && !this.config.twoFactorToken) return
    
    const cookieArray = []
    const createCookie = (name: string, value: string, maxAge: number) => ({
      name,
      value,
      domain: 'api.vrchat.cloud',
      path: '/',
      secure: true,
      httpOnly: true,
      expires: Date.now() + (maxAge * 1000),
      options: { 'max-age': String(maxAge), path: '/', samesite: 'Lax' }
    })
    
    // Decrypt and restore auth cookie
    if (this.config.authToken) {
      const decryptedAuth = decryptData(this.config.authToken)
      if (decryptedAuth) {
        cookieArray.push(createCookie('auth', decryptedAuth, 31556952)); // 1 year
      } else {
        this.config.authToken = null
        this.config.twoFactorToken = null
        this.saveConfig()
        return
      }
    }
    
    // Decrypt and restore twoFactorAuth cookie
    if (this.config.twoFactorToken) {
      const decryptedTwoFactor = decryptData(this.config.twoFactorToken)
      if (decryptedTwoFactor) {
        cookieArray.push(createCookie('twoFactorAuth', decryptedTwoFactor, 2592000)); // 30 days
      }
    }
    
    if (cookieArray.length > 0) {
      cookieStore.set('keyv:cookies', JSON.stringify({ value: cookieArray }))
    }
  }
  loadConfig(): VRCApiConfig {
    return configManager.getVRChatAPIConfig() || { enabled: false, authToken: null, twoFactorToken: null }
  }
  saveConfig(): void {
    const cookies = this.extractCookies()
    configManager.updateVRChatAPIConfig({
      enabled: this.enabled,
      authToken: cookies.auth,
      twoFactorToken: cookies.twoFactor
    })
  }

  /**
   * Extracts and encrypts cookies from cookie store.
   */
  extractCookies(): { auth: string | null, twoFactor: string | null } {
    if (!this.cookieStore?.has('keyv:cookies')) {
      return { auth: null, twoFactor: null }
    }
    
    const cookieData = this.cookieStore.get('keyv:cookies')
    const cookieArray = this.parseCookieData(cookieData)
    
    if (!Array.isArray(cookieArray)) {
      return { auth: null, twoFactor: null }
    }
    
    const authCookie = cookieArray.find(c => c.name === 'auth')
    const twoFactorCookie = cookieArray.find(c => c.name === 'twoFactorAuth')
    
    return {
      auth: authCookie?.value ? encryptData(authCookie.value) : null,
      twoFactor: twoFactorCookie?.value ? encryptData(twoFactorCookie.value) : null
    }
  }

  /**
   * Parses cookie data from various formats.
   */
  parseCookieData(cookieData: unknown): CookieEntry[] | null {
    if (Array.isArray(cookieData)) return cookieData
    if (typeof cookieData !== 'string') return null
    
    try {
      const parsed = JSON.parse(cookieData)
      if (Array.isArray(parsed)) return parsed
      if (parsed?.value && Array.isArray(parsed.value)) return parsed.value
      if (parsed?.val && Array.isArray(parsed.val)) return parsed.val
    } catch {
      return null
    }
    
    return null
  }
  /**
   * Clears saved session cookies and tokens.
   */
  clearCookies(): void {
    this.cookieStore?.clear()
    this.config.authToken = null
    this.config.twoFactorToken = null
    this.saveConfig()
  }

  isEnabled(): boolean {
    return this.enabled
  }

  isAuthenticated(): boolean {
    return this.authenticated
  }

  getStatus(): Record<string, unknown> {
    return {
      enabled: this.enabled,
      authenticated: this.authenticated,
      currentUser: this.currentUser ? {
        id: this.currentUser.id,
        displayName: this.currentUser.displayName,
        username: this.currentUser.username,
        status: this.currentUser.status ?? null,
        statusDescription: this.currentUser.statusDescription ?? null
      } : null,
      hasSavedSession: !!(this.config?.authToken || this.config?.twoFactorToken),
      pipelineConnected: this.pipelineConnected
    }
  }

  getCurrentUserStatus(): { status: string | null, statusDescription: string | null } {
    return {
      status: this.currentUser?.status ?? null,
      statusDescription: this.currentUser?.statusDescription ?? null
    }
  }

  /**
   * Authenticates with username and password.
   * @returns {Object} Result with success status, user data, or 2FA requirements
   */
  async login(username: string, password: string): Promise<Record<string, unknown>> {
    try {
      this.clearCookies()
      this.initializeClient()

      let twoFactorRequested = false

      this.loginPromise = this.apiClient.login({
        username,
        password,
        twoFactorCode: async () => {
          twoFactorRequested = true
          return new Promise(resolve => { this.twoFactorResolver = resolve; })
        }
      })

      // Wait for 2FA callback or login completion
      await Promise.race([
        this.loginPromise!.then(() => 'completed'),
        new Promise(resolve => setTimeout(() => resolve('timeout'), 2000))
      ])

      if (!twoFactorRequested) {
        await new Promise(resolve => setTimeout(resolve, 100))
      }

      if (twoFactorRequested && this.twoFactorResolver) {
        return { success: false, requires2FA: true, twoFactorMethods: ['totp', 'emailOtp'] }
      }

      const result: any = await this.loginPromise
      this.loginPromise = null

      if (result.data) {
        return this.completeLogin(result.data)
      }

      if (result.error?.requiresTwoFactorAuth?.length > 0) {
        return { success: false, requires2FA: true, twoFactorMethods: result.error.requiresTwoFactorAuth }
      }

      return { success: false, requires2FA: false, error: result.error?.message || 'Authentication failed' }
    } catch (error: unknown) {
      this.loginPromise = null
      const err = error as any

      if (err.response?.data?.requiresTwoFactorAuth) {
        return { success: false, requires2FA: true, twoFactorMethods: err.response.data.requiresTwoFactorAuth }
      }

      const errorMessage = err.response?.data?.error?.message || err.response?.data?.message || err.message
      return { success: false, requires2FA: false, error: errorMessage }
    }
  }

  /**
   * Completes login after successful authentication.
   */
  async completeLogin(userData: VRCUser): Promise<Record<string, unknown>> {
    this.authenticated = true
    this.currentUser = userData
    this.enabled = true
    this.twoFactorResolver = null

    this.connectPipeline().catch((error: unknown) => {
      debug.warn(`Failed to connect pipeline after login: ${(error as Error).message}`)
    })
    await new Promise(resolve => setTimeout(resolve, 100))
    this.saveConfig()

    debug.info(`VRChat API login successful for user: ${userData.displayName}`)
    return { success: true, user: userData }
  }

  /**
   * Verifies 2FA code for pending login.
   * @returns {Object} Result with success status and user data
   */
  async verify2FA(code: string): Promise<Record<string, unknown>> {
    try {
      if (!this.twoFactorResolver || !this.loginPromise) {
        return { success: false, error: 'No pending 2FA authentication' }
      }

      this.twoFactorResolver(code)
      this.twoFactorResolver = null

      const result: any = await this.loginPromise
      this.loginPromise = null

      if (result.data) {
        return this.completeLogin(result.data)
      }

      return {
        success: false,
        error: result.error?.message || '2FA verification failed'
      }
    } catch (error: unknown) {
      this.loginPromise = null
      this.twoFactorResolver = null
      const err = error as any

      const errorMessage = err.response?.data?.error?.message || err.response?.data?.message || err.message
      return { success: false, error: errorMessage }
    }
  }

  /**
   * Stops the container without clearing session.
   */
  stop(): void {
    this.clearPipelineReconnectTimeout()
    debug.info('VRChat API container stopped')
  }

  /**
   * Logs out and clears session.
   */
  async logout(): Promise<{ success: boolean }> {
    this.clearPipelineReconnectTimeout()

    if (this.apiClient && this.authenticated) {
      try {
        await this.apiClient.logout()
      } catch (error: unknown) {
        debug.warn(`Logout API call failed: ${(error as Error).message}`)
      }
    }

    this.authenticated = false
    this.currentUser = null
    this.twoFactorResolver = null
    this.loginPromise = null

    this.clearCookies()
    this.initializeClient()

    debug.info('VRChat API logout complete')
    return { success: true }
  }

  /**
   * Attempts to restore session from saved encrypted tokens.
   */
  async restoreSession(): Promise<Record<string, unknown>> {
    if (!this.config?.authToken && !this.config?.twoFactorToken) {
      return { success: false, error: 'No saved session' }
    }

    try {
      const result = await this.apiClient.getCurrentUser()

      if (result.data?.id) {
        this.currentUser = result.data
        this.authenticated = true
        this.connectPipeline().catch((error: unknown) => {
          debug.warn(`Failed to connect pipeline after restore: ${(error as Error).message}`)
        })

        debug.info(`Successfully restored VRChat API session for user: ${result.data.displayName}`)
        return {
          success: true,
          user: {
            id: result.data.id,
            displayName: result.data.displayName,
            username: result.data.username
          }
        }
      }

      const statusCode = result.response?.status || result.error?.statusCode
      if (statusCode === 401 || statusCode === 403) {
        this.clearCookies()
      }

      return { success: false, error: 'Invalid session' }
    } catch (error: unknown) {
      const err = error as any
      const statusCode = err.response?.status || err.statusCode

      if (statusCode === 401 || statusCode === 403) {
        this.clearCookies()
      }

      return { success: false, error: (error as Error).message }
    }
  }

  /**
   * Gets account statistics (uploaded avatars, favorited avatars, friends online).
   */
  async getStats(): Promise<Record<string, unknown>> {
    if (!this.authenticated || !this.apiClient) {
      return { success: false, error: 'Not authenticated' }
    }

    try {
      const [avatarsResult, friendsResult, favoriteGroupsResult] = await Promise.all([
        this.apiClient.searchAvatars({ query: { user: 'me', n: 100, releaseStatus: 'all' } }).catch((e: unknown) => ({ error: e })),
        this.apiClient.getFriends({ query: { offline: false } }).catch((e: unknown) => ({ error: e })),
        this.apiClient.getFavoriteGroups().catch((e: unknown) => ({ error: e }))
      ])

      // Count favorited avatars across all favorite groups
      let favoritedAvatars = 0
      if (Array.isArray(favoriteGroupsResult.data)) {
        const avatarGroups = favoriteGroupsResult.data.filter((g: any) => g.type === 'avatar')
        
        // Fetch favorites for each avatar group
        for (const group of avatarGroups) {
          try {
            const favs = await this.apiClient.getFavorites({ 
              query: { type: 'avatar', n: 100, tag: group.name } 
            })
            favoritedAvatars += Array.isArray(favs.data) ? favs.data.length : 0
          } catch (error: unknown) {
            console.error(`Error fetching favorites for group ${group.name}:`, (error as Error).message)
          }
        }
      }

      return {
        success: true,
        uploadedAvatars: Array.isArray(avatarsResult.data) ? avatarsResult.data.length : 0,
        favoritedAvatars,
        friendsOnline: Array.isArray(friendsResult.data) ? friendsResult.data.length : 0
      }
    } catch (error: unknown) {
      return { success: false, error: (error as Error).message }
    }
  }

  /**
   * Sets the user's VRChat status type and/or status message.
   * @param {string|null} status - One of: 'active', 'join me', 'ask me', 'busy', or null to keep current
   * @param {string|null} statusDescription - Status message (max 32 chars), or null to keep current
   * @returns {Object} Result with success status, previous/new values
   */
  async setStatus(status: string | null, statusDescription: string | null): Promise<Record<string, unknown>> {
    if (!this.authenticated || !this.apiClient || !this.currentUser) {
      return { success: false, error: 'Not authenticated' }
    }
    // Rate limiting: max 6 status changes per minute
    const now = Date.now()
    if (!this._statusChangeTimestamps) this._statusChangeTimestamps = []
    this._statusChangeTimestamps = this._statusChangeTimestamps.filter(t => now - t < 60000)
    if (this._statusChangeTimestamps.length >= 6) {
      return { success: false, error: 'Rate limit exceeded (max 6 status changes per minute)' }
    }
    // Validate status type
    const validStatuses = ['active', 'join me', 'ask me', 'busy']
    if (status !== null && !validStatuses.includes(status)) {
      return { success: false, error: `Invalid status type: ${status}` }
    }
    // Sanitize status description
    if (statusDescription !== null) {
      statusDescription = String(statusDescription).replace(/\s+/g, ' ').trim().slice(0, 32)
    }
    const previousStatus = this.currentUser.status
    const previousStatusDescription = this.currentUser.statusDescription
    // Build update body with only changed fields
    const body: Record<string, string> = {}
    if (status !== null) body.status = status
    if (statusDescription !== null) body.statusDescription = statusDescription
    if (Object.keys(body).length === 0) {
      return { success: false, error: 'No changes specified' }
    }
    try {
      const result = await this.apiClient.updateUser({
        path: { userId: this.currentUser.id },
        body
      })
      if (result.data) {
        this.currentUser = result.data
        this._statusChangeTimestamps.push(now)
        debug.info(`VRChat status updated: ${status || '(unchanged)'} - "${statusDescription || '(unchanged)'}"`)
        return {
          success: true,
          previousStatus,
          previousStatusDescription,
          newStatus: result.data.status,
          newStatusDescription: result.data.statusDescription
        }
      }
      return { success: false, error: 'Update returned no data' }
    } catch (error: unknown) {
      const err = error as any
      const errorMessage = err.response?.data?.error?.message || err.message
      debug.error(`Failed to update VRChat status: ${errorMessage}`)
      return { success: false, error: errorMessage }
    }
  }

  /**
   * Connect to VRChat WebSocket pipeline for real-time events.
   */
  async connectPipeline(): Promise<void> {
    if (!this.apiClient) {
      return
    }

    try {
      // Extract auth token from cookie store or config
      let authToken = null

      // Try cookie store first
      if (this.cookieStore?.has('keyv:cookies')) {
        const cookieData = this.cookieStore.get('keyv:cookies')
        const cookieArray = this.parseCookieData(cookieData)
        const authCookie = cookieArray?.find(c => c.name === 'auth')
        if (authCookie?.value) {
          authToken = authCookie.value
        }
      }

      // Fallback to config's encrypted token
      if (!authToken && this.config?.authToken) {
        authToken = decryptData(this.config.authToken)
      }

      if (!authToken) {
        debug.warn('No auth token available for pipeline connection')
        return
      }

      // Connect the WebSocket pipeline
      await this.apiClient.pipeline.authenticate(authToken)
      this.pipelineConnected = this.apiClient.pipeline.connected
      debug.info('WebSocket pipeline connected successfully')

      // Attach close/error handlers for immediate disconnect detection
      this.attachPipelineWebsocketHandlers()

      // Set up event listeners for real-time updates
      this.setupPipelineListeners()
    } catch (error: unknown) {
      this.pipelineConnected = false
      debug.error(`Failed to connect WebSocket pipeline: ${(error as Error).message}`)
      throw error // Re-throw so reconnection logic can handle it
    }
  }

  /**
   * Set up WebSocket pipeline event listeners.
   */
  setupPipelineListeners(): void {
    if (!this.apiClient || this.pipelineListenersSetup) {
      return
    }

    // Listen for friend online events
    this.apiClient.on('friend-online', (data: any) => {
      // Emit event that main.js can forward to renderer
      if (this.onPipelineEvent) {
        this.onPipelineEvent('friend-online', data)
      }
    })

    // Listen for friend offline events
    this.apiClient.on('friend-offline', (data: any) => {
      if (this.onPipelineEvent) {
        this.onPipelineEvent('friend-offline', data)
      }
    })

    // Listen for notifications
    this.apiClient.on('notification', (data: any) => {
      debug.info(`Pipeline: Notification - ${data.type}`)
      if (this.onPipelineEvent) {
        this.onPipelineEvent('notification', data)
      }
    })

    // Listen for user updates
    this.apiClient.on('user-update', (data: any) => {
      debug.info(`Pipeline: User update - ${data.userId}`)
      const normalizedUser = this.normalizePipelineUserUpdate(data)
      if (normalizedUser && this.currentUser && normalizedUser.id === this.currentUser.id) {
        this.currentUser = { ...this.currentUser, ...normalizedUser } as VRCUser
      }
      if (this.onPipelineEvent) {
        this.onPipelineEvent('user-update', {
          ...data,
          user: normalizedUser
        })
      }
    })

    // Start pipeline health monitoring
    this.startPipelineHealthCheck()

    this.pipelineListenersSetup = true
    debug.info('WebSocket pipeline event listeners configured')
  }

  /**
   * Attach close/error handlers to the underlying pipeline websocket
   * This provides immediate disconnect detection rather than waiting for health checks
   */
  attachPipelineWebsocketHandlers(): void {
    if (!this.apiClient) return

    const pipeline = this.apiClient.pipeline
    const websocket = pipeline?.websocket

    if (!websocket) {
      debug.warn('Could not access pipeline websocket for close handler')
      return
    }

    // Remove any existing listeners to avoid duplicates on reconnect
    if (this.handlePipelineClose) {
      websocket.removeEventListener?.('close', this.handlePipelineClose)
    }
    if (this.handlePipelineError) {
      websocket.removeEventListener?.('error', this.handlePipelineError)
    }

    // Add close handler for immediate reconnection
    this.handlePipelineClose = () => {
      debug.warn('Pipeline WebSocket closed unexpectedly')
      this.pipelineConnected = false
      if (this.authenticated && !this.pipelineReconnecting) {
        this.schedulePipelineReconnect(this.PIPELINE_QUICK_RECONNECT_MS)
      }
    }

    // Add error handler for logging
    this.handlePipelineError = (event: any) => {
      const errorMsg = event?.message || event?.error?.message || 'Unknown error'
      debug.error(`Pipeline WebSocket error: ${errorMsg}`)
    }

    websocket.addEventListener('close', this.handlePipelineClose)
    websocket.addEventListener('error', this.handlePipelineError)
    debug.info('Pipeline WebSocket close/error handlers attached')
  }

  /**
   * Monitor pipeline connection and reconnect if needed.
   * Serves as a backup to the close event handlers.
   */
  startPipelineHealthCheck(): void {
    const checkHealth = () => {
      if (!this.authenticated) {
        return
      }
      if (this.apiClient && !this.apiClient.pipeline.connected) {
        this.pipelineConnected = false
        //debug.warn('Pipeline health check: disconnected, scheduling reconnect')
        this.schedulePipelineReconnect(this.PIPELINE_QUICK_RECONNECT_MS)
      } else {
        this.pipelineConnected = this.apiClient?.pipeline.connected || false
        //debug.debug('Pipeline health check: connected')
        // Schedule next health check
        this.pipelineReconnectTimeout = setTimeout(checkHealth, this.PIPELINE_HEALTH_CHECK_INTERVAL_MS)
      }
    }
    // Start the first health check after the interval
    this.pipelineReconnectTimeout = setTimeout(checkHealth, this.PIPELINE_HEALTH_CHECK_INTERVAL_MS)
  }

  /**
   * Schedule a pipeline reconnection attempt.
   */
  schedulePipelineReconnect(delayMs: number = this.PIPELINE_HEALTH_CHECK_INTERVAL_MS): void {
    this.clearPipelineReconnectTimeout()
    if (this.pipelineReconnecting) return
    this.pipelineReconnectTimeout = setTimeout(() => {
      this.attemptPipelineReconnect().catch((error: unknown) => {
        debug.error(`Pipeline reconnect error: ${(error as Error).message}`)
      })
    }, delayMs)
    debug.info(`Pipeline reconnect scheduled in ${delayMs / 1000}s`)
  }

  /**
   * Clear pipeline reconnection timeout.
   */
  clearPipelineReconnectTimeout(): void {
    if (this.pipelineReconnectTimeout) {
      clearTimeout(this.pipelineReconnectTimeout)
      this.pipelineReconnectTimeout = null
    }
  }

  /**
   * Attempt to reconnect the pipeline.
   */
  async attemptPipelineReconnect(): Promise<void> {
    if (!this.apiClient || !this.authenticated) {
      debug.warn('Cannot reconnect pipeline: not authenticated')
      return
    }
    // Check if we're in a backoff period (e.g., after 500 error)
    if (this.pipelineBackoffUntil && Date.now() < this.pipelineBackoffUntil) {
      const remaining = Math.ceil((this.pipelineBackoffUntil - Date.now()) / 1000)
      debug.info(`Pipeline in backoff, ${remaining}s remaining`)
      this.schedulePipelineReconnect(remaining * 1000)
      return
    }
    if (this.apiClient.pipeline.connected) {
      this.pipelineConnected = true
      debug.info('Pipeline already connected')
      return
    }
    this.pipelineReconnecting = true
    try {
      await this.connectPipeline()
      this.pipelineConnected = true
      debug.info('Pipeline reconnected successfully')
    } catch (error: unknown) {
      this.pipelineConnected = false
      debug.error(`Pipeline reconnection failed: ${(error as Error).message}`)
      // Handle 500 errors with extended backoff
      const err = error as any
      const is500Error = err?.status === 500 || err?.response?.status === 500
      if (is500Error) {
        this.pipelineBackoffUntil = Date.now() + this.PIPELINE_500_BACKOFF_MS
        debug.warn(`500 error, backing off for ${this.PIPELINE_500_BACKOFF_MS / 1000}s`)
        this.schedulePipelineReconnect(this.PIPELINE_500_BACKOFF_MS)
      } else {
        // General error - quick retry
        this.schedulePipelineReconnect(this.PIPELINE_QUICK_RECONNECT_MS)
      }
    } finally {
      this.pipelineReconnecting = false
    }
  }

  /**
   * Set callback for pipeline events (called by main.js).
   */
  setPipelineEventCallback(callback: (type: string, data: unknown) => void): void {
    this.onPipelineEvent = callback
  }

  normalizePipelineUserUpdate(data: unknown): { id: string, status: string | null, statusDescription: string | null } | null {
    if (!data || typeof data !== 'object') {
      return null
    }
    const d = data as Record<string, any>
    const sourceUser = d.user && typeof d.user === 'object' ? d.user : d
    const userId = sourceUser.id || sourceUser.userId || d.userId || null
    if (!userId) {
      return null
    }
    return {
      id: userId,
      status: sourceUser.status ?? this.currentUser?.status ?? null,
      statusDescription: sourceUser.statusDescription ?? this.currentUser?.statusDescription ?? null
    }
  }

  /**
   * Returns the API client for making additional API calls.
   */
  getApiClient(): unknown {
    if (!this.authenticated) {
      throw new Error('Not authenticated with VRChat API')
    }
    return this.apiClient
  }
}

export default VRChatAPIContainer
