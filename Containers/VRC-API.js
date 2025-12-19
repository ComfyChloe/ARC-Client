const debug = require('../utils/debugger');
const configManager = require('../utils/configManager');
const { VRChat } = require('vrchat');
const { app } = require('electron');
const { encryptData, decryptData } = require('../utils/encryption');
class VRChatAPIContainer {
  constructor() {
    this.enabled = false;
    this.authenticated = false;
    this.currentUser = null;
    this.apiClient = null;
    this.config = this.loadConfig();
    this.twoFactorResolver = null; // Resolver for 2FA promise
    this.loginPromise = null; // Track ongoing login attempt
    // WebSocket Pipeline constants
    this.PIPELINE_RECONNECT_INTERVAL_MS = 90000; // 90 seconds
    this.PIPELINE_QUICK_RECONNECT_MS = 10000; // 10 seconds
    this.PIPELINE_500_BACKOFF_MS = 180000; // 3 minutes
    // Pipeline state
    this.pipelineConnected = false;
    this.pipelineReconnecting = false;
    this.pipelineReconnectTimeout = null;
    this.pipelineBackoffUntil = 0;
    this.pipelineListenersSetup = false;
    // Initialize VRChat API client with proper application info and user agent
    this.initializeClient();
    debug.info('VRChat API container initialized');
  }
  /**
   * Initialize the VRChat API client with application info and restore saved session.
   */
  initializeClient() {
    const appVersion = app.getVersion();
    const appName = 'ARC-OSC-Client';
    const cookieStore = new Map();
    
    // Restore encrypted session tokens
    this.restoreCookies(cookieStore);
    
    // Create keyv-compatible adapter
    const keyvAdapter = {
      get: async (key) => cookieStore.get(key),
      set: async (key, value) => cookieStore.set(key, value),
      delete: async (key) => cookieStore.delete(key),
      clear: async () => cookieStore.clear()
    };
    
    this.apiClient = new VRChat({
      application: {
        name: appName,
        version: appVersion,
        contact: 'https://github.com/ComfyChloe/ARC-Client'
      },
      authentication: { optimistic: false },
      keyv: keyvAdapter,
      verbose: false
    });
    
    this.cookieStore = cookieStore;
    debug.info(`VRChat API client initialized (${appName} v${appVersion})`);
  }

  /**
   * Restores encrypted cookies from config into cookie store.
   */
  restoreCookies(cookieStore) {
    if (!this.config.authToken && !this.config.twoFactorToken) return;
    
    const cookieArray = [];
    const createCookie = (name, value, maxAge) => ({
      name,
      value,
      domain: 'api.vrchat.cloud',
      path: '/',
      secure: true,
      httpOnly: true,
      expires: Date.now() + (maxAge * 1000),
      options: { 'max-age': String(maxAge), path: '/', samesite: 'Lax' }
    });
    
    // Decrypt and restore auth cookie
    if (this.config.authToken) {
      const decryptedAuth = decryptData(this.config.authToken);
      if (decryptedAuth) {
        cookieArray.push(createCookie('auth', decryptedAuth, 31556952)); // 1 year
      } else {
        this.config.authToken = null;
        this.config.twoFactorToken = null;
        this.saveConfig();
        return;
      }
    }
    
    // Decrypt and restore twoFactorAuth cookie
    if (this.config.twoFactorToken) {
      const decryptedTwoFactor = decryptData(this.config.twoFactorToken);
      if (decryptedTwoFactor) {
        cookieArray.push(createCookie('twoFactorAuth', decryptedTwoFactor, 2592000)); // 30 days
      }
    }
    
    if (cookieArray.length > 0) {
      cookieStore.set('keyv:cookies', JSON.stringify({ value: cookieArray }));
    }
  }
  loadConfig() {
    return configManager.getVRChatAPIConfig() || { enabled: false, authToken: null, twoFactorToken: null };
  }
  saveConfig() {
    const cookies = this.extractCookies();
    configManager.updateVRChatAPIConfig({
      enabled: this.enabled,
      authToken: cookies.auth,
      twoFactorToken: cookies.twoFactor
    });
  }

  /**
   * Extracts and encrypts cookies from cookie store.
   */
  extractCookies() {
    if (!this.cookieStore?.has('keyv:cookies')) {
      return { auth: null, twoFactor: null };
    }
    
    const cookieData = this.cookieStore.get('keyv:cookies');
    const cookieArray = this.parseCookieData(cookieData);
    
    if (!Array.isArray(cookieArray)) {
      return { auth: null, twoFactor: null };
    }
    
    const authCookie = cookieArray.find(c => c.name === 'auth');
    const twoFactorCookie = cookieArray.find(c => c.name === 'twoFactorAuth');
    
    return {
      auth: authCookie?.value ? encryptData(authCookie.value) : null,
      twoFactor: twoFactorCookie?.value ? encryptData(twoFactorCookie.value) : null
    };
  }

  /**
   * Parses cookie data from various formats.
   */
  parseCookieData(cookieData) {
    if (Array.isArray(cookieData)) return cookieData;
    if (typeof cookieData !== 'string') return null;
    
    try {
      const parsed = JSON.parse(cookieData);
      if (Array.isArray(parsed)) return parsed;
      if (parsed?.value && Array.isArray(parsed.value)) return parsed.value;
      if (parsed?.val && Array.isArray(parsed.val)) return parsed.val;
    } catch {
      return null;
    }
    
    return null;
  }
  /**
   * Clears saved session cookies and tokens.
   */
  clearCookies() {
    this.cookieStore?.clear();
    this.config.authToken = null;
    this.config.twoFactorToken = null;
    this.saveConfig();
  }

  isEnabled() {
    return this.enabled;
  }

  isAuthenticated() {
    return this.authenticated;
  }

  getStatus() {
    return {
      enabled: this.enabled,
      authenticated: this.authenticated,
      currentUser: this.currentUser ? {
        id: this.currentUser.id,
        displayName: this.currentUser.displayName,
        username: this.currentUser.username
      } : null,
      hasSavedSession: !!(this.config?.authToken || this.config?.twoFactorToken),
      pipelineConnected: this.pipelineConnected
    };
  }

  /**
   * Authenticates with username and password.
   * @returns {Object} Result with success status, user data, or 2FA requirements
   */
  async login(username, password) {
    try {
      this.clearCookies();
      this.initializeClient();

      let twoFactorRequested = false;

      this.loginPromise = this.apiClient.login({
        username,
        password,
        twoFactorCode: async () => {
          twoFactorRequested = true;
          return new Promise(resolve => { this.twoFactorResolver = resolve; });
        }
      });

      // Wait for 2FA callback or login completion
      await Promise.race([
        this.loginPromise.then(() => 'completed'),
        new Promise(resolve => setTimeout(() => resolve('timeout'), 2000))
      ]);

      if (!twoFactorRequested) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      if (twoFactorRequested && this.twoFactorResolver) {
        return { success: false, requires2FA: true, twoFactorMethods: ['totp', 'emailOtp'] };
      }

      const result = await this.loginPromise;
      this.loginPromise = null;

      if (result.data) {
        return this.completeLogin(result.data);
      }

      if (result.error?.requiresTwoFactorAuth?.length > 0) {
        return { success: false, requires2FA: true, twoFactorMethods: result.error.requiresTwoFactorAuth };
      }

      return { success: false, requires2FA: false, error: result.error?.message || 'Authentication failed' };
    } catch (error) {
      this.loginPromise = null;

      if (error.response?.data?.requiresTwoFactorAuth) {
        return { success: false, requires2FA: true, twoFactorMethods: error.response.data.requiresTwoFactorAuth };
      }

      const errorMessage = error.response?.data?.error?.message || error.response?.data?.message || error.message;
      return { success: false, requires2FA: false, error: errorMessage };
    }
  }

  /**
   * Completes login after successful authentication.
   */
  async completeLogin(userData) {
    this.authenticated = true;
    this.currentUser = userData;
    this.enabled = true;
    this.twoFactorResolver = null;

    this.connectPipeline().catch(error => {
      debug.warn(`Failed to connect pipeline after login: ${error.message}`);
    });
    await new Promise(resolve => setTimeout(resolve, 100));
    this.saveConfig();

    debug.info(`VRChat API login successful for user: ${userData.displayName}`);
    return { success: true, user: userData };
  }

  /**
   * Verifies 2FA code for pending login.
   * @returns {Object} Result with success status and user data
   */
  async verify2FA(code) {
    try {
      if (!this.twoFactorResolver || !this.loginPromise) {
        return { success: false, error: 'No pending 2FA authentication' };
      }

      this.twoFactorResolver(code);
      this.twoFactorResolver = null;

      const result = await this.loginPromise;
      this.loginPromise = null;

      if (result.data) {
        return this.completeLogin(result.data);
      }

      return {
        success: false,
        error: result.error?.message || '2FA verification failed'
      };
    } catch (error) {
      this.loginPromise = null;
      this.twoFactorResolver = null;

      const errorMessage = error.response?.data?.error?.message || error.response?.data?.message || error.message;
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Stops the container without clearing session.
   */
  stop() {
    this.clearPipelineReconnectTimeout();
    debug.info('VRChat API container stopped');
  }

  /**
   * Logs out and clears session.
   */
  async logout() {
    this.clearPipelineReconnectTimeout();

    if (this.apiClient && this.authenticated) {
      try {
        await this.apiClient.logout();
      } catch (error) {
        debug.warn(`Logout API call failed: ${error.message}`);
      }
    }

    this.authenticated = false;
    this.currentUser = null;
    this.twoFactorResolver = null;
    this.loginPromise = null;

    this.clearCookies();
    this.initializeClient();

    debug.info('VRChat API logout complete');
    return { success: true };
  }

  /**
   * Attempts to restore session from saved encrypted tokens.
   */
  async restoreSession() {
    if (!this.config?.authToken && !this.config?.twoFactorToken) {
      return { success: false, error: 'No saved session' };
    }

    try {
      const result = await this.apiClient.getCurrentUser();

      if (result.data?.id) {
        this.currentUser = result.data;
        this.authenticated = true;
        this.connectPipeline().catch(error => {
          debug.warn(`Failed to connect pipeline after restore: ${error.message}`);
        });

        debug.info(`Successfully restored VRChat API session for user: ${result.data.displayName}`);
        return {
          success: true,
          user: {
            id: result.data.id,
            displayName: result.data.displayName,
            username: result.data.username
          }
        };
      }

      const statusCode = result.response?.status || result.error?.statusCode;
      if (statusCode === 401 || statusCode === 403) {
        this.clearCookies();
      }

      return { success: false, error: 'Invalid session' };
    } catch (error) {
      const statusCode = error.response?.status || error.statusCode;

      if (statusCode === 401 || statusCode === 403) {
        this.clearCookies();
      }

      return { success: false, error: error.message };
    }
  }

  /**
   * Gets account statistics (uploaded avatars, favorited avatars, friends online).
   */
  async getStats() {
    if (!this.authenticated || !this.apiClient) {
      return { success: false, error: 'Not authenticated' };
    }

    try {
      const [avatarsResult, friendsResult, favoriteGroupsResult] = await Promise.all([
        this.apiClient.searchAvatars({ query: { user: 'me', n: 100, releaseStatus: 'all' } }).catch(e => ({ error: e })),
        this.apiClient.getFriends({ query: { offline: false } }).catch(e => ({ error: e })),
        this.apiClient.getFavoriteGroups().catch(e => ({ error: e }))
      ]);

      // Count favorited avatars across all favorite groups
      let favoritedAvatars = 0;
      if (Array.isArray(favoriteGroupsResult.data)) {
        const avatarGroups = favoriteGroupsResult.data.filter(g => g.type === 'avatar');
        
        // Fetch favorites for each avatar group
        for (const group of avatarGroups) {
          try {
            const favs = await this.apiClient.getFavorites({ 
              query: { type: 'avatar', n: 100, tag: group.name } 
            });
            favoritedAvatars += Array.isArray(favs.data) ? favs.data.length : 0;
          } catch (error) {
            console.error(`Error fetching favorites for group ${group.name}:`, error.message);
          }
        }
      }

      return {
        success: true,
        uploadedAvatars: Array.isArray(avatarsResult.data) ? avatarsResult.data.length : 0,
        favoritedAvatars,
        friendsOnline: Array.isArray(friendsResult.data) ? friendsResult.data.length : 0
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Connect to VRChat WebSocket pipeline for real-time events.
   */
  async connectPipeline() {
    if (!this.apiClient) {
      return;
    }

    try {
      // Extract auth token from cookie store or config
      let authToken = null;

      // Try cookie store first
      if (this.cookieStore?.has('keyv:cookies')) {
        const cookieData = this.cookieStore.get('keyv:cookies');
        const cookieArray = this.parseCookieData(cookieData);
        const authCookie = cookieArray?.find(c => c.name === 'auth');
        if (authCookie?.value) {
          authToken = authCookie.value;
        }
      }

      // Fallback to config's encrypted token
      if (!authToken && this.config?.authToken) {
        authToken = decryptData(this.config.authToken);
      }

      if (!authToken) {
        debug.warn('No auth token available for pipeline connection');
        return;
      }

      // Connect the WebSocket pipeline
      await this.apiClient.pipeline.authenticate(authToken);
      this.pipelineConnected = this.apiClient.pipeline.connected;
      debug.info('WebSocket pipeline connected successfully');

      // Set up event listeners for real-time updates
      this.setupPipelineListeners();
    } catch (error) {
      this.pipelineConnected = false;
      debug.error(`Failed to connect WebSocket pipeline: ${error.message}`);
      throw error; // Re-throw so reconnection logic can handle it
    }
  }

  /**
   * Set up WebSocket pipeline event listeners.
   */
  setupPipelineListeners() {
    if (!this.apiClient || this.pipelineListenersSetup) {
      return;
    }

    // Listen for friend online events
    this.apiClient.on('friend-online', (data) => {
      // Emit event that main.js can forward to renderer
      if (this.onPipelineEvent) {
        this.onPipelineEvent('friend-online', data);
      }
    });

    // Listen for friend offline events
    this.apiClient.on('friend-offline', (data) => {
      if (this.onPipelineEvent) {
        this.onPipelineEvent('friend-offline', data);
      }
    });

    // Listen for notifications
    this.apiClient.on('notification', (data) => {
      debug.info(`Pipeline: Notification - ${data.type}`);
      if (this.onPipelineEvent) {
        this.onPipelineEvent('notification', data);
      }
    });

    // Listen for user updates
    this.apiClient.on('user-update', (data) => {
      debug.info(`Pipeline: User update - ${data.userId}`);
      if (this.onPipelineEvent) {
        this.onPipelineEvent('user-update', data);
      }
    });

    // Start pipeline health monitoring
    this.startPipelineHealthCheck();

    this.pipelineListenersSetup = true;
    debug.info('WebSocket pipeline event listeners configured');
  }

  /**
   * Monitor pipeline connection and reconnect if needed.
   */
  startPipelineHealthCheck() {
    const checkHealth = () => {
      if (!this.authenticated) {
        return;
      }
      if (this.apiClient && !this.apiClient.pipeline.connected) {
        this.pipelineConnected = false;
        debug.warn('Pipeline health check: disconnected, scheduling reconnect');
        this.schedulePipelineReconnect(this.PIPELINE_QUICK_RECONNECT_MS);
      } else {
        this.pipelineConnected = this.apiClient?.pipeline.connected || false;
        // Schedule next health check
        this.pipelineReconnectTimeout = setTimeout(checkHealth, this.PIPELINE_RECONNECT_INTERVAL_MS);
      }
    };
    // Start the first health check after the normal interval
    this.pipelineReconnectTimeout = setTimeout(checkHealth, this.PIPELINE_RECONNECT_INTERVAL_MS);
  }

  /**
   * Schedule a pipeline reconnection attempt.
   */
  schedulePipelineReconnect(delayMs = this.PIPELINE_RECONNECT_INTERVAL_MS) {
    this.clearPipelineReconnectTimeout();
    if (this.pipelineReconnecting) return;
    this.pipelineReconnectTimeout = setTimeout(() => {
      this.attemptPipelineReconnect().catch(error => {
        debug.error(`Pipeline reconnect error: ${error.message}`);
      });
    }, delayMs);
    debug.info(`Pipeline reconnect scheduled in ${delayMs / 1000}s`);
  }

  /**
   * Clear pipeline reconnection timeout.
   */
  clearPipelineReconnectTimeout() {
    if (this.pipelineReconnectTimeout) {
      clearTimeout(this.pipelineReconnectTimeout);
      this.pipelineReconnectTimeout = null;
    }
  }

  /**
   * Attempt to reconnect the pipeline.
   */
  async attemptPipelineReconnect() {
    if (!this.apiClient || !this.authenticated) {
      debug.warn('Cannot reconnect pipeline: not authenticated');
      return;
    }
    // Check if we're in a backoff period (e.g., after 500 error)
    if (this.pipelineBackoffUntil && Date.now() < this.pipelineBackoffUntil) {
      const remaining = Math.ceil((this.pipelineBackoffUntil - Date.now()) / 1000);
      debug.info(`Pipeline in backoff, ${remaining}s remaining`);
      this.schedulePipelineReconnect(remaining * 1000);
      return;
    }
    if (this.apiClient.pipeline.connected) {
      this.pipelineConnected = true;
      debug.info('Pipeline already connected');
      return;
    }
    this.pipelineReconnecting = true;
    try {
      await this.connectPipeline();
      this.pipelineConnected = true;
      debug.info('Pipeline reconnected successfully');
    } catch (error) {
      this.pipelineConnected = false;
      debug.error(`Pipeline reconnection failed: ${error.message}`);
      // Handle 500 errors with extended backoff
      const is500Error = error?.status === 500 || error?.response?.status === 500;
      if (is500Error) {
        this.pipelineBackoffUntil = Date.now() + this.PIPELINE_500_BACKOFF_MS;
        debug.warn(`500 error, backing off for ${this.PIPELINE_500_BACKOFF_MS / 1000}s`);
        this.schedulePipelineReconnect(this.PIPELINE_500_BACKOFF_MS);
      } else {
        // General error - quick retry
        this.schedulePipelineReconnect(this.PIPELINE_QUICK_RECONNECT_MS);
      }
    } finally {
      this.pipelineReconnecting = false;
    }
  }

  /**
   * Set callback for pipeline events (called by main.js).
   */
  setPipelineEventCallback(callback) {
    this.onPipelineEvent = callback;
  }

  /**
   * Returns the API client for making additional API calls.
   */
  getApiClient() {
    if (!this.authenticated) {
      throw new Error('Not authenticated with VRChat API');
    }
    return this.apiClient;
  }
}

module.exports = VRChatAPIContainer;
