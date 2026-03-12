/**
 * VRChat API UI Module
 * Handles all VRChat API-related UI interactions and display updates
 */

let vrchatApiStatus = {
    enabled: false,
    authenticated: false,
    currentUser: null,
    pending2FA: false,
    twoFactorMethods: [],
    pipelineConnected: false
};

// Track if auto-login has been attempted to prevent repeated attempts
let vrchatApiAutoLoginAttempted = false;

// Set up pipeline event listener
if (window.electronAPI && window.electronAPI.onVRChatPipelineEvent) {
    window.electronAPI.onVRChatPipelineEvent(({ event, data }) => {
        handleVRChatPipelineEvent(event, data);
    });
}

/**
 * Handle VRChat WebSocket pipeline events
 */
function handleVRChatPipelineEvent(event, data) {
    // debugLog(`Pipeline event: ${event}`, 'info');
    
    switch (event) {
        // case 'friend-online':
        //     debugLog(`Friend Online: ${data.user?.displayName || data.userId}`, 'info');
        //     break;
        // case 'friend-offline':
        //     debugLog(`Friend Offline: ${data.user?.displayName || data.userId}`, 'info');
        //     break;
        // case 'notification':
        //     debugLog(`VRChat: ${data.message || data.type}`, 'info');
        //     break;
        // case 'user-update':
        //     debugLog(`User update: ${data.userId}`, 'info');
        //     break;
    }
}

/**
 * Load VRChat API status on page load and when view is shown
 */
async function loadVRChatApiStatus() {
    try {
        const status = await window.electronAPI.vrchatApiGetStatus();
        vrchatApiStatus = { ...vrchatApiStatus, ...status };
        
        // Update connection status based on authentication state
        if (status.authenticated) {
            updateVRChatApiConnectionStatus('Authenticated', 'connected');
            updateVRChatApiUI();
        } else if (status.hasSavedSession && !vrchatApiAutoLoginAttempted) {
            // Automatically attempt to restore session if cookies exist (only once)
            vrchatApiAutoLoginAttempted = true;
            debugLog('Saved session found, attempting auto-login...');
            updateVRChatApiConnectionStatus('Restoring session...', 'connecting');
            await vrchatApiAutoLogin();
        } else {
            updateVRChatApiConnectionStatus('Not Authenticated', 'disconnected');
            updateVRChatApiUI();
        }
    } catch (error) {
        debugLog(`Error loading VRChat API status: ${error.message}`, 'error');
        updateVRChatApiConnectionStatus('Error loading status', 'error');
        updateVRChatApiUI();
    }
}

/**
 * Update VRChat API connection status display
 */
function updateVRChatApiConnectionStatus(message, state) {
    const statusIndicator = document.getElementById('vrchatapi-status');
    const statusText = document.getElementById('vrchatapi-status-text');
    
    if (statusText) statusText.textContent = message;
    
    // Update indicator class based on state
    if (statusIndicator) {
        if (state === 'connected') {
            statusIndicator.className = 'status-indicator status-connected';
        } else if (state === 'connecting') {
            statusIndicator.className = 'status-indicator status-connecting';
        } else if (state === 'error') {
            statusIndicator.className = 'status-indicator status-disconnected';
        } else {
            statusIndicator.className = 'status-indicator status-disconnected';
        }
    }
}

/**
 * Update VRChat API UI based on current status
 */
function updateVRChatApiUI() {
    const statusIndicator = document.getElementById('vrchatapi-status');
    const statusText = document.getElementById('vrchatapi-status-text');
    const userInfo = document.getElementById('vrchatapi-user-info');
    const userDisplay = document.getElementById('vrchatapi-user-display');
    const userIdEl = document.getElementById('vrchatapi-user-id');
    const loginCard = document.getElementById('vrchatapi-login-card');
    const actionsCard = document.getElementById('vrchatapi-actions-card');
    const statsCard = document.getElementById('vrchatapi-stats-card');

    if (vrchatApiStatus.authenticated && vrchatApiStatus.currentUser) {
        // Authenticated state
        if (statusIndicator) statusIndicator.className = 'status-indicator status-connected';
        const statusMsg = vrchatApiStatus.pipelineConnected ? 'Authenticated (Pipeline Connected)' : 'Authenticated';
        if (statusText) statusText.textContent = statusMsg;
        if (userInfo) userInfo.style.display = 'block';
        if (userDisplay) userDisplay.textContent = `${vrchatApiStatus.currentUser.displayName} (@${vrchatApiStatus.currentUser.username})`;
        if (userIdEl) {
            userIdEl.textContent = vrchatApiStatus.currentUser.id ? vrchatApiStatus.currentUser.id : '';
        }
        if (loginCard) loginCard.style.display = 'none';
        if (actionsCard) actionsCard.style.display = 'block';
        if (statsCard) statsCard.style.display = 'block';
        checkVRChatLinkStatus();
    } else if (vrchatApiStatus.pending2FA) {
        // 2FA required state - modal handles display
        if (statusIndicator) statusIndicator.className = 'status-indicator status-connecting';
        if (statusText) statusText.textContent = 'Waiting for 2FA...';
        if (userInfo) userInfo.style.display = 'none';
        if (loginCard) loginCard.style.display = 'none';
        if (actionsCard) actionsCard.style.display = 'none';
        if (statsCard) statsCard.style.display = 'none';
        if (userIdEl) userIdEl.textContent = '';
    } else {
        // Not authenticated state
        if (statusIndicator) statusIndicator.className = 'status-indicator status-disconnected';
        if (statusText) statusText.textContent = 'Not Authenticated';
        if (userInfo) userInfo.style.display = 'none';
        if (loginCard) loginCard.style.display = 'block';
        if (actionsCard) actionsCard.style.display = 'none';
        if (statsCard) statsCard.style.display = 'none';
        if (userIdEl) userIdEl.textContent = '';
    }
}

/**
 * Handle VRChat API login
 */
async function vrchatApiLogin() {
    try {
        const username = document.getElementById('vrchatapi-username').value.trim();
        const password = document.getElementById('vrchatapi-password').value;

        if (!username || !password) {
            debugLog('Please enter both username and password', 'error');
            updateVRChatApiConnectionStatus('Error: Missing credentials', 'error');
            return;
        }

        debugLog('Attempting VRChat API login...');
        updateVRChatApiConnectionStatus('Authenticating...', 'connecting');
        
        const loginBtn = document.getElementById('vrchatapi-login-btn');
        if (loginBtn) {
            loginBtn.disabled = true;
            loginBtn.textContent = 'Logging in...';
        }

        const result = await window.electronAPI.vrchatApiLogin({
            username,
            password
        });

        if (result.success) {
            debugLog(`VRChat API login successful: ${result.user.displayName}`);
            vrchatApiStatus.authenticated = true;
            vrchatApiStatus.currentUser = result.user;
            vrchatApiStatus.pending2FA = false;
            
            // Clear password field for security
            const passwordField = document.getElementById('vrchatapi-password');
            if (passwordField) passwordField.value = '';
            
            updateVRChatApiConnectionStatus('Connected', 'connected');
            updateVRChatApiUI();
        } else if (result.requires2FA) {
            debugLog('VRChat API requires 2FA authentication');
            vrchatApiStatus.pending2FA = true;
            vrchatApiStatus.twoFactorMethods = result.twoFactorMethods || [];
            
            // Update 2FA type message and show modal
            const twoFaType = document.getElementById('vrchatapi-2fa-type');
            if (twoFaType) {
                if (result.twoFactorMethods.includes('emailOtp')) {
                    twoFaType.textContent = 'Please check your email or 2FA App for a 6-digit verification code.';
                } else if (result.twoFactorMethods.includes('totp')) {
                    twoFaType.textContent = 'Please enter your authenticator app code.';
                } else {
                    twoFaType.textContent = 'Please enter your 2FA code.';
                }
            }
            
            updateVRChatApiConnectionStatus('Waiting for 2FA code...', 'connecting');
            
            // Show 2FA modal
            const modal = document.getElementById('vrchatapi-2fa-modal');
            if (modal) modal.style.display = 'block';
            const codeInput = document.getElementById('vrchatapi-2fa-code');
            if (codeInput) codeInput.focus();
            
            updateVRChatApiUI();
        } else {
            const errorMsg = result.error || 'Unknown error';
            debugLog(`VRChat API login failed: ${errorMsg}`, 'error');
            updateVRChatApiConnectionStatus(`Error: ${errorMsg}`, 'error');
        }
    } catch (error) {
        debugLog(`VRChat API login error: ${error.message}`, 'error');
        updateVRChatApiConnectionStatus(`Error: ${error.message}`, 'error');
    } finally {
        const loginBtn = document.getElementById('vrchatapi-login-btn');
        if (loginBtn) {
            loginBtn.disabled = false;
            loginBtn.textContent = 'Login';
        }
    }
}

/**
 * Verify 2FA code
 */
async function vrchatApiVerify2FA() {
    try {
        const code = document.getElementById('vrchatapi-2fa-code').value.trim();
        
        if (!code) {
            debugLog('Please enter a 2FA code', 'error');
            return;
        }

        debugLog('Verifying 2FA code...');
        updateVRChatApiConnectionStatus('Verifying 2FA...', 'connecting');
        
        // Determine the type based on what was required
        const type = vrchatApiStatus.twoFactorMethods.includes('emailOtp') ? 'emailOtp' : 'totp';
        
        const result = await window.electronAPI.vrchatApiVerify2FA({ code, type });

        if (result.success) {
            debugLog(`VRChat API 2FA verification successful: ${result.user.displayName}`);
            vrchatApiStatus.authenticated = true;
            vrchatApiStatus.currentUser = result.user;
            vrchatApiStatus.pending2FA = false;
            
            // Clear 2FA code field and hide modal
            const codeField = document.getElementById('vrchatapi-2fa-code');
            if (codeField) codeField.value = '';
            const modal = document.getElementById('vrchatapi-2fa-modal');
            if (modal) modal.style.display = 'none';
            
            updateVRChatApiConnectionStatus('Connected', 'connected');
            updateVRChatApiUI();
        } else {
            debugLog(`VRChat API 2FA verification failed: ${result.error}`, 'error');
            updateVRChatApiConnectionStatus(`Error: ${result.error}`, 'error');
            
            // Keep modal open for retry
            const codeField = document.getElementById('vrchatapi-2fa-code');
            if (codeField) codeField.select();
        }
    } catch (error) {
        debugLog(`VRChat API 2FA error: ${error.message}`, 'error');
        updateVRChatApiConnectionStatus(`Error: ${error.message}`, 'error');
    }
}

/**
 * Cancel 2FA and go back to login
 */
function vrchatApiCancel2FA() {
    vrchatApiStatus.pending2FA = false;
    vrchatApiStatus.twoFactorMethods = [];
    const codeField = document.getElementById('vrchatapi-2fa-code');
    if (codeField) codeField.value = '';
    const modal = document.getElementById('vrchatapi-2fa-modal');
    if (modal) modal.style.display = 'none';
    updateVRChatApiConnectionStatus('Disconnected', 'disconnected');
    updateVRChatApiUI();
    debugLog('VRChat API 2FA cancelled');
}

/**
 * Auto-login to VRChat API using saved session
 */
async function vrchatApiAutoLogin() {
    try {
        debugLog('Attempting VRChat API auto-login...');
        updateVRChatApiConnectionStatus('Restoring session...', 'connecting');

        const result = await window.electronAPI.vrchatApiRestoreSession();

        if (result.success) {
            debugLog(`VRChat API auto-login successful: ${result.user.displayName}`);
            vrchatApiStatus.authenticated = true;
            vrchatApiStatus.currentUser = result.user;
            vrchatApiStatus.pending2FA = false;
            
            updateVRChatApiConnectionStatus('Connected', 'connected');
            updateVRChatApiUI();
            
            // Load stats after successful auto-login
            await loadVRChatApiStats();
        } else {
            debugLog(`VRChat API auto-login failed: ${result.error}`, 'error');
            updateVRChatApiConnectionStatus('Not Authenticated', 'disconnected');
            updateVRChatApiUI();
        }
    } catch (error) {
        debugLog(`VRChat API auto-login error: ${error.message}`, 'error');
        updateVRChatApiConnectionStatus('Not Authenticated', 'disconnected');
        updateVRChatApiUI();
    }
}

/**
 * Logout from VRChat API
 */
async function vrchatApiLogout() {
    try {
        debugLog('Logging out from VRChat API...');
        updateVRChatApiConnectionStatus('Logging out...', 'connecting');
        
        const result = await window.electronAPI.vrchatApiLogout();

        if (result.success) {
            debugLog('VRChat API logout successful');
            vrchatApiStatus.authenticated = false;
            vrchatApiStatus.currentUser = null;
            vrchatApiStatus.pending2FA = false;
            
            // Reset auto-login flag so it can be attempted again next session
            vrchatApiAutoLoginAttempted = false;
            
            // Clear form fields
            const passwordField = document.getElementById('vrchatapi-password');
            if (passwordField) passwordField.value = '';
            const codeField = document.getElementById('vrchatapi-2fa-code');
            if (codeField) codeField.value = '';
            
            updateVRChatApiConnectionStatus('Disconnected', 'disconnected');
            updateVRChatApiUI();
        } else {
            debugLog(`VRChat API logout failed: ${result.error}`, 'error');
            updateVRChatApiConnectionStatus(`Error: ${result.error}`, 'error');
        }
    } catch (error) {
        debugLog(`VRChat API logout error: ${error.message}`, 'error');
        updateVRChatApiConnectionStatus(`Error: ${error.message}`, 'error');
    }
}

/**
 * Share VRChat account with ARC
 */
async function shareVRChatWithARC() {
    try {
        // Check if authenticated with VRChat
        if (!vrchatApiStatus.authenticated || !vrchatApiStatus.currentUser) {
            debugLog('Must be logged into VRChat API first', 'error');
            alert('Please log into your VRChat account first.');
            return;
        }
        // Check if connected to ARC WebSocket - access global isAuthenticated
        if (typeof isAuthenticated !== 'undefined' && !isAuthenticated) {
            debugLog('Must be connected to ARC WebSocket first', 'error');
            alert('Please connect to ARC WebSocket first (Main tab).');
            return;
        }
        const vrchatUserId = vrchatApiStatus.currentUser.id;
        const vrchatUsername = vrchatApiStatus.currentUser.displayName;
        // Show modal confirmation dialog
        showVRChatLinkModal(vrchatUsername, vrchatUserId);
    } catch (error) {
        debugLog(`Unexpected error in shareVRChatWithARC: ${error.message}`, 'error');
        alert(`An unexpected error occurred:\n${error.message}`);
    }
}

/**
 * Show VRChat link confirmation modal
 */
function showVRChatLinkModal(username, userId) {
    const modal = document.getElementById('vrchat-link-modal');
    const usernameEl = document.getElementById('vrchat-link-username');
    const userIdEl = document.getElementById('vrchat-link-userid');
    
    if (usernameEl) usernameEl.textContent = username;
    if (userIdEl) userIdEl.textContent = userId;
    
    if (modal) {
        modal.style.display = 'block';
        // Trigger fade in
        setTimeout(() => {
            modal.style.opacity = '1';
        }, 10);
    }
}

/**
 * Close VRChat link modal
 */
function closeVRChatLinkModal() {
    const modal = document.getElementById('vrchat-link-modal');
    if (modal) {
        modal.style.opacity = '0';
        setTimeout(() => {
            modal.style.display = 'none';
        }, 300);
    }
    debugLog('VRChat account linking cancelled by user');
}

/**
 * Show VRChat link success modal
 */
function showVRChatLinkSuccessModal(vrchatUsername) {
    const modal = document.getElementById('vrchat-link-success-modal');
    const usernameElement = document.getElementById('vrchat-link-success-username');
    
    if (usernameElement) usernameElement.textContent = vrchatUsername;
    if (modal) {
        modal.style.display = 'block';
        // Trigger fade in
        setTimeout(() => {
            modal.style.opacity = '1';
        }, 10);
    }
}

/**
 * Close VRChat link success modal
 */
function closeVRChatLinkSuccessModal() {
    const modal = document.getElementById('vrchat-link-success-modal');
    if (modal) {
        modal.style.opacity = '0';
        setTimeout(() => {
            modal.style.display = 'none';
        }, 300);
    }
}

/**
 * Confirm and execute VRChat account linking
 */
async function confirmVRChatLink() {
    const vrchatUserId = vrchatApiStatus.currentUser.id;
    const vrchatUsername = vrchatApiStatus.currentUser.displayName;
    // Close modal
    closeVRChatLinkModal();
    debugLog('Sending VRChat account link request to ARC...');
    // Send link request via WebSocket
    try {
        const response = await window.electronAPI.sendVRChatLink(vrchatUserId, vrchatUsername);
        if (response.success) {
            debugLog(`VRChat account linked successfully: ${vrchatUsername}`);
            showVRChatLinkSuccessModal(vrchatUsername);
            // Update UI to show linked state
            updateVRChatLinkButton(true);
        } else {
            debugLog(`Failed to link VRChat account: ${response.error}`, 'error');
            alert(`Failed to link VRChat account:\n${response.error}`);
        }
    } catch (error) {
        debugLog(`Error linking VRChat account: ${error.message}`, 'error');
        alert(`Error linking VRChat account:\n${error.message}`);
    }
}

/**
 * Check if VRChat account is already linked to ARC
 */
async function checkVRChatLinkStatus() {
    try {
        // Only check if authenticated with both VRChat and ARC WebSocket
        const isConnectedToARC = typeof isAuthenticated !== 'undefined' ? isAuthenticated : false;
        if (!vrchatApiStatus.authenticated || !isConnectedToARC) {
            updateVRChatLinkButton(false);
            return;
        }
        debugLog('Checking VRChat account link status...');
        // Request link status from server via WebSocket
        try {
            const status = await window.electronAPI.checkVRChatLink();
            if (status && status.linked) {
                debugLog(`VRChat account already linked: ${status.vrchatUsername}`);
                updateVRChatLinkButton(true);
            } else {
                updateVRChatLinkButton(false);
            }
        } catch (error) {
            debugLog(`Error checking link status: ${error.message}`, 'error');
            updateVRChatLinkButton(false);
        }
    } catch (error) {
        debugLog(`Error checking VRChat link status: ${error.message}`, 'error');
        updateVRChatLinkButton(false);
    }
}

/**
 * Update the VRChat link button display
 */
function updateVRChatLinkButton(linked) {
    const linkBtn = document.getElementById('vrchat-link-arc-btn');
    const linkedBtn = document.getElementById('vrchat-linked-arc-btn');
    if (linked) {
        // Show "Account Linked" button (gray, disabled)
        if (linkBtn) linkBtn.style.display = 'none';
        if (linkedBtn) linkedBtn.style.display = 'inline-block';
    } else {
        // Show "Link to ARC" button
        if (linkBtn) linkBtn.style.display = 'inline-block';
        if (linkedBtn) linkedBtn.style.display = 'none';
    }
}

/**
 * Refresh VRChat API status
 */
async function refreshVRChatApiStatus() {
    try {
        debugLog('Refreshing VRChat API stats...');
        await loadVRChatApiStatus();
        await loadVRChatApiStats();
        await checkVRChatLinkStatus();
        debugLog('VRChat API stats refreshed');
    } catch (error) {
        debugLog(`Error refreshing VRChat API status: ${error.message}`, 'error');
    }
}

/**
 * Load VRChat API stats (avatars, friends, etc.)
 */
async function loadVRChatApiStats() {
    try {
        if (!vrchatApiStatus.authenticated) {
            return;
        }
        debugLog('Loading VRChat API stats...');
        const stats = await window.electronAPI.vrchatApiGetStats();
        if (stats.success) {
            // Update avatar count
            const avatarCount = document.getElementById('vrchatapi-avatar-count');
            if (avatarCount) avatarCount.textContent = stats.uploadedAvatars || '0';
            
            // Update favorited avatars count
            const favoriteCount = document.getElementById('vrchatapi-favorite-avatar-count');
            if (favoriteCount) favoriteCount.textContent = stats.favoritedAvatars || '0';
            
            // Update friends online count
            const friendsOnline = document.getElementById('vrchatapi-friends-online');
            if (friendsOnline) friendsOnline.textContent = stats.friendsOnline || '0';
            
            debugLog('VRChat API stats loaded successfully');
        } else {
            debugLog(`Failed to load VRChat API stats: ${stats.error}`, 'error');
            // Show dash on error
            const avatarCount = document.getElementById('vrchatapi-avatar-count');
            if (avatarCount) avatarCount.textContent = '-';
            const favoriteCount = document.getElementById('vrchatapi-favorite-avatar-count');
            if (favoriteCount) favoriteCount.textContent = '-';
            const friendsOnline = document.getElementById('vrchatapi-friends-online');
            if (friendsOnline) friendsOnline.textContent = '-';
        }
    } catch (error) {
        debugLog(`Error loading VRChat API stats: ${error.message}`, 'error');
    }
}

// Export functions to global scope for onclick handlers
window.VRChatAPIUI = {
    loadVRChatApiStatus,
    loadVRChatApiStats,
    vrchatApiLogin,
    vrchatApiVerify2FA,
    vrchatApiCancel2FA,
    vrchatApiLogout,
    shareVRChatWithARC,
    closeVRChatLinkModal,
    confirmVRChatLink,
    closeVRChatLinkSuccessModal,
    refreshVRChatApiStatus,
    updateVRChatApiUI
};
