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
   * Initialize the VRChat API client with application info
   */
  initializeClient() {
    try {
      const appVersion = app.getVersion();
      const appName = 'ARC-OSC-Client';
      // Create a simple keyv-compatible adapter using Map
      const cookieStore = new Map();      
      // Load and decrypt saved tokens, then reconstruct cookies
      if (this.config.authToken || this.config.twoFactorToken) {
        try {
          const cookieArray = [];
          // Decrypt and restore auth cookie
          if (this.config.authToken) {
            const decryptedAuth = decryptData(this.config.authToken);
            if (decryptedAuth) {
              const authCookie = {
                name: 'auth',
                value: decryptedAuth,
                domain: 'api.vrchat.cloud',
                path: '/',
                secure: true,
                httpOnly: true,
                expires: Date.now() + (365 * 24 * 60 * 60 * 1000), // 1 year
                options: {
                  'max-age': '31556952',
                  path: '/',
                  samesite: 'Lax'
                }
              };
              cookieArray.push(authCookie);
              debug.info(`Decrypted and restored auth token (length: ${decryptedAuth.length})`);
            } else {
              debug.warn('Failed to decrypt auth token - clearing saved session');
              this.config.authToken = null;
              this.config.twoFactorToken = null;
              this.saveConfig();
            }
          }
          // Decrypt and restore twoFactorAuth cookie
          if (this.config.twoFactorToken) {
            const decryptedTwoFactor = decryptData(this.config.twoFactorToken);
            if (decryptedTwoFactor) {
              const twoFactorCookie = {
                name: 'twoFactorAuth',
                value: decryptedTwoFactor,
                domain: 'api.vrchat.cloud',
                path: '/',
                secure: true,
                httpOnly: true,
                expires: Date.now() + (30 * 24 * 60 * 60 * 1000), // 30 days
                options: {
                  'max-age': '2592000',
                  path: '/',
                  samesite: 'Lax'
                }
              };
              cookieArray.push(twoFactorCookie);
              debug.info(`Decrypted and restored twoFactorAuth token (length: ${decryptedTwoFactor.length})`);
            } else {
              debug.warn('Failed to decrypt twoFactorAuth token');
            }
          }
          // Store cookies in keyv format if we have any
          if (cookieArray.length > 0) {
            const keyvData = { value: cookieArray };
            cookieStore.set('keyv:cookies', JSON.stringify(keyvData));
            debug.info(`Restored ${cookieArray.length} cookie(s) from encrypted config`);
          }
        } catch (e) {
          debug.error(`Failed to restore cookies: ${e.message}`);
          // Clear corrupted data
          this.config.authToken = null;
          this.config.twoFactorToken = null;
          this.saveConfig();
        }
      }
      // Create a keyv-compatible adapter with logging
      const keyvAdapter = {
        get: async (key) => {
          const value = cookieStore.get(key);
          debug.debug(`Keyv adapter GET: key=${key}, hasValue=${!!value}, isArray=${Array.isArray(value)}, length=${value?.length || 0}`);
          return value;
        },
        set: async (key, value) => {
          debug.debug(`Keyv adapter SET: key=${key}, isArray=${Array.isArray(value)}, length=${value?.length || 0}`);
          cookieStore.set(key, value);
        },
        delete: async (key) => {
          debug.debug(`Keyv adapter DELETE: key=${key}`);
          cookieStore.delete(key);
        },
        clear: async () => {
          debug.debug('Keyv adapter CLEAR');
          cookieStore.clear();
        }
      };
      this.apiClient = new VRChat({
        application: {
          name: appName,
          version: appVersion,
          contact: 'https://github.com/ComfyChloe/ARC-Client'
        },
        authentication: {
          optimistic: false // Don't auto-authenticate, wait for explicit login
        },
        keyv: keyvAdapter, // Use keyv-compatible adapter for persistent cookies
        verbose: false // Set to true for debugging
      });
      // Store reference to cookie store
      this.cookieStore = cookieStore;
      
      debug.info(`VRChat API client initialized (${appName} v${appVersion})`);
    } catch (error) {
      debug.error(`Failed to initialize VRChat API client: ${error.message}`);
    }
  }
  loadConfig() {
    try {
      const vrchatConfig = configManager.getVRChatAPIConfig();
      if (vrchatConfig) {
        debug.info('VRChat API config loaded');
        return vrchatConfig;
      }
    } catch (error) {
      debug.error(`Failed to load VRChat API config: ${error.message}`);
    }
    return {
      enabled: false,
      authToken: null
    };
  }
  saveConfig() {
    try {
      // Extract auth and twoFactorAuth cookies from cookie store
      let encryptedAuth = null;
      let encryptedTwoFactor = null;
      if (this.cookieStore && this.cookieStore.has('keyv:cookies')) {
        const cookieData = this.cookieStore.get('keyv:cookies');
        debug.info(`Extracting cookies - type: ${typeof cookieData}, length: ${cookieData?.length || 0}`);
        // Parse cookies
        let cookieArray = null;
        if (typeof cookieData === 'string') {
          try {
            const parsed = JSON.parse(cookieData);
            // Extract cookie array from parsed structure
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
              if (parsed.value && Array.isArray(parsed.value)) {
                cookieArray = parsed.value;
              } else if (parsed.val && Array.isArray(parsed.val)) {
                cookieArray = parsed.val;
              }
            } else if (Array.isArray(parsed)) {
              cookieArray = parsed;
            }
          } catch (e) {
            debug.warn(`Failed to parse cookie data: ${e.message}`);
          }
        } else if (Array.isArray(cookieData)) {
          cookieArray = cookieData;
        }
        // Extract both auth and twoFactorAuth cookies
        if (Array.isArray(cookieArray)) {
          const authCookie = cookieArray.find(c => c.name === 'auth');
          const twoFactorCookie = cookieArray.find(c => c.name === 'twoFactorAuth');
          if (authCookie && authCookie.value) {
            // Encrypt the auth token
            encryptedAuth = encryptData(authCookie.value);
            debug.info(`Extracted and encrypted auth token (original length: ${authCookie.value.length}, encrypted length: ${encryptedAuth?.length || 0})`);
          }
          if (twoFactorCookie && twoFactorCookie.value) {
            encryptedTwoFactor = encryptData(twoFactorCookie.value);
            debug.info(`Extracted and encrypted twoFactorAuth token (original length: ${twoFactorCookie.value.length}, encrypted length: ${encryptedTwoFactor?.length || 0})`);
          }
          if (!authCookie) {
            debug.warn(`No auth cookie found in ${cookieArray.length} cookies`);
          }
        }
      } else {
        debug.info('No cookies in store to extract');
      }
      const config = {
        enabled: this.enabled,
        authToken: encryptedAuth,
        twoFactorToken: encryptedTwoFactor
      };
      configManager.updateVRChatAPIConfig(config);
      debug.info(`VRChat API config saved (auth: ${encryptedAuth ? 'encrypted' : 'absent'}, 2FA: ${encryptedTwoFactor ? 'encrypted' : 'absent'})`);
    } catch (error) {
      debug.error(`Failed to save VRChat API config: ${error.message}`);
    }
  }
  /**
   * Clear saved cookies
   */
  clearCookies() {
    try {
      if (this.cookieStore) {
        this.cookieStore.clear();
      }
      this.config.authToken = null;
      this.config.twoFactorToken = null;
      this.saveConfig();
      debug.info('VRChat API encrypted tokens cleared');
    } catch (error) {
      debug.error(`Failed to clear encrypted tokens: ${error.message}`);
    }
  }

  isEnabled() {
    return this.enabled;
  }

  isAuthenticated() {
    return this.authenticated;
  }

  getStatus() {
    // Check if we have saved encrypted tokens
    const hasSavedSession = !!(this.config && (this.config.authToken || this.config.twoFactorToken));
    
    return {
      enabled: this.enabled,
      authenticated: this.authenticated,
      currentUser: this.currentUser ? {
        id: this.currentUser.id,
        displayName: this.currentUser.displayName,
        username: this.currentUser.username
      } : null,
      hasSavedSession: hasSavedSession
    };
  }

  /**
   * Attempt to login with username and password
   * Returns { success: true, user: CurrentUser } or { success: false, requires2FA: true, twoFactorMethods: [] } or { success: false, error: string }
   */
  async login(username, password) {
    try {
      debug.info(`Attempting VRChat API login for user: ${username}`);

      // Clear any existing cookies to ensure fresh login
      this.clearCookies();
      
      // Re-initialize the client with fresh cookie store
      this.initializeClient();

      // Track if 2FA was requested
      let twoFactorRequested = false;
      let twoFactorMethods = [];

      // Start the login process (don't await yet)
      this.loginPromise = this.apiClient.login({
        username: username,
        password: password,
        twoFactorCode: async () => {
          // This callback is called if 2FA is required
          debug.info('VRChat API requires 2FA authentication');
          twoFactorRequested = true;
          
          // Return a promise that will be resolved when user provides code
          return new Promise((resolve) => {
            this.twoFactorResolver = resolve;
          });
        }
      });

      // Race between login completing or 2FA being requested
      // Give it more time to detect 2FA requirement (increased from 500ms to 2000ms)
      await Promise.race([
        this.loginPromise.then(() => 'completed'),
        new Promise(resolve => setTimeout(() => resolve('timeout'), 2000))
      ]);

      // Wait a bit more if we just timed out, to ensure 2FA callback has time to fire
      if (twoFactorRequested === false) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // If 2FA was requested, return immediately to show UI
      if (twoFactorRequested && this.twoFactorResolver) {
        debug.info('VRChat API login pending 2FA');
        
        // Try to get 2FA methods from a test request
        try {
          // Make a simple test to see which 2FA methods are available
          // This is handled internally by VRChat API
          twoFactorMethods = ['totp', 'emailOtp']; // Default to both
        } catch (e) {
          twoFactorMethods = ['totp', 'emailOtp'];
        }
        
        return {
          success: false,
          requires2FA: true,
          twoFactorMethods: twoFactorMethods
        };
      }

      // If we got here without 2FA request, check the result
      const result = await this.loginPromise;
      this.loginPromise = null;

      // Check result
      if (result.data) {
        // Login successful without 2FA
        this.authenticated = true;
        this.currentUser = result.data;
        this.enabled = true;
        this.twoFactorResolver = null;
        this.reconnectAttempts = 0;
        
        // Start keepalive
        this.startKeepalive();
        
        // Wait a moment for cookies to be saved by the library
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Save cookies for session persistence
        this.saveConfig();
        
        debug.info(`VRChat API login successful for user: ${result.data.displayName}`);
        return { success: true, user: result.data };
      }
      
      // Check for error
      if (result.error) {
        const error = result.error;
        
        // Check if error indicates 2FA requirement
        if (error.requiresTwoFactorAuth && error.requiresTwoFactorAuth.length > 0) {
          debug.info(`VRChat API requires 2FA: ${error.requiresTwoFactorAuth.join(', ')}`);
          
          return {
            success: false,
            requires2FA: true,
            twoFactorMethods: error.requiresTwoFactorAuth
          };
        }
        
        // Other authentication error
        debug.error(`VRChat API login failed: ${error.message || JSON.stringify(error)}`);
        return {
          success: false,
          requires2FA: false,
          error: error.message || 'Authentication failed'
        };
      }
      
      // Unknown result
      return {
        success: false,
        requires2FA: false,
        error: 'Unknown login response'
      };
      
    } catch (error) {
      this.loginPromise = null;
      debug.error(`VRChat API login error: ${error.message}`);
      
      // Check for 2FA requirement in error
      if (error.response && error.response.data && error.response.data.requiresTwoFactorAuth) {
        debug.info(`VRChat API requires 2FA: ${error.response.data.requiresTwoFactorAuth.join(', ')}`);
        
        return {
          success: false,
          requires2FA: true,
          twoFactorMethods: error.response.data.requiresTwoFactorAuth
        };
      }
      
      // Extract error message
      let errorMessage = error.message;
      if (error.response && error.response.data) {
        errorMessage = error.response.data.error?.message || error.response.data.message || errorMessage;
      }
      
      return {
        success: false,
        requires2FA: false,
        error: errorMessage
      };
    }
  }

  /**
   * Verify 2FA code by resolving the pending promise
   * Returns { success: true, user: CurrentUser } or { success: false, error: string }
   */
  async verify2FA(code, type = 'totp') {
    try {
      if (!this.twoFactorResolver) {
        return { success: false, error: 'No pending 2FA authentication' };
      }

      if (!this.loginPromise) {
        return { success: false, error: 'No pending login attempt' };
      }

      debug.info(`Verifying VRChat API 2FA code (type: ${type})`);

      // Resolve the 2FA promise with the code
      // This will allow the login callback to continue
      this.twoFactorResolver(code);
      const resolver = this.twoFactorResolver;
      this.twoFactorResolver = null;

      // Wait for the login promise to complete
      const result = await this.loginPromise;
      this.loginPromise = null;

      // Check result
      if (result.data) {
        // 2FA verification successful
        this.authenticated = true;
        this.currentUser = result.data;
        this.enabled = true;
        this.reconnectAttempts = 0;
        
        // Start keepalive
        this.startKeepalive();
        
        // Wait a moment for cookies to be saved by the library
        await new Promise(resolve => setTimeout(resolve, 100));
        
        this.saveConfig();
        
        debug.info(`VRChat API 2FA verification successful for user: ${result.data.displayName}`);
        return { success: true, user: result.data };
      }
      
      // Check for error
      if (result.error) {
        const error = result.error;
        debug.error(`VRChat API 2FA verification failed: ${error.message || JSON.stringify(error)}`);
        
        return {
          success: false,
          error: error.message || '2FA verification failed'
        };
      }
      
      // Unknown result
      return {
        success: false,
        error: 'Unknown 2FA verification response'
      };
      
    } catch (error) {
      this.loginPromise = null;
      this.twoFactorResolver = null;
      debug.error(`VRChat API 2FA verification failed: ${error.message}`);
      
      // Extract error message
      let errorMessage = error.message;
      if (error.response && error.response.data) {
        errorMessage = error.response.data.error?.message || error.response.data.message || errorMessage;
      }
      
      return {
        success: false,
        error: errorMessage
      };
    }
  }

  /**
   * Stop the container without clearing session (preserves cookies)
   */
  stop() {
    try {
      debug.info('Stopping VRChat API container (preserving session)');
      this.stopKeepalive();
      debug.info('VRChat API container stopped');
    } catch (error) {
      debug.error(`Error stopping VRChat API container: ${error.message}`);
    }
  }

  /**
   * Logout and clear session (clears cookies)
   */
  async logout() {
    try {
      debug.info('Logging out from VRChat API');
      
      // Stop keepalive
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
      
      // Clear cookies on logout
      this.clearCookies();
      
      // Re-initialize the client for next login
      this.initializeClient();
      
      debug.info('VRChat API logout complete');
      return { success: true };
      
    } catch (error) {
      debug.error(`VRChat API logout error: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Attempt to restore session from saved credentials
   */
  async restoreSession() {
    try {
      if (!this.config || (!this.config.authToken && !this.config.twoFactorToken)) {
        debug.info('No saved encrypted tokens to restore VRChat API session');
        return { success: false, error: 'No saved session' };
      }

      debug.info(`Attempting to restore VRChat API session with encrypted tokens`);
      
      // Try to verify the session with saved cookies
      // The VRChat library returns { data, error, response, request }
      const result = await this.apiClient.getCurrentUser();
      
      debug.debug('RestoreSession API response:', JSON.stringify({
        hasData: !!result.data,
        hasError: !!result.error,
        dataKeys: result.data ? Object.keys(result.data) : [],
        errorDetails: result.error ? {
          message: result.error.message,
          status: result.error.statusCode || result.response?.status
        } : null
      }));
      
      if (result.data && result.data.id) {
        this.currentUser = result.data;
        this.authenticated = true;
        this.onlineStatus = 'active';
        
        // Start keepalive to maintain session
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
      } else if (result.error) {
        // Check if it's an authentication error
        const statusCode = result.response?.status || result.error.statusCode;
        const errorReason = statusCode === 401 ? 'Unauthorized (401)' : statusCode === 403 ? 'Forbidden (403)' : 'Invalid session';
        
        debug.info(`Saved cookies are invalid: ${errorReason}, clearing session`);
        
        if (statusCode === 401 || statusCode === 403) {
          this.clearCookies();
          await this.saveConfig();
        }
        
        return { success: false, error: errorReason };
      } else {
        // Cookies are invalid, clear them
        debug.info('Saved cookies are invalid, clearing session');
        this.clearCookies();
        await this.saveConfig();
        return { success: false, error: 'Invalid session' };
      }
      
    } catch (error) {
      debug.error(`Failed to restore VRChat API session: ${error.message}`);
      
      // Check for authentication error status codes
      const statusCode = error.response?.status || error.statusCode;
      
      if (statusCode === 401 || statusCode === 403) {
        // Authentication failed - clear cookies
        const errorReason = statusCode === 401 ? 'Unauthorized (401)' : 'Forbidden (403)';
        debug.info(`Authentication failed: ${errorReason}, clearing cookies`);
        this.clearCookies();
        await this.saveConfig();
        return { success: false, error: errorReason };
      }
      
      // Other errors (network, etc.) - don't clear cookies
      return { success: false, error: error.message };
    }
  }

  /**
   * Start keepalive timer to maintain session
   */
  startKeepalive() {
    // Clear any existing interval
    this.stopKeepalive();
    
    // Check session every 5 minutes
    this.keepaliveInterval = setInterval(async () => {
      await this.verifySession();
    }, 300000); // 5 minutes
    
    debug.info('VRChat API keepalive started');
  }

  /**
   * Stop keepalive timer
   */
  stopKeepalive() {
    if (this.keepaliveInterval) {
      clearInterval(this.keepaliveInterval);
      this.keepaliveInterval = null;
      debug.info('VRChat API keepalive stopped');
    }
  }

  /**
   * Verify session is still valid
   */
  async verifySession() {
    try {
      if (!this.authenticated || !this.apiClient) {
        return;
      }

      debug.info('Verifying VRChat API session...');
      
      const result = await this.apiClient.getCurrentUser();
      
      if (result.data) {
        // Session is valid, update current user
        this.currentUser = result.data;
        this.reconnectAttempts = 0; // Reset reconnect counter on success
        debug.info('VRChat API session verified successfully');
      } else if (result.error) {
        // Session may be invalid
        debug.warn('VRChat API session verification failed, attempting reconnection');
        await this.attemptReconnect();
      }
      
    } catch (error) {
      debug.error(`VRChat API session verification error: ${error.message}`);
      
      // Check for 500 error
      if (error.response && error.response.status === 500) {
        debug.warn('VRChat API returned 500 error, backing off for 3 minutes');
        await this.attemptReconnect(true);
      } else {
        await this.attemptReconnect();
      }
    }
  }

  /**
   * Attempt to reconnect with exponential backoff
   */
  async attemptReconnect(is500Error = false) {
    if (this.isReconnecting) {
      return; // Already attempting reconnect
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      debug.error('VRChat API max reconnection attempts reached');
      this.authenticated = false;
      this.stopKeepalive();
      return;
    }

    this.isReconnecting = true;
    this.reconnectAttempts++;

    const delay = is500Error ? this.backoffDelay : this.reconnectDelay;
    
    debug.info(`VRChat API reconnection attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay/1000} seconds...`);

    await new Promise(resolve => setTimeout(resolve, delay));

    try {
      // Try to restore session using saved cookies
      if (this.cookieStore.size > 0) {
        debug.info('Attempting to restore VRChat API session using saved cookies...');
        const result = await this.restoreSession();
        
        if (result.success) {
          debug.info('VRChat API session restored successfully');
          this.reconnectAttempts = 0;
        } else {
          debug.error(`VRChat API reconnection failed: ${result.error}`);
          // Session is invalid, stop trying to reconnect
          this.authenticated = false;
          this.stopKeepalive();
        }
      } else {
        debug.warn('No saved session for VRChat API reconnection');
        this.authenticated = false;
        this.stopKeepalive();
      }
    } catch (error) {
      debug.error(`VRChat API reconnection error: ${error.message}`);
    } finally {
      this.isReconnecting = false;
    }
  }

  /**
   * Get account statistics (uploaded avatars, favorited avatars, friends online)
   * Returns { success: true, uploadedAvatars, favoritedAvatars, friendsOnline } or { success: false, error }
   */
  async getStats() {
    try {
      if (!this.authenticated || !this.apiClient) {
        return { success: false, error: 'Not authenticated' };
      }

      debug.info('Fetching VRChat API stats...');

      // Uploaded avatars - get from current user data
      let uploadedAvatars = this.currentUser.ownedAvatarCount || 0;

      // Fetch favorited avatars and online friends in parallel
      const [favoritesResult, friendsResult] = await Promise.all([
        // Get favorited avatars count (from favorites with type avatar)
        this.apiClient.getFavorites({ type: 'avatar', n: 100 }).catch(e => ({ error: e })),
        
        // Get friends list to count online (offline: false returns only online friends)
        this.apiClient.getFriends({ offline: false }).catch(e => ({ error: e }))
      ]);

      // Count favorited avatars
      let favoritedAvatars = 0;
      if (favoritesResult.data && Array.isArray(favoritesResult.data)) {
        favoritedAvatars = favoritesResult.data.length;
      }

      // Count online friends
      let friendsOnline = 0;
      if (friendsResult.data && Array.isArray(friendsResult.data)) {
        friendsOnline = friendsResult.data.length;
      }

      debug.info(`VRChat API stats: ${uploadedAvatars} avatars, ${favoritedAvatars} favorited, ${friendsOnline} friends online`);

      return {
        success: true,
        uploadedAvatars,
        favoritedAvatars,
        friendsOnline
      };

    } catch (error) {
      debug.error(`Failed to fetch VRChat API stats: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get the API client for making additional API calls
   */
  getApiClient() {
    if (!this.authenticated) {
      throw new Error('Not authenticated with VRChat API');
    }
    return this.apiClient;
  }
}

module.exports = VRChatAPIContainer;
