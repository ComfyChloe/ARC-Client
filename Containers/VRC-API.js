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
    // Keepalive and reconnection
    this.keepaliveInterval = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 60000; // 60 seconds
    this.backoffDelay = 180000; // 3 minutes for 500 errors
    this.isReconnecting = false;
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
      hasSavedSession: !!(this.config?.authToken || this.config?.twoFactorToken)
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
    this.reconnectAttempts = 0;

    this.startKeepalive();
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
    this.stopKeepalive();
    debug.info('VRChat API container stopped');
  }

  /**
   * Logs out and clears session.
   */
  async logout() {
    this.stopKeepalive();

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
    this.reconnectAttempts = 0;
    this.isReconnecting = false;

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
        this.startKeepalive();

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
   * Starts keepalive timer (checks session every 5 minutes).
   */
  startKeepalive() {
    this.stopKeepalive();
    this.keepaliveInterval = setInterval(() => this.verifySession(), 300000);
  }

  /**
   * Stops keepalive timer.
   */
  stopKeepalive() {
    if (this.keepaliveInterval) {
      clearInterval(this.keepaliveInterval);
      this.keepaliveInterval = null;
    }
  }

  /**
   * Verifies session is still valid and attempts reconnection if needed.
   */
  async verifySession() {
    if (!this.authenticated || !this.apiClient) return;

    try {
      const result = await this.apiClient.getCurrentUser();

      if (result.data) {
        this.currentUser = result.data;
        this.reconnectAttempts = 0;
      } else {
        await this.attemptReconnect();
      }
    } catch (error) {
      const is500Error = error.response?.status === 500;
      await this.attemptReconnect(is500Error);
    }
  }

  /**
   * Attempts to reconnect with exponential backoff.
   */
  async attemptReconnect(is500Error = false) {
    if (this.isReconnecting || this.reconnectAttempts >= this.maxReconnectAttempts) {
      if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        this.authenticated = false;
        this.stopKeepalive();
      }
      return;
    }

    this.isReconnecting = true;
    this.reconnectAttempts++;

    const delay = is500Error ? this.backoffDelay : this.reconnectDelay;
    await new Promise(resolve => setTimeout(resolve, delay));

    try {
      if (this.cookieStore.size > 0) {
        const result = await this.restoreSession();
        if (result.success) {
          this.reconnectAttempts = 0;
        } else {
          this.authenticated = false;
          this.stopKeepalive();
        }
      } else {
        this.authenticated = false;
        this.stopKeepalive();
      }
    } finally {
      this.isReconnecting = false;
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
