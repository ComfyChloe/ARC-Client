let additionalOscConnections = [];
let maxAdditionalConnections = 20;
let oscEnabled = false;
let oscToggling = false;
let wsForwardingEnabled = false;
// WebSocket connection state
let isConnected = false;
let isAuthenticated = false;
let currentUser = null;
let currentAvatar = null;
let parameters = {};
let appSettings = {};
let currentTheme = 'light';
let panelConnectionsData = {};
let panelUpdateInterval = null;
// Runtime timer
let startTime = Date.now();
let runtimeInterval = null;
// OSC message rate limiting
let oscLogBuffer = [];
let lastOscLogFlush = 0;
const OSC_LOG_BUFFER_SIZE = 100; // Reduced for better memory management
const OSC_LOG_FLUSH_INTERVAL = 1000; // Flush every 1 second
const MAX_LOG_ENTRIES = 5000; // Maximum log entries to keep in DOM (balances memory vs visibility)
// Float rate limiting (similar to server implementation)
const FLOAT_THROTTLE_INTERVAL = 750; // ms
let lastFloatLogTimes = new Map(); // Track last log time per address
let pendingFloatTimeouts = new Map(); // Track pending timeouts for float logging
let lastFloatValues = new Map(); // Store latest values for delayed logging
// Interval handles (stored so they can be cleared on shutdown)
let oscFlushInterval = null;
let cleanupInterval = null;
// Parameter list diffing - keep a map of existing DOM rows keyed by param name
let parameterElements = new Map();
let paramUpdateTimer = null;
// OSC log container visibility tracking for scroll gating
let logsViewVisible = false;
// Websocket connection states end

// Stop all view-specific intervals to prevent memory leaks
function stopAllViewIntervals() {
    // Mark logs view as hidden for scroll gating
    logsViewVisible = false;
    // Stop Hyperate status updates
    if (typeof stopHyperateStatusUpdates === 'function') {
        stopHyperateStatusUpdates();
    }
    // Stop panel update interval
    if (panelUpdateInterval) {
        clearInterval(panelUpdateInterval);
        panelUpdateInterval = null;
    }
    // Enforce Map size limits during view switches
    enforceMapSizeLimits();
}

// Global error handlers for renderer process
window.addEventListener('error', (event) => {
    try {
        const errorInfo = {
            message: event.message,
            filename: event.filename,
            lineno: event.lineno,
            colno: event.colno,
            stack: event.error ? event.error.stack : 'No stack trace',
            timestamp: new Date().toISOString()
        };
        
        const context = {
            url: window.location.href,
            userAgent: navigator.userAgent,
            oscEnabled,
            isConnected,
            isAuthenticated
        };
        
        // Send to main process for logging
        if (window.electronAPI && window.electronAPI.logRendererError) {
            window.electronAPI.logRendererError(errorInfo, context);
        }
        
        // Also log to console for development
        console.error('[RENDERER ERROR CAPTURED]', errorInfo);
    } catch (err) {
        console.error('Failed to log renderer error:', err);
    }
});

window.addEventListener('unhandledrejection', (event) => {
    try {
        const reason = event.reason;
        const errorInfo = {
            message: reason && reason.message ? reason.message : String(reason),
            stack: reason && reason.stack ? reason.stack : 'No stack trace',
            type: 'unhandledrejection',
            timestamp: new Date().toISOString()
        };
        
        const context = {
            url: window.location.href,
            userAgent: navigator.userAgent,
            oscEnabled,
            isConnected,
            isAuthenticated
        };
        
        // Send to main process for logging
        if (window.electronAPI && window.electronAPI.logRendererError) {
            window.electronAPI.logRendererError(errorInfo, context);
        }
        
        // Also log to console for development
        console.error('[RENDERER UNHANDLED REJECTION CAPTURED]', errorInfo);
    } catch (err) {
        console.error('Failed to log unhandled rejection:', err);
    }
});

// Override console.error to capture and forward errors
const originalConsoleError = console.error;
console.error = function(...args) {
    // Call original console.error
    originalConsoleError.apply(console, args);
    
    try {
        // Skip if this is our own error logging to prevent recursion
        if (args[0] && typeof args[0] === 'string' && args[0].includes('[RENDERER')) {
            return;
        }
        
        const context = {
            location: window.location.href,
            timestamp: new Date().toISOString(),
            oscEnabled,
            isConnected,
            isAuthenticated
        };
        
        // Convert args to serializable format
        const serializedArgs = args.map(arg => {
            if (arg instanceof Error) {
                return {
                    message: arg.message,
                    stack: arg.stack,
                    name: arg.name
                };
            }
            if (typeof arg === 'object') {
                try {
                    return JSON.stringify(arg);
                } catch (e) {
                    return String(arg);
                }
            }
            return String(arg);
        });
        
        // Send to main process for logging
        if (window.electronAPI && window.electronAPI.logRendererConsoleError) {
            window.electronAPI.logRendererConsoleError(serializedArgs, context);
        }
    } catch (err) {
        originalConsoleError('Failed to log console error:', err);
    }
};

document.addEventListener('DOMContentLoaded', async () => {
    await loadConfig();
    await loadAppSettings();
    await loadLastUsername();
    await loadTheme();
    setupEventListeners();
    setupExtrasDropdown();
    setupVRChatApiDropdown();
    // Initialize VRChat API session on startup
    setTimeout(() => {
        if (typeof loadVRChatApiStatus === 'function') {
            loadVRChatApiStatus();
        }
    }, 500);
    
    // Load OSC Query unsubscriptions on app start (visible whether OSC is enabled or not)
    await loadOscQueryUnsubscriptions();
    // Load blocked parameters display
    await loadBlockedParameters();
    
    const navMain = document.getElementById('nav-main');
    const navOsc = document.getElementById('nav-osc');
    const navLogs = document.getElementById('nav-logs');
    const navSettings = document.getElementById('nav-settings');
    navMain.classList.add('active');
    navMain.disabled = true;
    navOsc.classList.remove('active');
    navOsc.disabled = false;
    navLogs.classList.remove('active');
    navLogs.disabled = false;
    navSettings.classList.remove('active');
    navSettings.disabled = false;
    debugLog('Application initialized');
    // Initialize runtime timer
    initializeRuntimeTimer();

    // Add username auto-save functionality and Enter key support
    setTimeout(() => {
        const usernameInput = document.getElementById('username');
        const passwordInput = document.getElementById('password');
        const savePasswordCheckbox = document.getElementById('save-password-checkbox');
        if (usernameInput) {
            let saveTimeout;
            // Auto-save username as user types
            usernameInput.addEventListener('input', (e) => {
                // Clear previous timeout
                if (saveTimeout) {
                    clearTimeout(saveTimeout);
                }
                // Debounce the save operation to avoid excessive calls
                saveTimeout = setTimeout(async () => {
                    const username = e.target.value.trim().toLowerCase();
                    if (username) {
                        try {
                            await window.electronAPI.setLastUsername(username);
                        } catch (error) {
                            // Silently fail on error
                            console.warn('Could not auto-save username:', error.message);
                        }
                    }
                }, 1000);
            });
            // Enter key support for username field
            usernameInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    authenticate();
                }
            });
        }
        // Enter key support for password field
        if (passwordInput) {
            passwordInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    authenticate();
                }
            });
        }
        // Handle save password checkbox
        if (savePasswordCheckbox) {
            savePasswordCheckbox.addEventListener('change', handleSavePasswordCheckbox);
        }
        // Load saved password setting on startup
        loadSavedPasswordSetting();
    }, 100);
    // Set up periodic OSC log buffer flushing
    oscFlushInterval = setInterval(() => {
        if (oscLogBuffer.length > 0) {
            flushOscLogBuffer();
        }
    }, OSC_LOG_FLUSH_INTERVAL);
    // Periodic memory cleanup (every 10 seconds)
    cleanupInterval = setInterval(() => {
        // Clear float rate limiting data periodically
        clearFloatRateLimitingData();
        // Enforce Map size limits
        enforceMapSizeLimits();
    }, 10000);
    // Initialize OscGoesBrrr view
    if (typeof initOgbView === 'function') {
        initOgbView();
    }
});
async function loadConfig() {
    try {
        const config = await window.electronAPI.getServerConfig();
        document.getElementById('local-port-settings').value = config.localOscPort;
        document.getElementById('target-port-settings').value = config.targetOscPort;
        document.getElementById('target-address-settings').value = config.targetOscAddress;
        document.getElementById('oscquery-bind-address-settings').value = config.oscQueryBindAddress || '0.0.0.0';
        // Set WebSocket server URL
        const serverUrlInput = document.getElementById('server-url-settings');
        if (serverUrlInput) {
            serverUrlInput.value = config.websocketServerUrl || 'wss://arcosc.app:48255';
            // Detect and update the current server status
            detectCurrentServer();
        }
        if (config.additionalOscConnections) {
            additionalOscConnections = config.additionalOscConnections;
            renderAdditionalOscConnections();
        }
        debugLog('Configuration loaded from saved settings');
    } catch (error) {
        debugLog(`Error loading config: ${error.message}`, 'error');
    }
}
function setupEventListeners() {
    window.electronAPI.onOscReceived((data) => {
        oscReceivedLog(data.address, data.value, data.connectionId);
    });
    window.electronAPI.onOscForwarded((data) => {
        oscForwardedLog(data.address, data.value, data.connectionId);
    });
    // batched OSC messages
    if (window.electronAPI.onOscReceivedBatch) {
        window.electronAPI.onOscReceivedBatch((batch) => {
            for (const data of batch) {
                oscReceivedLog(data.address, data.value, data.connectionId);
            }
        });
    }
    if (window.electronAPI.onOscForwardedBatch) {
        window.electronAPI.onOscForwardedBatch((batch) => {
            for (const data of batch) {
                oscForwardedLog(data.address, data.value, data.connectionId);
            }
        });
    }
    // Handle memory pressure signals
    if (window.electronAPI.onMemoryPressure) {
        window.electronAPI.onMemoryPressure((data) => {
            debugLog(`⚠️ Memory pressure: ${data.memoryMB}MB - performing emergency cleanup`, 'warn');
            rotateLogContainers();
            clearFloatRateLimitingData();
            enforceMapSizeLimits();
            if (window.gc) window.gc();
        });
    }
    window.electronAPI.onOscServerStatus((data) => {
        console.log('OSC Server status update:', data);
        if (data.status === 'connection-ready' || data.status === 'connection-error') {
            const statusText = data.status === 'connection-ready' ? 'Ready' : 'Error';
            debugLog(`Additional OSC ${data.type} connection (${data.name || data.connectionId}): ${statusText} on port ${data.port}`);
            return;
        }
        updateOscStatus(data.status, data.port);
        if (data.status === 'connected') {
            debugLog(`OSC Server listening on port ${data.port}`);
        } else if (data.status === 'error') {
            debugLog(`OSC Server error: ${data.error}`, 'error');
        }
    });
    // Handle OSC Query status updates
    if (window.electronAPI.onOscQueryStatus) {
        window.electronAPI.onOscQueryStatus((data) => {
            if (data.status === 'started') {
                debugLog(`OSC-Query service started on HTTP port ${data.httpPort}`, 'success');
                loadOscQueryUnsubscriptions();
            } else if (data.status === 'error') {
                debugLog(`OSC-Query service error: ${data.error}`, 'error');
            } else if (data.status === 'stopped') {
                debugLog('OSC-Query service stopped');
            }
        });
    }
    // Handle server blocklist/suppression live updates
    if (window.electronAPI.onParameterBlocklistUpdated) {
        window.electronAPI.onParameterBlocklistUpdated(() => loadBlockedParameters());
    }
    if (window.electronAPI.onParametersSuppressed) {
        window.electronAPI.onParametersSuppressed(() => loadBlockedParameters());
    }
    if (window.electronAPI.onParametersUnsuppressed) {
        window.electronAPI.onParametersUnsuppressed(() => loadBlockedParameters());
    }
    if (window.electronAPI.onUnsuppressDenied) {
        window.electronAPI.onUnsuppressDenied((data) => {
            debugLog(`⚠️ Unsuppress denied for ${data?.address}: ${data?.reason}`, 'error');
        });
    }
    // Handle app settings event from main process
    window.electronAPI.onAppSettings((settings) => {
        console.log('Received app settings from main process:', settings);
        // Store for later use
        appSettings = settings;
        // Initialize WebSocket forwarding status
        wsForwardingEnabled = settings.enableWebSocketForwarding || false;
        updateWebSocketForwardingStatus(wsForwardingEnabled);
    });
    // WebSocket event listeners
    window.electronAPI.onWebSocketStatus((data) => {
        console.log('WebSocket status update:', data);
        debugLog(`WebSocket status changed to: ${data.status}`);
        updateServerConnectionStatus(data.status);
        if (data.status === 'connected') {
            isConnected = true;
            debugLog('Connected to WebSocket server');
            checkVRChatLinkStatus();
        } else if (data.status === 'disconnected') {
            isConnected = false;
            isAuthenticated = false;
            currentUser = null;
            currentAvatar = null;
            parameters = {};
            parameterElements.clear();
            // Clear float rate limiting data on WebSocket disconnect and perform log rotation
            clearFloatRateLimitingData();
            rotateLogContainers();
            if (window.gc) window.gc();
            debugLog('Disconnected from WebSocket server - performed memory cleanup');
            updateUI();
            updateAvatarDisplay();
            updateParameterList();
        }
    });
    window.electronAPI.onWebSocketError((data) => {
        console.log('WebSocket error:', data);
        debugLog(`WebSocket connection error: ${data.error} (Attempt ${data.attempts}/${data.maxAttempts})`, 'error');
    });
    window.electronAPI.onWebSocketAuthenticated((data) => {
        console.log('WebSocket authenticated:', data);
        isAuthenticated = true;
        currentUser = { username: data.username };
        debugLog(`Authenticated as ${data.username} in room ${data.room}`);
        updateUI();
        updateAvatarDisplay();
        updateParameterList();
    });
    window.electronAPI.onWebSocketOscData((data) => {
        if (wsForwardingEnabled) {
            addToOscArcReceivedLog(data.address, data.value);
        }
    });
    window.electronAPI.onWebSocketAvatarChange((data) => {
        console.log('Avatar change received:', data);
        // Handle avatar unload (null/empty avatar)
        if (!data.id || data.id === null) {
            currentAvatar = null;
            parameters = {}; // Clear parameters when avatar is unloaded
            parameterElements.clear();
            updateAvatarDisplay();
            updateParameterList();
            debugLog(`Avatar unloaded for user ${data.username}`);
            return;
        }
        // Store the full avatar data including ID, name, and username
        currentAvatar = {
            id: data.id,
            name: data.name, // Server-provided name
            username: data.username,
            // Use server-provided name or fall back to extracted display name
            displayName: data.name || getDisplayNameFromAvatarId(data.id)
        };
        updateAvatarDisplay();
        const displayName = data.name ? `${data.name} (${data.id})` : data.id;
        debugLog(`Avatar changed: ${displayName} for user ${data.username}`);
    });
    window.electronAPI.onWebSocketParameterUpdate((data) => {
        if (data.parameters) {
            Object.assign(parameters, data.parameters);
            // Debounce DOM update — batch rapid-fire parameter changes into one render pass
            if (paramUpdateTimer) clearTimeout(paramUpdateTimer);
            paramUpdateTimer = setTimeout(() => {
                paramUpdateTimer = null;
                updateParameterList();
            }, 250);
        }
    });
    window.electronAPI.onWebSocketServerMessage((data) => {
        debugLog(`Server message: ${data.message || JSON.stringify(data)}`);
    });
    window.electronAPI.onWebSocketPanelConnectionsUpdate((data) => {
        console.log('Panel connections update received:', data);
        console.log('Number of panels received:', Object.keys(data).length);
        console.log('Panel IDs:', Object.keys(data));
        panelConnectionsData = data;
        renderPanelDashboard();
    });
}
function updateOscStatus(status, port) {
    const indicator = document.getElementById('osc-status');
    const text = document.getElementById('osc-status-text');
    const toggleBtn = document.getElementById('osc-toggle-btn');
    indicator.className = 'status-indicator';
    
    switch (status) {
        case 'connected':
            indicator.classList.add('status-connected');
            text.textContent = `OSC Status: Enabled :${port}`;
            toggleBtn.textContent = 'Disable OSC';
            toggleBtn.className = 'btn btn-danger';
            toggleBtn.disabled = false;
            oscEnabled = true;
            break;
        case 'stopping':
            indicator.classList.add('status-warning');
            text.textContent = 'OSC Status: Stopping...';
            toggleBtn.textContent = 'Stopping...';
            toggleBtn.className = 'btn btn-secondary';
            toggleBtn.disabled = true; // Disable button while stopping
            break;
        case 'disabled':
            indicator.classList.add('status-disconnected');
            text.textContent = 'OSC Status: Disabled';
            toggleBtn.textContent = 'Enable OSC';
            toggleBtn.className = 'btn btn-primary';
            toggleBtn.disabled = false;
            oscEnabled = false;
            break;
        case 'error':
            indicator.classList.add('status-disconnected');
            text.textContent = 'OSC Status: Error';
            toggleBtn.textContent = 'Enable OSC';
            toggleBtn.className = 'btn btn-primary';
            toggleBtn.disabled = false;
            oscEnabled = false;
            break;
        default:
            indicator.classList.add('status-disconnected');
            text.textContent = 'OSC Status: Off';
            toggleBtn.textContent = 'Enable OSC';
            toggleBtn.className = 'btn btn-primary';
            toggleBtn.disabled = false;
            oscEnabled = false;
    }
}
function updateWebSocketForwardingStatus(enabled) {
    const indicator = document.getElementById('ws-forwarding-status');
    const text = document.getElementById('ws-forwarding-status-text');
    const toggleBtn = document.getElementById('ws-forwarding-toggle-btn');
    if (!indicator || !text || !toggleBtn) {
        return; // Elements not found, skip update
    }
    indicator.className = 'status-indicator';
    if (enabled) {
        indicator.classList.add('status-connected');
        text.textContent = 'ARC Server Transmit: Enabled';
        toggleBtn.textContent = 'Disable ARC Server Transmit';
        toggleBtn.className = 'btn btn-danger';
        wsForwardingEnabled = true;
    } else {
        indicator.classList.add('status-disconnected');
        text.textContent = 'ARC Server Transmit: Disabled';
        toggleBtn.textContent = 'Enable ARC Server Transmit';
        toggleBtn.className = 'btn btn-primary';
        wsForwardingEnabled = false;
    }
}
function updateServerConnectionStatus(status) {
    console.log('updateServerConnectionStatus called with:', status);
    debugLog(`Connection status update: ${status}`);
    const indicator = document.getElementById('server-status');
    const text = document.getElementById('server-status-text');
    indicator.className = 'status-indicator';
    switch (status) {
        case 'connected':
            indicator.classList.add('status-connected');
            text.textContent = 'Connected';
            break;
        case 'disconnected':
            indicator.classList.add('status-disconnected');
            text.textContent = 'Disconnected';
            break;
        case 'connecting':
            indicator.classList.add('status-connecting');
            text.textContent = 'Connecting...';
            break;
        case 'error':
            indicator.classList.add('status-disconnected');
            text.textContent = 'Connection Error';
            break;
        default:
            indicator.classList.add('status-disconnected');
            text.textContent = 'Disconnected';
    }
}
function updateUI() {
    const authBtn = document.getElementById('auth-btn');
    const authSection = document.getElementById('auth-section');
    const avatarSection = document.getElementById('avatar-section');
    if (isAuthenticated && isConnected) {
        authBtn.textContent = 'Disconnect';
        authBtn.className = 'btn btn-danger';
        authBtn.onclick = disconnect;
        avatarSection.style.display = 'block';
    } else {
        authBtn.textContent = 'Connect & Login';
        authBtn.className = 'btn btn-success';
        authBtn.onclick = authenticate;
        avatarSection.style.display = 'none';
    }
}
async function updateConfig() {
    try {
        const config = {
            serverUrl: document.getElementById('server-url-settings').value,
            localOscPort: parseInt(document.getElementById('local-port-settings').value),
            targetOscPort: parseInt(document.getElementById('target-port-settings').value),
            targetOscAddress: document.getElementById('target-address-settings').value
        };
        await window.electronAPI.setConfig(config);
        debugLog('Configuration updated - OSC services will restart');
    } catch (error) {
        debugLog(`Error updating config: ${error.message}`, 'error');
    }
}
async function updateConfigFromSettings() {
    try {
        const serverUrl = document.getElementById('server-url-settings').value;
        
        // Block official server URLs - use the Quick Server Selection buttons for those
        if (serverUrl.includes('arcosc.app') || serverUrl.includes('beta.arcosc.app')) {
            debugLog('Use Quick Server Selection buttons for Live/Beta servers', 'warning');
            return;
        }
        
        const config = {
            websocketServerUrl: serverUrl
        };
        
        // Disconnect if currently connected
        if (isConnected) {
            debugLog('Disconnecting to apply custom server URL...');
            await window.electronAPI.disconnectServer();
        }
        
        await window.electronAPI.setConfig(config);
        detectCurrentServer();
        debugLog('Custom server URL updated');
    } catch (error) {
        debugLog(`Error updating server config: ${error.message}`, 'error');
    }
}
function initializeRuntimeTimer() {
    startTime = Date.now();
    updateRuntimeDisplay();
    runtimeInterval = setInterval(updateRuntimeDisplay, 1000);
}
function updateRuntimeDisplay() {
    const elapsed = Date.now() - startTime;
    const hours = Math.floor(elapsed / (1000 * 60 * 60));
    const minutes = Math.floor((elapsed % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((elapsed % (1000 * 60)) / 1000);
    const timeString = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    const runtimeDisplay = document.getElementById('runtime-display');
    if (runtimeDisplay) {
        runtimeDisplay.textContent = timeString;
    }
}
async function switchToServer(serverType) {
    try {
        let serverUrl;
        let serverName;
        
        switch (serverType) {
            case 'live':
                serverUrl = 'wss://arcosc.app:48255';
                serverName = 'ARC-Live';
                break;
            case 'beta':
                serverUrl = 'wss://beta.arcosc.app:48255';
                serverName = 'ARC-Beta';
                break;
            case 'custom':
                serverUrl = 'wss://127.0.0.1:48255';
                serverName = 'Custom (Dev)';
                break;
            default:
                throw new Error('Unknown server type');
        }
        
        // Update the URL input field
        document.getElementById('server-url-settings').value = serverUrl;
        
        // Update the current server status
        updateCurrentServerStatus(serverName, serverType);
        
        // Disconnect if currently connected
        const wasConnected = isConnected;
        if (wasConnected) {
            debugLog(`Disconnecting from current server to switch to ${serverName}...`);
            await window.electronAPI.disconnectServer();
            // Small delay to ensure disconnect event is fully processed
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        // Update the configuration
        const config = {
            websocketServerUrl: serverUrl
        };
        
        // Save configuration for all server types (including custom)
        await window.electronAPI.setConfig(config);
        if (serverType === 'custom') {
            debugLog(`Switched to ${serverName} (${serverUrl}) - configuration saved`);
        } else {
            debugLog(`Switched to ${serverName} (${serverUrl}) - configuration saved`);
        }
        
        // Auto-reconnect if we were previously connected
        if (wasConnected) {
            const username = document.getElementById('username').value;
            const password = document.getElementById('password').value;
            debugLog(`Auto-reconnect check: wasConnected=${wasConnected}, username=${username ? 'present' : 'missing'}, password=${password ? 'present' : 'missing'}`);
            if (username && password) {
                debugLog(`Scheduling auto-reconnect to ${serverName}...`);
                setTimeout(async () => {
                    // Check if we're still not connected after the server switch
                    if (!isConnected) {
                        try {
                            debugLog(`Auto-reconnecting to ${serverName}...`);
                            await authenticate();
                            debugLog(`Successfully reconnected to ${serverName}`);
                        } catch (error) {
                            debugLog(`Failed to reconnect to ${serverName}: ${error.message}`, 'error');
                        }
                    } else {
                        debugLog('Already connected, skipping auto-reconnect');
                    }
                }, 1000);
            } else {
                debugLog('Auto-reconnect skipped: missing credentials', 'warning');
            }
        } else {
            debugLog('Auto-reconnect skipped: was not previously connected');
        }
        
    } catch (error) {
        debugLog(`Error switching servers: ${error.message}`, 'error');
    }
}
function updateCurrentServerStatus(serverName, serverType) {
    const statusElement = document.getElementById('current-server-status');
    const nameElement = document.getElementById('current-server-name');
    
    if (nameElement) {
        nameElement.textContent = serverName;
    }
    
    if (statusElement) {
        // Update border color based on server type
        let borderColor = '#3498db'; // default blue
        switch (serverType) {
            case 'live':
                borderColor = '#3498db'; // blue
                break;
            case 'beta':
                borderColor = '#95a5a6'; // grey
                break;
            case 'custom':
                borderColor = '#f39c12'; // orange
                break;
        }
        statusElement.style.borderLeftColor = borderColor;
    }
    
    // Update button active states
    updateServerButtonStates(serverType);
}
function updateServerButtonStates(activeServerType) {
    // Remove active class from all buttons
    const buttons = ['server-btn-live', 'server-btn-beta', 'server-btn-custom'];
    buttons.forEach(buttonId => {
        const button = document.getElementById(buttonId);
        if (button) {
            button.classList.remove('server-btn-active');
        }
    });
    
    // Add active class to the current server button
    const activeButtonId = `server-btn-${activeServerType}`;
    const activeButton = document.getElementById(activeButtonId);
    if (activeButton) {
        activeButton.classList.add('server-btn-active');
    }
}
function detectCurrentServer() {
    const serverUrl = document.getElementById('server-url-settings').value;
    
    if (serverUrl.includes('beta.arcosc.app')) {
        updateCurrentServerStatus('ARC-Beta', 'beta');
    } else if (serverUrl.includes('arcosc.app')) {
        updateCurrentServerStatus('ARC-Live', 'live');
    } else {
        // Any other URL is treated as custom
        updateCurrentServerStatus('Custom (Dev)', 'custom');
    }
}

/**
 * Validate IPv4 address format
 * @param {string} ip - IP address to validate
 * @returns {boolean} - True if valid IPv4 address
 */
function isValidIPv4(ip) {
    const ipv4Regex = /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    return ipv4Regex.test(ip);
}

/**
 * Validate port number
 * @param {number} port - Port number to validate
 * @returns {boolean} - True if valid port (1-65535)
 */
function isValidPort(port) {
    const portNum = parseInt(port);
    return !isNaN(portNum) && portNum >= 1 && portNum <= 65535;
}

async function updateOscPorts() {
    try {
        // Get values
        const localPort = parseInt(document.getElementById('local-port-settings').value);
        const targetPort = parseInt(document.getElementById('target-port-settings').value);
        const targetAddress = document.getElementById('target-address-settings').value.trim();
        const oscQueryBindAddress = document.getElementById('oscquery-bind-address-settings').value.trim();

        // Validate ports
        if (!isValidPort(localPort)) {
            debugLog('Invalid legacy incoming OSC port. Must be between 1 and 65535.', 'error');
            return;
        }
        if (!isValidPort(targetPort)) {
            debugLog('Invalid target OSC port. Must be between 1 and 65535.', 'error');
            return;
        }

        // Validate IP addresses
        if (!isValidIPv4(targetAddress)) {
            debugLog('Invalid target IP address. Must be a valid IPv4 address (e.g., 127.0.0.1).', 'error');
            return;
        }
        if (!isValidIPv4(oscQueryBindAddress)) {
            debugLog('Invalid OSC-Query bind address. Must be a valid IPv4 address (e.g., 0.0.0.0 or 127.0.0.1).', 'error');
            return;
        }

        const config = {
            localOscPort: localPort,
            targetOscPort: targetPort,
            targetOscAddress: targetAddress,
            oscQueryBindAddress: oscQueryBindAddress
        };
        await window.electronAPI.setConfig(config);
        debugLog('OSC configuration updated - OSC services will restart');
    } catch (error) {
        debugLog(`Error updating OSC configuration: ${error.message}`, 'error');
    }
}

async function toggleOscServer() {
    // Prevent multiple simultaneous toggle attempts
    if (oscToggling) {
        debugLog('OSC toggle already in progress, please wait...', 'warn');
        return;
    }
    try {
        oscToggling = true;
        if (oscEnabled) {
            await window.electronAPI.disableOsc();
            oscEnabled = false;
            debugLog('OSC Server disabled');
        } else {
            await window.electronAPI.enableOsc();
            oscEnabled = true;
            debugLog('OSC Server enabled');
        }
    } catch (error) {
        debugLog(`Error toggling OSC server: ${error.message}`, 'error');
    } finally {
        oscToggling = false;
    }
}
async function toggleWebSocketForwarding() {
    try {
        const newState = !wsForwardingEnabled;
        const result = await window.electronAPI.setWebSocketForwarding(newState);
        if (result.success) {
            wsForwardingEnabled = result.enabled;
            updateWebSocketForwardingStatus(wsForwardingEnabled);
            debugLog(`ARC Server transmit ${wsForwardingEnabled ? 'enabled' : 'disabled'}`);
        } else {
            debugLog(`Error toggling ARC Server transmit: ${result.error}`, 'error');
        }
    } catch (error) {
        debugLog(`Error toggling ARC Server transmit: ${error.message}`, 'error');
    }
}
async function authenticate() {
    if (isAuthenticated && isConnected) {
        disconnect();
        return;
    }
    const username = document.getElementById('username').value.trim().toLowerCase();
    const password = document.getElementById('password').value;
    if (!username || !password) {
        debugLog('Please enter username and password', 'error');
        return;
    }
    try {
        debugLog('Connecting to server...');
        updateServerConnectionStatus('connecting');
        const result = await window.electronAPI.authenticate({ username, password });
        if (result.success) {
            isConnected = true;
            isAuthenticated = true;
            currentUser = result.user;
            debugLog(`Successfully authenticated as ${username}`);
            updateUI();
            // Save the username for next time
            try {
                await window.electronAPI.setLastUsername(username);
                debugLog(`Username saved for future use`);
            } catch (saveError) {
                debugLog(`Could not save username: ${saveError.message}`, 'warning');
            }
        } else {
            debugLog(`Authentication failed: ${result.error}`, 'error');
            updateServerConnectionStatus('error');
        }
    } catch (error) {
        debugLog(`Authentication error: ${error.message}`, 'error');
        updateServerConnectionStatus('error');
    }
}
async function disconnect() {
    try {
        await window.electronAPI.disconnectServer();
        isConnected = false;
        isAuthenticated = false;
        currentUser = null;
        currentAvatar = null;
        parameters = {};
        parameterElements.clear();
        // Clear float rate limiting data on disconnect
        clearFloatRateLimitingData();
        updateUI();
        updateAvatarDisplay();
        updateParameterList();
        updateServerConnectionStatus('disconnected');
        debugLog('Disconnected from server');
    } catch (error) {
        debugLog(`Disconnect error: ${error.message}`, 'error');
    }
}
async function unloadAvatar() {
    if (!isAuthenticated || !isConnected) {
        debugLog('Cannot unload avatar: not connected to server', 'error');
        return;
    }
    try {
        debugLog('Unloading current avatar...');
        // Send a special OSC message to VRChat to "change" to a null avatar
        // This simulates VRChat sending /avatar/change with a null or empty value
        const result = await window.electronAPI.sendWebSocketMessage('avatar-unload', {
            username: currentUser.username
        });
        if (result && result.success) {
            debugLog('Avatar unload request sent successfully');
        } else {
            debugLog(`Avatar unload failed: ${result?.error || 'Unknown error'}`, 'error');
        }
    } catch (error) {
        debugLog(`Error unloading avatar: ${error.message}`, 'error');
    }
}
function updateAvatarDisplay() {
    const avatarSection = document.getElementById('avatar-section');
    const avatarName = document.getElementById('avatar-name');
    const avatarId = document.getElementById('avatar-id');
    const unloadBtn = document.getElementById('avatar-unload-btn');
    
    if (isAuthenticated && currentAvatar) {
        avatarSection.style.display = 'block';
        // Display the human-readable name or fallback to "Unknown Avatar"
        avatarName.textContent = currentAvatar.displayName || 'Unknown Avatar';
        // Display the full avatar ID
        avatarId.textContent = `ID: ${currentAvatar.id}`;
        avatarId.style.display = 'block';
        // Show the unload button when an avatar is loaded
        unloadBtn.style.display = 'block';
    } else if (isAuthenticated) {
        avatarSection.style.display = 'block';
        avatarName.textContent = 'No avatar detected';
        avatarId.textContent = 'ID: Not available';
        avatarId.style.display = 'block';
        // Hide the unload button when no avatar is detected
        unloadBtn.style.display = 'none';
    } else {
        avatarSection.style.display = 'none';
        // Hide the unload button when not authenticated
        unloadBtn.style.display = 'none';
    }
}
// Helper function to extract a human-readable name from avatar ID
function getDisplayNameFromAvatarId(avatarId) {
    if (!avatarId || typeof avatarId !== 'string') {
        return null;
    }
    // VRChat avatar IDs typically start with "avtr_" followed by a UUID
    // TODO: In the future, this could be enhanced to:
    // 1. Query the server for known avatar names from the config
    // 2. Store local avatar name cache from uploaded JSON files
    // 3. Use VRChat API to resolve avatar names
    if (avatarId.startsWith('avtr_')) {
        // Extract the UUID part and show first 8 characters for readability
        const uuid = avatarId.substring(5); // Remove "avtr_" prefix
        const shortId = uuid.substring(0, 8);
        return `Avatar ${shortId}`;
    }
    // For other avatar ID formats, just return the first 16 characters
    if (avatarId.length > 16) {
        return `${avatarId.substring(0, 16)}...`;
    }
    return avatarId;
}
function updateParameterList() {
    const parameterList = document.getElementById('parameter-list');
    if (!isAuthenticated) {
        parameterList.innerHTML = '<p>Connect and authenticate to view parameters</p>';
        parameterElements.clear();
        return;
    }
    if (Object.keys(parameters).length === 0) {
        parameterList.innerHTML = '<p>No parameters detected. Make sure VRChat is running and avatar has parameters.</p>';
        parameterElements.clear();
        return;
    }
    const currentKeys = new Set(Object.keys(parameters));
    // Remove rows for deleted parameters
    for (const [name, el] of parameterElements) {
        if (!currentKeys.has(name)) {
            el.div.remove();
            parameterElements.delete(name);
        }
    }
    // Add or update rows
    for (const [name, value] of Object.entries(parameters)) {
        const displayValue = typeof value === 'number' ? value.toFixed(3) : value.toString();
        const existing = parameterElements.get(name);
        if (existing) {
            // Only touch DOM if value actually changed
            if (existing.lastValue !== displayValue) {
                existing.valueSpan.textContent = displayValue;
                existing.lastValue = displayValue;
            }
        } else {
            // Create new row
            const paramDiv = document.createElement('div');
            paramDiv.className = 'parameter-item';
            paramDiv.style.cssText = 'display: flex; justify-content: space-between; padding: 8px; border: 1px solid #ddd; margin-bottom: 5px; border-radius: 3px; background: #f9f9f9;';
            const nameSpan = document.createElement('span');
            nameSpan.style.fontWeight = 'bold';
            nameSpan.textContent = name;
            const valueSpan = document.createElement('span');
            valueSpan.style.color = '#666';
            valueSpan.textContent = displayValue;
            paramDiv.appendChild(nameSpan);
            paramDiv.appendChild(valueSpan);
            parameterList.appendChild(paramDiv);
            parameterElements.set(name, { div: paramDiv, valueSpan, lastValue: displayValue });
        }
    }
}
async function sendOscMessage() {
    const address = document.getElementById('osc-address').value;
    const value = document.getElementById('osc-value').value;
    const type = document.getElementById('osc-type').value;
    if (!address || value === '') {
        debugLog('Address and value are required', 'error');
        return;
    }
    try {
        let parsedValue = value;
        switch (type) {
            case 'int':
                parsedValue = parseInt(value);
                if (isNaN(parsedValue)) {
                    throw new Error('Invalid integer value');
                }
                break;
            case 'float':
                parsedValue = parseFloat(value);
                if (isNaN(parsedValue)) {
                    throw new Error('Invalid float value');
                }
                break;
            case 'bool':
                parsedValue = value.toLowerCase() === 'true' || value === '1';
                break;
        }
        const oscData = {
            address,
            value: parsedValue,
            type
        };

        // Send directly to VRChat via local OSC service (same as WebSocket forwarding does)
        const result = await window.electronAPI.sendOscLocal(oscData);
        
        if (result.success) {
            debugLog(`OSC message sent to VRChat: ${address} = ${parsedValue} (${type})`);
        } else {
            throw new Error(result.error || 'Failed to send OSC message');
        }
    } catch (error) {
        debugLog(`Error sending OSC: ${error.message}`, 'error');
    }
}
function showTab(tabName) {
    document.querySelectorAll('.tab-content').forEach(content => {
        content.style.display = tabName === content.id ? 'block' : 'none';
    });
    document.querySelectorAll('.tab').forEach(tab => {
        tab.classList.remove('active');
    });
    event.target.classList.add('active');
}
function isScrolledNearBottom(container, threshold = 20) {
    return container.scrollHeight - container.scrollTop - container.clientHeight <= threshold;
}
function debugLog(message, type = 'info') {
    const container = document.getElementById('client-log-container');
    const timestamp = new Date().toLocaleTimeString();
    let color = '#00ff00'; // Default green
    if (type === 'error') color = '#ff0000';
    else if (type === 'warning') color = '#ffff00';
    let logEntry;
    const atBottom = isScrolledNearBottom(container);
    if (container.children.length >= 100) {
        // Recycle the oldest node instead of create+destroy
        logEntry = container.firstChild;
        container.removeChild(logEntry);
    } else {
        logEntry = document.createElement('div');
    }
    logEntry.style.color = color;
    logEntry.textContent = `[${timestamp}] ${message}`;
    container.appendChild(logEntry);
    if (atBottom) container.scrollTop = container.scrollHeight;
}
// Helper function to determine if a value is a float
function isFloatValue(value) {
    // Check if it's a number and has decimal places, or if it's a string representation of a float
    if (typeof value === 'number') {
        return !Number.isInteger(value);
    }
    if (typeof value === 'string') {
        const num = parseFloat(value);
        return !isNaN(num) && value.includes('.') && !Number.isInteger(num);
    }
    return false;
}
// Handle float OSC messages with rate limiting (similar to server implementation)
function handleFloatOscLog(type, address, value, connectionId) {
    const key = `${type}-${address}`;
    const now = Date.now();
    const lastLogTime = lastFloatLogTimes.get(key) || 0;
    // Store the latest value for this address/type combination
    lastFloatValues.set(key, { type, address, value, connectionId, timestamp: now });
    // Clear any existing timeout for this key
    if (pendingFloatTimeouts.has(key)) {
        clearTimeout(pendingFloatTimeouts.get(key));
    }
    // If enough time has passed since last log, log immediately
    if (now - lastLogTime >= FLOAT_THROTTLE_INTERVAL) {
        logFloatValueImmediate(type, address, value, connectionId);
        lastFloatLogTimes.set(key, now);
        return;
    }
    // Otherwise, set a timeout to log the final value after the throttle interval
    const timeoutId = setTimeout(() => {
        const finalData = lastFloatValues.get(key);
        if (finalData) {
            logFloatValueImmediate(finalData.type, finalData.address, finalData.value, finalData.connectionId);
            lastFloatLogTimes.set(key, Date.now());
        }
        pendingFloatTimeouts.delete(key);
    }, FLOAT_THROTTLE_INTERVAL);
    pendingFloatTimeouts.set(key, timeoutId);
}
// Immediately log a float value to the appropriate container
function logFloatValueImmediate(type, address, value, connectionId) {
    const timestamp = new Date().toLocaleTimeString();
    let container, color;
    switch (type) {
        case 'received':
            container = document.getElementById('osc-received-log-container');
            color = '#00ff00';
            break;
        case 'forwarded':
            container = document.getElementById('osc-forwarded-log-container');
            color = '#00aaff';
            break;
        case 'arc-received':
            container = document.getElementById('osc-arc-received-log-container');
            color = '#ff8c00';
            break;
        default:
            return;
    }
    if (container) {
        const maxEntries = type === 'arc-received' ? 500 : MAX_LOG_ENTRIES;
        let logEntry;
        if (container.children.length >= maxEntries) {
            // Recycle the oldest node instead of create+destroy
            logEntry = container.firstChild;
            container.removeChild(logEntry);
        } else {
            logEntry = document.createElement('div');
        }
        logEntry.style.color = color;
        logEntry.textContent = `[${timestamp}] ${address} = ${value}`;
        container.appendChild(logEntry);
        // Only auto-scroll if the logs view is visible and the user is already at the bottom
        if (logsViewVisible && isScrolledNearBottom(container)) {
            container.scrollTop = container.scrollHeight;
        }
    }
}
// Clear float rate limiting data to prevent memory leaks
function clearFloatRateLimitingData() {
    // Clear all pending timeouts
    pendingFloatTimeouts.forEach(timeoutId => clearTimeout(timeoutId));
    lastFloatLogTimes.clear();
    pendingFloatTimeouts.clear();
    lastFloatValues.clear();
    //debugLog('Float rate limiting data cleared');
}
const MAX_MAP_SIZE = 500; // Prevent unbounded Map growth during extended runtime
// Enforce Map size limits to prevent unbounded growth during extended runtime
function enforceMapSizeLimits() {
    if (lastFloatLogTimes.size > MAX_MAP_SIZE) {
        debugLog(`Clearing float rate limiting Maps (size: ${lastFloatLogTimes.size})`, 'warn');
        clearFloatRateLimitingData();
    }
}
function rotateLogContainers() {
    clearFloatRateLimitingData();
    // Explicitly clear buffer to free memory immediately
    oscLogBuffer = [];
    // Force garbage collection if available
    if (window.gc) window.gc();
}
function oscReceivedLog(address, value, connectionId = null) {
    // Check if this is a float value and apply rate limiting
    if (isFloatValue(value)) {
        handleFloatOscLog('received', address, value, connectionId);
        return;
    }
    // Add to buffer for non-float values
    oscLogBuffer.push({
        type: 'received',
        address,
        value,
        connectionId,
        timestamp: Date.now()
    });
    // If buffer is full or enough time has passed, flush it
    const now = Date.now();
    if (oscLogBuffer.length >= OSC_LOG_BUFFER_SIZE || (now - lastOscLogFlush) >= OSC_LOG_FLUSH_INTERVAL) {
        flushOscLogBuffer();
    }
}
function oscForwardedLog(address, value, connectionId = null) {
    // Check if this is a float value and apply rate limiting
    if (isFloatValue(value)) {
        handleFloatOscLog('forwarded', address, value, connectionId);
        return;
    }
    // Add to buffer for non-float values
    oscLogBuffer.push({
        type: 'forwarded',
        address,
        value,
        connectionId,
        timestamp: Date.now()
    });
    // If buffer is full or enough time has passed, flush it
    const now = Date.now();
    if (oscLogBuffer.length >= OSC_LOG_BUFFER_SIZE || (now - lastOscLogFlush) >= OSC_LOG_FLUSH_INTERVAL) {
        flushOscLogBuffer();
    }
}
function flushOscLogBuffer() {
    if (oscLogBuffer.length === 0) return;
    // More aggressive emergency cleanup
    if (oscLogBuffer.length > 5000) {
        clearFloatRateLimitingData();
        debugLog(`Emergency buffer cleanup - buffer size was ${oscLogBuffer.length}`, 'warning');
        // Only keep the most recent messages (to prevent total loss of context)
        const forwardedOnly = oscLogBuffer.filter(msg => msg.type === 'forwarded').slice(-100);
        oscLogBuffer = forwardedOnly;
        lastOscLogFlush = Date.now();
        if (window.gc) window.gc();
        return;
    }
    const receivedContainer = document.getElementById('osc-received-log-container');
    const forwardedContainer = document.getElementById('osc-forwarded-log-container');
    // Group messages by type for batch DOM updates
    const received = oscLogBuffer.filter(msg => msg.type === 'received');
    const forwarded = oscLogBuffer.filter(msg => msg.type === 'forwarded');
    // Batch update received logs
    if (received.length > 0 && receivedContainer) {
        const fragment = document.createDocumentFragment();
        received.forEach(msg => {
            const timestamp = new Date(msg.timestamp).toLocaleTimeString();
            let logEntry;
            if (receivedContainer.children.length >= MAX_LOG_ENTRIES) {
                logEntry = receivedContainer.firstChild;
                receivedContainer.removeChild(logEntry);
            } else {
                logEntry = document.createElement('div');
            }
            logEntry.style.color = '#00ff00';
            logEntry.textContent = `[${timestamp}] ${msg.address} = ${msg.value}`;
            fragment.appendChild(logEntry);
        });
        receivedContainer.appendChild(fragment);
        if (logsViewVisible && isScrolledNearBottom(receivedContainer)) {
            receivedContainer.scrollTop = receivedContainer.scrollHeight;
        }
    }
    // Batch update forwarded logs
    if (forwarded.length > 0 && forwardedContainer) {
        const fragment = document.createDocumentFragment();
        forwarded.forEach(msg => {
            const timestamp = new Date(msg.timestamp).toLocaleTimeString();
            let logEntry;
            if (forwardedContainer.children.length >= MAX_LOG_ENTRIES) {
                logEntry = forwardedContainer.firstChild;
                forwardedContainer.removeChild(logEntry);
            } else {
                logEntry = document.createElement('div');
            }
            logEntry.style.color = '#00aaff';
            logEntry.textContent = `[${timestamp}] ${msg.address} = ${msg.value}`;
            fragment.appendChild(logEntry);
        });
        forwardedContainer.appendChild(fragment);
        if (logsViewVisible && isScrolledNearBottom(forwardedContainer)) {
            forwardedContainer.scrollTop = forwardedContainer.scrollHeight;
        }
    }
    // Clear buffer and update flush time
    oscLogBuffer = [];
    lastOscLogFlush = Date.now();
}
function clearClientLogs() {
    document.getElementById('client-log-container').innerHTML = '';
    debugLog('Client logs cleared');
}
function clearOscReceivedLogs() {
    document.getElementById('osc-received-log-container').innerHTML = 'No OSC data received yet<br>';
}
function clearOscArcReceivedLogs() {
    document.getElementById('osc-arc-received-log-container').innerHTML = 'No OSC data received from ARC Server yet<br>';
}
function addToOscArcReceivedLog(address, value) {
    // Apply float rate limiting for ARC received logs as well
    if (isFloatValue(value)) {
        handleFloatOscLog('arc-received', address, value, null);
        return;
    }
    
    // Immediate logging for non-float values
    const container = document.getElementById('osc-arc-received-log-container');
    if (container) {
        const timestamp = new Date().toLocaleTimeString();
        let logEntry;
        if (container.children.length >= 500) {
            logEntry = container.firstChild;
            container.removeChild(logEntry);
        } else {
            logEntry = document.createElement('div');
        }
        logEntry.style.color = '#ff8c00'; // Orange color to distinguish from regular OSC
        logEntry.textContent = `[${timestamp}] ${address} = ${value}`;
        container.appendChild(logEntry);
        // Only auto-scroll if the logs view is visible and the user is already at the bottom
        if (logsViewVisible && isScrolledNearBottom(container)) {
            container.scrollTop = container.scrollHeight;
        }
    }
}
function clearOscForwardedLogs() {
    document.getElementById('osc-forwarded-log-container').innerHTML = 'No OSC data forwarded yet<br>';
}
function clearLogs() {
    clearClientLogs();
}
function updateOscPortsFromSettings() {
    return updateOscPorts();
}
function showMainView() {
    // Stop all view-specific intervals to prevent memory leaks
    stopAllViewIntervals();
    const mainView = document.getElementById('main-view');
    const oscView = document.getElementById('osc-view');
    const logsView = document.getElementById('logs-view');
    const settingsView = document.getElementById('settings-view');
    const voskView = document.getElementById('vosk-view');
    const hyperateView = document.getElementById('Hyperate-view');
    const arcfeedbackView = document.getElementById('arcfeedback-view');
    const chatboxView = document.getElementById('chatbox-view');
    const vrchatapiView = document.getElementById('vrchatapi-view');
    const oscLeashView = document.getElementById('osc-leash-view');
    const autoInviterView = document.getElementById('auto-inviter-view');
    const navMain = document.getElementById('nav-main');
    const navOsc = document.getElementById('nav-osc');
    const navLogs = document.getElementById('nav-logs');
    const navSettings = document.getElementById('nav-settings');
    const navVosk = document.getElementById('nav-vosk');
    const navHyperate = document.getElementById('nav-Hyperate');
    const arclinkView = document.getElementById('arclink-view');
    const openshockView = document.getElementById('openshock-view');
    const lovenseView = document.getElementById('lovense-view');
    const autoStatusView = document.getElementById('auto-status-view');
    const calendarView = document.getElementById('calendar-view');
    const vrcTimelineView = document.getElementById('vrc-timeline-view');
    const oscGoesBrrrView = document.getElementById('oscgoesbrrr-view');
    [oscView, logsView, settingsView, voskView, hyperateView, arcfeedbackView, chatboxView, vrchatapiView, oscLeashView, oscGoesBrrrView, autoInviterView, arclinkView, openshockView, lovenseView, autoStatusView, calendarView, vrcTimelineView].forEach(view => {
        if (view) {
            view.style.opacity = '0';
            setTimeout(() => view.style.display = 'none', 300);
        }
    });
    setTimeout(() => {
        mainView.style.display = 'block';
        mainView.style.opacity = '0';
        requestAnimationFrame(() => {
            mainView.style.opacity = '1';
        });
    }, 300);
    // Reset all navigation buttons
    [navOsc, navLogs, navSettings].forEach(nav => {
        nav.classList.remove('active');
        nav.disabled = false;
    });
    // Reset all tree-child buttons
    const treeChildren = document.querySelectorAll('.tree-child');
    treeChildren.forEach(child => {
        child.classList.remove('active');
        child.disabled = false;
    });
    navMain.classList.add('active');
    navMain.disabled = true;
    debugLog('Switched to main view');
}
function showOscView() {
    const mainView = document.getElementById('main-view');
    const oscView = document.getElementById('osc-view');
    const logsView = document.getElementById('logs-view');
    const settingsView = document.getElementById('settings-view');
    const voskView = document.getElementById('vosk-view');
    const hyperateView = document.getElementById('Hyperate-view');
    const arcfeedbackView = document.getElementById('arcfeedback-view');
    const chatboxView = document.getElementById('chatbox-view');
    const vrchatapiView = document.getElementById('vrchatapi-view');
    const oscLeashView = document.getElementById('osc-leash-view');
    const autoInviterView = document.getElementById('auto-inviter-view');
    const arclinkView = document.getElementById('arclink-view');
    const openshockView = document.getElementById('openshock-view');
    const lovenseView = document.getElementById('lovense-view');
    const autoStatusView = document.getElementById('auto-status-view');
    const calendarView = document.getElementById('calendar-view');
    const vrcTimelineView = document.getElementById('vrc-timeline-view');
    const oscGoesBrrrView = document.getElementById('oscgoesbrrr-view');
    const navMain = document.getElementById('nav-main');
    const navOsc = document.getElementById('nav-osc');
    const navLogs = document.getElementById('nav-logs');
    const navSettings = document.getElementById('nav-settings');
    const navVosk = document.getElementById('nav-vosk');
    const navHyperate = document.getElementById('nav-Hyperate');
    [mainView, logsView, settingsView, voskView, hyperateView, arcfeedbackView, chatboxView, vrchatapiView, oscLeashView, oscGoesBrrrView, autoInviterView, arclinkView, openshockView, lovenseView, autoStatusView, calendarView, vrcTimelineView].forEach(view => {
        if (view) {
            view.style.opacity = '0';
            setTimeout(() => view.style.display = 'none', 300);
        }
    });
    setTimeout(() => {
        oscView.style.display = 'block';
        oscView.style.opacity = '0';
        requestAnimationFrame(() => {
            oscView.style.opacity = '1';
        });
        // Render OSC connections when view is shown
        renderAdditionalOscConnections();
    }, 300);
    // Reset all navigation buttons
    [navMain, navLogs, navSettings].forEach(nav => {
        nav.classList.remove('active');
        nav.disabled = false;
    });
    // Reset all tree-child buttons
    const treeChildren = document.querySelectorAll('.tree-child');
    treeChildren.forEach(child => {
        child.classList.remove('active');
        child.disabled = false;
    });
    navOsc.classList.add('active');
    navOsc.disabled = true;
    debugLog('Switched to OSC settings view');
}
function showSettingsView() {
    const mainView = document.getElementById('main-view');
    const oscView = document.getElementById('osc-view');
    const logsView = document.getElementById('logs-view');
    const settingsView = document.getElementById('settings-view');
    const navMain = document.getElementById('nav-main');
    const navOsc = document.getElementById('nav-osc');
    const navLogs = document.getElementById('nav-logs');
    const navSettings = document.getElementById('nav-settings');
    const voskView = document.getElementById('vosk-view');
    const hyperateView = document.getElementById('Hyperate-view');
    const arcfeedbackView = document.getElementById('arcfeedback-view');
    const chatboxView = document.getElementById('chatbox-view');
    const vrchatapiView = document.getElementById('vrchatapi-view');
    const oscLeashView = document.getElementById('osc-leash-view');
    const autoInviterView = document.getElementById('auto-inviter-view');
    const arclinkView = document.getElementById('arclink-view');
    const openshockView = document.getElementById('openshock-view');
    const lovenseView = document.getElementById('lovense-view');
    const autoStatusView = document.getElementById('auto-status-view');
    const calendarView = document.getElementById('calendar-view');
    const vrcTimelineView = document.getElementById('vrc-timeline-view');
    const oscGoesBrrrView = document.getElementById('oscgoesbrrr-view');
    const navVosk = document.getElementById('nav-vosk');
    const navHyperate = document.getElementById('nav-Hyperate');
    [mainView, oscView, logsView, voskView, hyperateView, arcfeedbackView, chatboxView, vrchatapiView, oscLeashView, oscGoesBrrrView, autoInviterView, arclinkView, openshockView, lovenseView, autoStatusView, calendarView, vrcTimelineView].forEach(view => {
        if (view) {
            view.style.opacity = '0';
            setTimeout(() => view.style.display = 'none', 300);
        }
    });
    setTimeout(() => {
        settingsView.style.display = 'block';
        settingsView.style.opacity = '0';
        requestAnimationFrame(() => {
            settingsView.style.opacity = '1';
        });
    }, 300);
    // Reset all navigation buttons
    [navMain, navOsc, navLogs].forEach(nav => {
        nav.classList.remove('active');
        nav.disabled = false;
    });
    // Reset all tree-child buttons
    const treeChildren = document.querySelectorAll('.tree-child');
    treeChildren.forEach(child => {
        child.classList.remove('active');
        child.disabled = false;
    });
    navSettings.classList.add('active');
    navSettings.disabled = true;
    debugLog('Switched to settings view');
}
function showLogsView() {
    const mainView = document.getElementById('main-view');
    const oscView = document.getElementById('osc-view');
    const logsView = document.getElementById('logs-view');
    const settingsView = document.getElementById('settings-view');
    const voskView = document.getElementById('vosk-view');
    const hyperateView = document.getElementById('Hyperate-view');
    const arcfeedbackView = document.getElementById('arcfeedback-view');
    const chatboxView = document.getElementById('chatbox-view');
    const vrchatapiView = document.getElementById('vrchatapi-view');
    const oscLeashView = document.getElementById('osc-leash-view');
    const autoInviterView = document.getElementById('auto-inviter-view');
    const arclinkView = document.getElementById('arclink-view');
    const openshockView = document.getElementById('openshock-view');
    const lovenseView = document.getElementById('lovense-view');
    const autoStatusView = document.getElementById('auto-status-view');
    const calendarView = document.getElementById('calendar-view');
    const vrcTimelineView = document.getElementById('vrc-timeline-view');
    const oscGoesBrrrView = document.getElementById('oscgoesbrrr-view');
    const navMain = document.getElementById('nav-main');
    const navOsc = document.getElementById('nav-osc');
    const navLogs = document.getElementById('nav-logs');
    const navSettings = document.getElementById('nav-settings');
    const navVosk = document.getElementById('nav-vosk');
    const navHyperate = document.getElementById('nav-Hyperate');
    [mainView, oscView, settingsView, voskView, hyperateView, arcfeedbackView, chatboxView, vrchatapiView, oscLeashView, oscGoesBrrrView, autoInviterView, arclinkView, openshockView, lovenseView, autoStatusView, calendarView, vrcTimelineView].forEach(view => {
        if (view) {
            view.style.opacity = '0';
            setTimeout(() => view.style.display = 'none', 300);
        }
    });
    setTimeout(() => {
        logsView.style.display = 'block';
        logsView.style.opacity = '0';
        requestAnimationFrame(() => {
            logsView.style.opacity = '1';
        });
        // Mark logs view as visible and scroll all log containers to bottom
        logsViewVisible = true;
        ['osc-received-log-container', 'osc-forwarded-log-container', 'osc-arc-received-log-container', 'client-log-container'].forEach(id => {
            const c = document.getElementById(id);
            if (c) c.scrollTop = c.scrollHeight;
        });
    }, 300);
    // Reset all navigation buttons
    [navMain, navOsc, navSettings].forEach(nav => {
        nav.classList.remove('active');
        nav.disabled = false;
    });
    // Reset all tree-child buttons
    const treeChildren = document.querySelectorAll('.tree-child');
    treeChildren.forEach(child => {
        child.classList.remove('active');
        child.disabled = false;
    });
    navLogs.classList.add('active');
    navLogs.disabled = true;
    debugLog('Switched to logs view');
}
function cleanupVRCTimelineWebview() {
    const timelineView = document.getElementById('vrc-timeline-view');
    if (timelineView) {
        const webview = timelineView.querySelector('webview');
        if (webview && webview.isDevToolsOpened && webview.isDevToolsOpened()) {
            webview.closeDevTools();
        }
    }
}
function setupExtrasDropdown() {
    const treeToggle = document.getElementById('nav-extras');
    const treeContent = treeToggle.nextElementSibling;
    let isExpanded = false;
    treeToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        isExpanded = !isExpanded;
        treeContent.classList.toggle('expanded');
        treeToggle.classList.toggle('expanded');
        treeToggle.querySelector('.arrow').textContent = isExpanded ? '▼' : '▶';
    });
    // Handle active states for child items
    const treeChildren = document.querySelectorAll('.tree-child');
    treeChildren.forEach(child => {
        child.addEventListener('click', () => {
            treeChildren.forEach(c => c.classList.remove('active'));
            child.classList.add('active');
        });
    });
    // Keep the tree expanded when clicking inside it
    treeContent.addEventListener('click', (e) => {
        e.stopPropagation();
    });
}
// Nested dropdown for VRChat API (contains Auto-Inviter)
function setupVRChatApiDropdown() {
    const treeToggle = document.getElementById('nav-vrchatapi-toggle');
    if (!treeToggle) return; // Not present yet
    const treeContent = treeToggle.nextElementSibling;
    let isExpanded = false;
    treeToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        isExpanded = !isExpanded;
        treeContent.classList.toggle('expanded');
        treeToggle.classList.toggle('expanded');
        const arrow = treeToggle.querySelector('.arrow');
        if (arrow) arrow.textContent = isExpanded ? '▼' : '▶';
    });
    treeContent.addEventListener('click', (e) => {
        e.stopPropagation();
    });
}
function showVOSKView() {
    cleanupVRCTimelineWebview();
    const views = ['main-view', 'osc-view', 'vosk-view', 'Hyperate-view', 'arcfeedback-view', 'chatbox-view', 'vrchatapi-view', 'osc-leash-view', 'oscgoesbrrr-view', 'auto-inviter-view', 'arclink-view', 'openshock-view', 'lovense-view', 'auto-status-view', 'calendar-view', 'logs-view', 'settings-view', 'vrc-timeline-view'].map(id => document.getElementById(id));
    const navButtons = ['nav-main', 'nav-osc', 'nav-logs', 'nav-settings'].map(id => document.getElementById(id));

    views.forEach(view => {
        if (view) view.style.opacity = '0';
    });
    setTimeout(() => {
        views.forEach(view => {
            if (view) view.style.display = 'none';
        });
        const voskView = document.getElementById('vosk-view');
        voskView.style.display = 'block';
        voskView.style.opacity = '0';
        requestAnimationFrame(() => {
            voskView.style.opacity = '1';
        });
    }, 300);
    // Reset ALL main navigation buttons explicitly
    const allMainNavButtons = ['nav-main', 'nav-osc', 'nav-logs', 'nav-settings'];
    allMainNavButtons.forEach(navId => {
        const navElement = document.getElementById(navId);
        if (navElement) {
            navElement.classList.remove('active');
            navElement.disabled = false;
        }
    });
    // Reset all tree-child buttons and set VOSK as active
    const treeChildren = document.querySelectorAll('.tree-child');
    treeChildren.forEach(child => {
        child.classList.remove('active');
        child.disabled = false;
    });
    const navVOSK = document.getElementById('nav-vosk');
    if (navVOSK) {
        navVOSK.classList.add('active');
        navVOSK.disabled = true;
    }
    // Ensure extras dropdown is expanded
    const treeToggle = document.getElementById('nav-extras');
    const treeContent = treeToggle?.nextElementSibling;
    if (treeToggle && treeContent) {
        treeContent.classList.add('expanded');
        treeToggle.classList.add('expanded');
        const arrow = treeToggle.querySelector('.arrow');
        if (arrow) {
            arrow.textContent = '▼';
        }
    }
    debugLog('Switched to VOSK view');
}
function showVRCTimelineView() {
    const views = ['main-view', 'osc-view', 'vosk-view', 'Hyperate-view', 'arcfeedback-view', 'chatbox-view', 'vrchatapi-view', 'osc-leash-view', 'oscgoesbrrr-view', 'auto-inviter-view', 'arclink-view', 'openshock-view', 'lovense-view', 'auto-status-view', 'calendar-view', 'logs-view', 'settings-view'].map(id => document.getElementById(id));
    const navButtons = ['nav-main', 'nav-osc', 'nav-logs', 'nav-settings'].map(id => document.getElementById(id));
    views.forEach(view => {
        if (view) view.style.opacity = '0';
    });
    setTimeout(() => {
        views.forEach(view => {
            if (view) view.style.display = 'none';
        });
        const timelineView = document.getElementById('vrc-timeline-view');
        if (timelineView) {
            timelineView.style.display = 'block';
            timelineView.style.opacity = '0';
            
            // Initialize webview if it exists and hasn't been initialized
            const webview = timelineView.querySelector('webview');
            if (webview && !webview.dataset.initialized) {
                webview.dataset.initialized = 'true';
                
                // Force webview to load by setting src attribute
                // This ensures the webview loads when the view becomes visible
                const currentSrc = webview.getAttribute('src');
                if (currentSrc && !webview.src) {
                    webview.src = currentSrc;
                }
                
                webview.addEventListener('dom-ready', () => {
                    webview.executeJavaScript(`
                        (function() {
                            if (typeof dragEvent === 'undefined') {
                                window.dragEvent = null;
                            }
                            
                            if (!Set.prototype.symmetricDifference) {
                                Set.prototype.symmetricDifference = function(other) {
                                    const result = new Set(this);
                                    for (const elem of other) {
                                        if (result.has(elem)) {
                                            result.delete(elem);
                                        } else {
                                            result.add(elem);
                                        }
                                    }
                                    return result;
                                };
                            }
                            
                            if (!Set.prototype.intersection) {
                                Set.prototype.intersection = function(other) {
                                    const result = new Set();
                                    for (const elem of this) {
                                        if (other.has(elem)) {
                                            result.add(elem);
                                        }
                                    }
                                    return result;
                                };
                            }
                            
                            if (!Set.prototype.union) {
                                Set.prototype.union = function(other) {
                                    const result = new Set(this);
                                    for (const elem of other) {
                                        result.add(elem);
                                    }
                                    return result;
                                };
                            }
                            
                            if (!Set.prototype.difference) {
                                Set.prototype.difference = function(other) {
                                    const result = new Set(this);
                                    for (const elem of other) {
                                        result.delete(elem);
                                    }
                                    return result;
                                };
                            }
                            
                            if (!Set.prototype.isSubsetOf) {
                                Set.prototype.isSubsetOf = function(other) {
                                    for (const elem of this) {
                                        if (!other.has(elem)) {
                                            return false;
                                        }
                                    }
                                    return true;
                                };
                            }
                        })();
                    `).catch(() => {});
                });
                
                webview.addEventListener('console-message', (e) => {
                    if (e.level > 1) {
                        const levelStr = e.level === 2 ? 'warning' : 'error';
                        debugLog(`VRC Timeline ${levelStr}: ${e.message}`, levelStr);
                    }
                });
                
                // Intercept new window/popup attempts (link clicks)
                webview.addEventListener('new-window', (e) => {
                    e.preventDefault();
                    showVRCTimelineLinkModal(e.url);
                });
                
                // Enable context menu (right-click) - simplified HTML menu
                let contextMenuVisible = false;
                let currentContextMenuOverlay = null;
                let currentContextMenu = null;
                
                webview.addEventListener('context-menu', (e) => {
                    e.preventDefault();
                    e.params = e.params || {};
                    
                    // Remove existing context menu if any
                    if (currentContextMenu) {
                        currentContextMenu.remove();
                        currentContextMenu = null;
                    }
                    if (currentContextMenuOverlay) {
                        currentContextMenuOverlay.remove();
                        currentContextMenuOverlay = null;
                    }
                    
                    // Create transparent overlay to catch outside clicks
                    const overlay = document.createElement('div');
                    overlay.id = 'vrc-timeline-context-overlay';
                    overlay.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: 99999; background: transparent;';
                    currentContextMenuOverlay = overlay;
                    
                    // Create context menu
                    const menu = document.createElement('div');
                    menu.id = 'vrc-timeline-context-menu';
                    menu.style.cssText = 'position: fixed; background: #2c2c2c; border: 1px solid #444; border-radius: 4px; padding: 4px 0; box-shadow: 0 2px 10px rgba(0,0,0,0.5); z-index: 100000; min-width: 180px;';
                    currentContextMenu = menu;
                    
                    let activeCloseOnEscape = null;
                    const closeContextMenu = () => {
                        if (currentContextMenu) {
                            currentContextMenu.remove();
                            currentContextMenu = null;
                        }
                        if (currentContextMenuOverlay) {
                            currentContextMenuOverlay.remove();
                            currentContextMenuOverlay = null;
                        }
                        contextMenuVisible = false;
                        if (activeCloseOnEscape) {
                            document.removeEventListener('keydown', activeCloseOnEscape);
                            activeCloseOnEscape = null;
                        }
                    };
                    
                    const addMenuItem = (label, onClick, enabled = true) => {
                        const item = document.createElement('div');
                        item.textContent = label;
                        item.style.cssText = `padding: 8px 16px; cursor: ${enabled ? 'pointer' : 'not-allowed'}; color: ${enabled ? '#fff' : '#666'}; font-size: 13px;`;
                        if (enabled) {
                            item.onmouseover = () => item.style.background = '#444';
                            item.onmouseout = () => item.style.background = 'transparent';
                            item.onclick = (e) => {
                                e.stopPropagation();
                                onClick();
                                closeContextMenu();
                            };
                        }
                        menu.appendChild(item);
                    };
                    
                    const addSeparator = () => {
                        const sep = document.createElement('div');
                        sep.style.cssText = 'height: 1px; background: #444; margin: 4px 0;';
                        menu.appendChild(sep);
                    };
                    
                    if (e.params.linkURL) {
                        addMenuItem('🌐 Open Link in Browser', () => window.electronAPI.openExternal(e.params.linkURL));
                        addMenuItem('📋 Copy Link', () => window.electronAPI.clipboardWriteText(e.params.linkURL));
                        addSeparator();
                    }
                    
                    if (e.params.hasImageContents) {
                        addMenuItem('🖼️ Copy Image', () => webview.copyImageAt(e.params.x, e.params.y));
                        addSeparator();
                    }
                    
                    addMenuItem('← Back', () => webview.goBack(), webview.canGoBack());
                    addMenuItem('→ Forward', () => webview.goForward(), webview.canGoForward());
                    addMenuItem('🔄 Reload', () => webview.reload());
                    
                    // Add to DOM first to measure dimensions
                    menu.style.visibility = 'hidden';
                    document.body.appendChild(overlay);
                    document.body.appendChild(menu);
                    
                    // Get menu dimensions and viewport size
                    const menuRect = menu.getBoundingClientRect();
                    const viewportWidth = window.innerWidth;
                    const viewportHeight = window.innerHeight;
                    
                    // Calculate position (prefer showing upward and to the left if near edges)
                    let left = e.params.x;
                    let top = e.params.y;
                    
                    // Check if menu would extend beyond bottom of viewport
                    if (top + menuRect.height > viewportHeight) {
                        // Position menu above cursor instead
                        top = e.params.y - menuRect.height;
                    }
                    
                    // Check if menu would extend beyond right edge
                    if (left + menuRect.width > viewportWidth) {
                        left = viewportWidth - menuRect.width - 5;
                    }
                    
                    // Ensure menu stays within top boundary
                    if (top < 0) {
                        top = 5;
                    }
                    
                    // Ensure menu stays within left boundary
                    if (left < 0) {
                        left = 5;
                    }
                    
                    // Apply final position and make visible
                    menu.style.left = left + 'px';
                    menu.style.top = top + 'px';
                    menu.style.visibility = 'visible';
                    
                    contextMenuVisible = true;
                    
                    // Close menu when clicking on overlay
                    overlay.onclick = closeContextMenu;
                    overlay.oncontextmenu = (e) => {
                        e.preventDefault();
                        closeContextMenu();
                    };
                    
                    // Also close on Escape key
                    activeCloseOnEscape = (event) => {
                        if (event.key === 'Escape') {
                            closeContextMenu();
                        }
                    };
                    document.addEventListener('keydown', activeCloseOnEscape);
                });
            }
            
            // Always animate opacity when showing the view
            requestAnimationFrame(() => {
                timelineView.style.opacity = '1';
            });
        }
    }, 300);
    // Reset ALL main navigation buttons explicitly
    const allMainNavButtons = ['nav-main', 'nav-osc', 'nav-logs', 'nav-settings'];
    allMainNavButtons.forEach(navId => {
        const navElement = document.getElementById(navId);
        if (navElement) {
            navElement.classList.remove('active');
            navElement.disabled = false;
        }
    });
    // Reset all tree-child buttons and set VRC Timeline as active
    const treeChildren = document.querySelectorAll('.tree-child');
    treeChildren.forEach(child => {
        child.classList.remove('active');
        child.disabled = false;
    });
    const navTimeline = document.getElementById('nav-vrc-timeline');
    if (navTimeline) {
        navTimeline.classList.add('active');
        navTimeline.disabled = true;
    }
    // Ensure extras dropdown is expanded
    const treeToggle = document.getElementById('nav-extras');
    const treeContent = treeToggle?.nextElementSibling;
    if (treeToggle && treeContent) {
        treeContent.classList.add('expanded');
        treeToggle.classList.add('expanded');
        const arrow = treeToggle.querySelector('.arrow');
        if (arrow) {
            arrow.textContent = '▼';
        }
    }
    debugLog('Switched to VRC Timeline view');
}
function showHyperateView() {
    debugLog('showHyperateView called');
    // Stop intervals from other views to prevent memory leaks
    stopAllViewIntervals();
    const views = ['main-view', 'osc-view', 'vosk-view', 'Hyperate-view', 'arcfeedback-view', 'chatbox-view', 'vrchatapi-view', 'osc-leash-view', 'oscgoesbrrr-view', 'auto-inviter-view', 'arclink-view', 'openshock-view', 'lovense-view', 'auto-status-view', 'calendar-view', 'logs-view', 'settings-view', 'vrc-timeline-view'].map(id => document.getElementById(id));
    const navButtons = ['nav-main', 'nav-osc', 'nav-logs', 'nav-settings'].map(id => document.getElementById(id));
    views.forEach(view => {
        if (view) view.style.opacity = '0';
    });
    setTimeout(() => {
        views.forEach(view => {
            if (view) view.style.display = 'none';
        });
        const HyperateView = document.getElementById('Hyperate-view');
        if (HyperateView) {
            HyperateView.style.display = 'block';
            HyperateView.style.opacity = '0';
            requestAnimationFrame(() => {
                HyperateView.style.opacity = '1';
            });
        } else {
            debugLog('Error: HypeRate view element not found!', 'error');
        }
    }, 300);
    // Reset ALL main navigation buttons explicitly
    const allMainNavButtons = ['nav-main', 'nav-osc', 'nav-logs', 'nav-settings'];
    allMainNavButtons.forEach(navId => {
        const navElement = document.getElementById(navId);
        if (navElement) {
            navElement.classList.remove('active');
            navElement.disabled = false;
        }
    });
    // Reset all tree-child buttons and set HypeRate as active
    const treeChildren = document.querySelectorAll('.tree-child');
    treeChildren.forEach(child => {
        child.classList.remove('active');
        child.disabled = false;
    });
    const navHyperate = document.getElementById('nav-Hyperate');
    if (navHyperate) {
        navHyperate.classList.add('active');
        navHyperate.disabled = true;
    }
    // Ensure extras dropdown is expanded
    const treeToggle = document.getElementById('nav-extras');
    const treeContent = treeToggle?.nextElementSibling;
    if (treeToggle && treeContent) {
        treeContent.classList.add('expanded');
        treeToggle.classList.add('expanded');
        const arrow = treeToggle.querySelector('.arrow');
        if (arrow) {
            arrow.textContent = '▼';
        }
    }
    // Initialize HypeRate status and auto-start UI
    refreshHyperateStatus(true);
    debugLog('Switched to Hyperate view');
}
function showARCFeedbackView() {
    const views = ['main-view', 'osc-view', 'vosk-view', 'Hyperate-view', 'arcfeedback-view', 'chatbox-view', 'vrchatapi-view', 'osc-leash-view', 'oscgoesbrrr-view', 'auto-inviter-view', 'arclink-view', 'openshock-view', 'lovense-view', 'auto-status-view', 'calendar-view', 'logs-view', 'settings-view', 'vrc-timeline-view'].map(id => document.getElementById(id));
    const navButtons = ['nav-main', 'nav-osc', 'nav-logs', 'nav-settings'].map(id => document.getElementById(id));
    views.forEach(view => {
        if (view) view.style.opacity = '0';
    });
    setTimeout(() => {
        views.forEach(view => {
            if (view) view.style.display = 'none';
        });
        const arcfeedbackView = document.getElementById('arcfeedback-view');
        arcfeedbackView.style.display = 'block';
        arcfeedbackView.style.opacity = '0';
        requestAnimationFrame(() => {
            arcfeedbackView.style.opacity = '1';
        });
    }, 300);
    // Reset ALL main navigation buttons explicitly
    const allMainNavButtons = ['nav-main', 'nav-osc', 'nav-logs', 'nav-settings'];
    allMainNavButtons.forEach(navId => {
        const navElement = document.getElementById(navId);
        if (navElement) {
            navElement.classList.remove('active');
            navElement.disabled = false;
        }
    });
    // Reset all tree-child buttons and set ARC Feedback as active
    const treeChildren = document.querySelectorAll('.tree-child');
    treeChildren.forEach(child => {
        child.classList.remove('active');
        child.disabled = false;
    });
    const navARCFeedback = document.getElementById('nav-arcfeedback');
    if (navARCFeedback) {
        navARCFeedback.classList.add('active');
        navARCFeedback.disabled = true;
    }
    // Ensure extras dropdown is expanded
    const treeToggle = document.getElementById('nav-extras');
    const treeContent = treeToggle?.nextElementSibling;
    if (treeToggle && treeContent) {
        treeContent.classList.add('expanded');
        treeToggle.classList.add('expanded');
        const arrow = treeToggle.querySelector('.arrow');
        if (arrow) {
            arrow.textContent = '▼';
        }
    }
    debugLog('Switched to ARC Feedback view');
}
function showChatboxView() {
    const views = ['main-view', 'osc-view', 'vosk-view', 'Hyperate-view', 'arcfeedback-view', 'chatbox-view', 'vrchatapi-view', 'osc-leash-view', 'oscgoesbrrr-view', 'auto-inviter-view', 'arclink-view', 'openshock-view', 'lovense-view', 'auto-status-view', 'calendar-view', 'logs-view', 'settings-view', 'vrc-timeline-view'].map(id => document.getElementById(id));
    const navButtons = ['nav-main', 'nav-osc', 'nav-logs', 'nav-settings'].map(id => document.getElementById(id));
    views.forEach(view => {
        if (view) view.style.opacity = '0';
    });
    setTimeout(() => {
        views.forEach(view => {
            if (view) view.style.display = 'none';
        });
        const chatboxView = document.getElementById('chatbox-view');
        chatboxView.style.display = 'block';
        chatboxView.style.opacity = '0';
        requestAnimationFrame(() => {
            chatboxView.style.opacity = '1';
        });
    }, 300);
    // Reset ALL main navigation buttons explicitly
    const allMainNavButtons = ['nav-main', 'nav-osc', 'nav-logs', 'nav-settings'];
    allMainNavButtons.forEach(navId => {
        const navElement = document.getElementById(navId);
        if (navElement) {
            navElement.classList.remove('active');
            navElement.disabled = false;
        }
    });
    // Reset all tree-child buttons and set Chatbox as active
    const treeChildren = document.querySelectorAll('.tree-child');
    treeChildren.forEach(child => {
        child.classList.remove('active');
        child.disabled = false;
    });
    const navChatbox = document.getElementById('nav-chatbox');
    if (navChatbox) {
        navChatbox.classList.add('active');
        navChatbox.disabled = true;
    }
    // Ensure extras dropdown is expanded
    const treeToggle = document.getElementById('nav-extras');
    const treeContent = treeToggle?.nextElementSibling;
    if (treeToggle && treeContent) {
        treeContent.classList.add('expanded');
        treeToggle.classList.add('expanded');
        const arrow = treeToggle.querySelector('.arrow');
        if (arrow) {
            arrow.textContent = '▼';
        }
    }
    debugLog('Switched to Chatbox view');
}
function showVRChatAPIView() {
    const views = ['main-view', 'osc-view', 'vosk-view', 'Hyperate-view', 'arcfeedback-view', 'chatbox-view', 'vrchatapi-view', 'osc-leash-view', 'oscgoesbrrr-view', 'auto-inviter-view', 'arclink-view', 'openshock-view', 'lovense-view', 'auto-status-view', 'calendar-view', 'logs-view', 'settings-view', 'vrc-timeline-view'].map(id => document.getElementById(id));
    const navButtons = ['nav-main', 'nav-osc', 'nav-logs', 'nav-settings'].map(id => document.getElementById(id));
    views.forEach(view => {
        if (view) view.style.opacity = '0';
    });
    setTimeout(() => {
        views.forEach(view => {
            if (view) view.style.display = 'none';
        });
        const vrchatapiView = document.getElementById('vrchatapi-view');
        vrchatapiView.style.display = 'block';
        vrchatapiView.style.opacity = '0';
        requestAnimationFrame(() => {
            vrchatapiView.style.opacity = '1';
        });
    }, 300);
    // Reset ALL main navigation buttons explicitly
    const allMainNavButtons = ['nav-main', 'nav-osc', 'nav-logs', 'nav-settings'];
    allMainNavButtons.forEach(navId => {
        const navElement = document.getElementById(navId);
        if (navElement) {
            navElement.classList.remove('active');
            navElement.disabled = false;
        }
    });
    // Reset all tree-child buttons and set VRChat API as active
    const treeChildren = document.querySelectorAll('.tree-child');
    treeChildren.forEach(child => {
        child.classList.remove('active');
        child.disabled = false;
    });
    const navVRChatAPI = document.getElementById('nav-vrchatapi');
    if (navVRChatAPI) {
        navVRChatAPI.classList.add('active');
        navVRChatAPI.disabled = true;
    }
    // Ensure extras dropdown is expanded
    const treeToggle = document.getElementById('nav-extras');
    const treeContent = treeToggle?.nextElementSibling;
    if (treeToggle && treeContent) {
        treeContent.classList.add('expanded');
        treeToggle.classList.add('expanded');
        const arrow = treeToggle.querySelector('.arrow');
        if (arrow) {
            arrow.textContent = '▼';
        }
    }
    debugLog('Switched to VRChat API view');
}

function showOSCLeashView() {
    const views = ['main-view', 'osc-view', 'vosk-view', 'Hyperate-view', 'arcfeedback-view', 'chatbox-view', 'vrchatapi-view', 'osc-leash-view', 'oscgoesbrrr-view', 'auto-inviter-view', 'arclink-view', 'openshock-view', 'lovense-view', 'auto-status-view', 'calendar-view', 'logs-view', 'settings-view', 'vrc-timeline-view'].map(id => document.getElementById(id));
    const navButtons = ['nav-main', 'nav-osc', 'nav-logs', 'nav-settings'].map(id => document.getElementById(id));
    views.forEach(view => {
        if (view) view.style.opacity = '0';
    });
    setTimeout(() => {
        views.forEach(view => {
            if (view) view.style.display = 'none';
        });
        const oscLeashView = document.getElementById('osc-leash-view');
        oscLeashView.style.display = 'block';
        oscLeashView.style.opacity = '0';
        requestAnimationFrame(() => {
            oscLeashView.style.opacity = '1';
        });
    }, 300);
    // Reset ALL main navigation buttons explicitly
    const allMainNavButtons = ['nav-main', 'nav-osc', 'nav-logs', 'nav-settings'];
    allMainNavButtons.forEach(navId => {
        const navElement = document.getElementById(navId);
        if (navElement) {
            navElement.classList.remove('active');
            navElement.disabled = false;
        }
    });
    // Reset all tree-child buttons and set OSC Leash as active
    const treeChildren = document.querySelectorAll('.tree-child');
    treeChildren.forEach(child => {
        child.classList.remove('active');
        child.disabled = false;
    });
    const navOSCLeash = document.getElementById('nav-osc-leash');
    if (navOSCLeash) {
        navOSCLeash.classList.add('active');
        navOSCLeash.disabled = true;
    }
    // Ensure extras dropdown is expanded
    const treeToggle = document.getElementById('nav-extras');
    const treeContent = treeToggle?.nextElementSibling;
    if (treeToggle && treeContent) {
        treeContent.classList.add('expanded');
        treeToggle.classList.add('expanded');
        const arrow = treeToggle.querySelector('.arrow');
        if (arrow) {
            arrow.textContent = '▼';
        }
    }
    debugLog('Switched to OSC Leash view');
}

function showOscGoesBrrrView() {
    const views = ['main-view', 'osc-view', 'vosk-view', 'Hyperate-view', 'arcfeedback-view', 'chatbox-view', 'vrchatapi-view', 'osc-leash-view', 'oscgoesbrrr-view', 'auto-inviter-view', 'arclink-view', 'openshock-view', 'lovense-view', 'auto-status-view', 'calendar-view', 'logs-view', 'settings-view', 'vrc-timeline-view'].map(id => document.getElementById(id));
    const navButtons = ['nav-main', 'nav-osc', 'nav-logs', 'nav-settings'].map(id => document.getElementById(id));
    views.forEach(view => {
        if (view) view.style.opacity = '0';
    });
    setTimeout(() => {
        views.forEach(view => {
            if (view) view.style.display = 'none';
        });
        const oscGoesBrrrView = document.getElementById('oscgoesbrrr-view');
        if (oscGoesBrrrView) {
            oscGoesBrrrView.style.display = 'block';
            oscGoesBrrrView.style.opacity = '0';
            requestAnimationFrame(() => {
                oscGoesBrrrView.style.opacity = '1';
            });
        } else {
            debugLog('Error: OscGoesBrrr view element not found!', 'error');
        }
    }, 300);
    // Reset ALL main navigation buttons explicitly
    const allMainNavButtons = ['nav-main', 'nav-osc', 'nav-logs', 'nav-settings'];
    allMainNavButtons.forEach(navId => {
        const navElement = document.getElementById(navId);
        if (navElement) {
            navElement.classList.remove('active');
            navElement.disabled = false;
        }
    });
    // Reset all tree-child buttons and set OscGoesBrrr as active
    const treeChildren = document.querySelectorAll('.tree-child');
    treeChildren.forEach(child => {
        child.classList.remove('active');
        child.disabled = false;
    });
    const navOscGoesBrrr = document.getElementById('nav-oscgoesbrrr');
    if (navOscGoesBrrr) {
        navOscGoesBrrr.classList.add('active');
        navOscGoesBrrr.disabled = true;
    }
    // Ensure extras dropdown is expanded
    const treeToggle = document.getElementById('nav-extras');
    const treeContent = treeToggle?.nextElementSibling;
    if (treeToggle && treeContent) {
        treeContent.classList.add('expanded');
        treeToggle.classList.add('expanded');
        const arrow = treeToggle.querySelector('.arrow');
        if (arrow) {
            arrow.textContent = '▼';
        }
    }
    // Initialize OscGoesBrrr status
    if (typeof showOgbView === 'function') {
        showOgbView();
    }
    debugLog('Switched to OscGoesBrrr view');
}

function showAutoInviterView() {
    const views = ['main-view', 'osc-view', 'vosk-view', 'Hyperate-view', 'arcfeedback-view', 'chatbox-view', 'vrchatapi-view', 'osc-leash-view', 'oscgoesbrrr-view', 'auto-inviter-view', 'arclink-view', 'openshock-view', 'lovense-view', 'auto-status-view', 'calendar-view', 'logs-view', 'settings-view', 'vrc-timeline-view'].map(id => document.getElementById(id));
    const navButtons = ['nav-main', 'nav-osc', 'nav-logs', 'nav-settings'].map(id => document.getElementById(id));
    views.forEach(view => {
        if (view) view.style.opacity = '0';
    });
    setTimeout(() => {
        views.forEach(view => {
            if (view) view.style.display = 'none';
        });
        const autoInviterView = document.getElementById('auto-inviter-view');
        autoInviterView.style.display = 'block';
        autoInviterView.style.opacity = '0';
        requestAnimationFrame(() => {
            autoInviterView.style.opacity = '1';
        });
    }, 300);
    // Reset ALL main navigation buttons explicitly
    const allMainNavButtons = ['nav-main', 'nav-osc', 'nav-logs', 'nav-settings'];
    allMainNavButtons.forEach(navId => {
        const navElement = document.getElementById(navId);
        if (navElement) {
            navElement.classList.remove('active');
            navElement.disabled = false;
        }
    });
    // Reset all tree-child buttons and set Auto-Inviter as active
    const treeChildren = document.querySelectorAll('.tree-child');
    treeChildren.forEach(child => {
        child.classList.remove('active');
        child.disabled = false;
    });
    const navAutoInviter = document.getElementById('nav-auto-inviter');
    if (navAutoInviter) {
        navAutoInviter.classList.add('active');
        navAutoInviter.disabled = true;
    }
    // Ensure extras dropdown is expanded
    const treeToggle = document.getElementById('nav-extras');
    const treeContent = treeToggle?.nextElementSibling;
    if (treeToggle && treeContent) {
        treeContent.classList.add('expanded');
        treeToggle.classList.add('expanded');
        const arrow = treeToggle.querySelector('.arrow');
        if (arrow) {
            arrow.textContent = '▼';
        }
    }
    debugLog('Switched to Auto-Inviter view');
}
function showARCLinkView() {
    const views = ['main-view', 'osc-view', 'vosk-view', 'Hyperate-view', 'arcfeedback-view', 'chatbox-view', 'vrchatapi-view', 'osc-leash-view', 'oscgoesbrrr-view', 'auto-inviter-view', 'arclink-view', 'openshock-view', 'lovense-view', 'auto-status-view', 'calendar-view', 'logs-view', 'settings-view', 'vrc-timeline-view'].map(id => document.getElementById(id));
    views.forEach(view => {
        if (view) view.style.opacity = '0';
    });
    setTimeout(() => {
        views.forEach(view => {
            if (view) view.style.display = 'none';
        });
        const arclinkView = document.getElementById('arclink-view');
        arclinkView.style.display = 'block';
        arclinkView.style.opacity = '0';
        requestAnimationFrame(() => {
            arclinkView.style.opacity = '1';
        });
    }, 300);
    const allMainNavButtons = ['nav-main', 'nav-osc', 'nav-logs', 'nav-settings'];
    allMainNavButtons.forEach(navId => {
        const navElement = document.getElementById(navId);
        if (navElement) {
            navElement.classList.remove('active');
            navElement.disabled = false;
        }
    });
    const treeChildren = document.querySelectorAll('.tree-child');
    treeChildren.forEach(child => {
        child.classList.remove('active');
        child.disabled = false;
    });
    const navARCLink = document.getElementById('nav-arclink');
    if (navARCLink) {
        navARCLink.classList.add('active');
        navARCLink.disabled = true;
    }
    const treeToggle = document.getElementById('nav-extras');
    const treeContent = treeToggle?.nextElementSibling;
    if (treeToggle && treeContent) {
        treeContent.classList.add('expanded');
        treeToggle.classList.add('expanded');
        const arrow = treeToggle.querySelector('.arrow');
        if (arrow) {
            arrow.textContent = '▼';
        }
    }
    debugLog('Switched to ARC Link view');
}
function showOpenShockView() {
    const views = ['main-view', 'osc-view', 'vosk-view', 'Hyperate-view', 'arcfeedback-view', 'chatbox-view', 'vrchatapi-view', 'osc-leash-view', 'oscgoesbrrr-view', 'auto-inviter-view', 'arclink-view', 'openshock-view', 'lovense-view', 'auto-status-view', 'calendar-view', 'logs-view', 'settings-view', 'vrc-timeline-view'].map(id => document.getElementById(id));
    views.forEach(view => {
        if (view) view.style.opacity = '0';
    });
    setTimeout(() => {
        views.forEach(view => {
            if (view) view.style.display = 'none';
        });
        const openshockView = document.getElementById('openshock-view');
        openshockView.style.display = 'block';
        openshockView.style.opacity = '0';
        requestAnimationFrame(() => {
            openshockView.style.opacity = '1';
        });
    }, 300);
    const allMainNavButtons = ['nav-main', 'nav-osc', 'nav-logs', 'nav-settings'];
    allMainNavButtons.forEach(navId => {
        const navElement = document.getElementById(navId);
        if (navElement) {
            navElement.classList.remove('active');
            navElement.disabled = false;
        }
    });
    const treeChildren = document.querySelectorAll('.tree-child');
    treeChildren.forEach(child => {
        child.classList.remove('active');
        child.disabled = false;
    });
    const navOpenShock = document.getElementById('nav-openshock');
    if (navOpenShock) {
        navOpenShock.classList.add('active');
        navOpenShock.disabled = true;
    }
    const treeToggle = document.getElementById('nav-extras');
    const treeContent = treeToggle?.nextElementSibling;
    if (treeToggle && treeContent) {
        treeContent.classList.add('expanded');
        treeToggle.classList.add('expanded');
        const arrow = treeToggle.querySelector('.arrow');
        if (arrow) {
            arrow.textContent = '▼';
        }
    }
    debugLog('Switched to OpenShock view');
}
function showLovenseView() {
    const views = ['main-view', 'osc-view', 'vosk-view', 'Hyperate-view', 'arcfeedback-view', 'chatbox-view', 'vrchatapi-view', 'osc-leash-view', 'oscgoesbrrr-view', 'auto-inviter-view', 'arclink-view', 'openshock-view', 'lovense-view', 'auto-status-view', 'calendar-view', 'logs-view', 'settings-view', 'vrc-timeline-view'].map(id => document.getElementById(id));
    views.forEach(view => {
        if (view) view.style.opacity = '0';
    });
    setTimeout(() => {
        views.forEach(view => {
            if (view) view.style.display = 'none';
        });
        const lovenseView = document.getElementById('lovense-view');
        lovenseView.style.display = 'block';
        lovenseView.style.opacity = '0';
        requestAnimationFrame(() => {
            lovenseView.style.opacity = '1';
        });
    }, 300);
    const allMainNavButtons = ['nav-main', 'nav-osc', 'nav-logs', 'nav-settings'];
    allMainNavButtons.forEach(navId => {
        const navElement = document.getElementById(navId);
        if (navElement) {
            navElement.classList.remove('active');
            navElement.disabled = false;
        }
    });
    const treeChildren = document.querySelectorAll('.tree-child');
    treeChildren.forEach(child => {
        child.classList.remove('active');
        child.disabled = false;
    });
    const navLovense = document.getElementById('nav-lovense');
    if (navLovense) {
        navLovense.classList.add('active');
        navLovense.disabled = true;
    }
    const treeToggle = document.getElementById('nav-extras');
    const treeContent = treeToggle?.nextElementSibling;
    if (treeToggle && treeContent) {
        treeContent.classList.add('expanded');
        treeToggle.classList.add('expanded');
        const arrow = treeToggle.querySelector('.arrow');
        if (arrow) {
            arrow.textContent = '▼';
        }
    }
    debugLog('Switched to Lovense view');
}
function showAutoStatusView() {
    const views = ['main-view', 'osc-view', 'vosk-view', 'Hyperate-view', 'arcfeedback-view', 'chatbox-view', 'vrchatapi-view', 'osc-leash-view', 'oscgoesbrrr-view', 'auto-inviter-view', 'arclink-view', 'openshock-view', 'lovense-view', 'auto-status-view', 'calendar-view', 'logs-view', 'settings-view', 'vrc-timeline-view'].map(id => document.getElementById(id));
    views.forEach(view => {
        if (view) view.style.opacity = '0';
    });
    setTimeout(() => {
        views.forEach(view => {
            if (view) view.style.display = 'none';
        });
        const autoStatusView = document.getElementById('auto-status-view');
        autoStatusView.style.display = 'block';
        autoStatusView.style.opacity = '0';
        requestAnimationFrame(() => {
            autoStatusView.style.opacity = '1';
        });
        initAutoStatusUI();
    }, 300);
    const allMainNavButtons = ['nav-main', 'nav-osc', 'nav-logs', 'nav-settings'];
    allMainNavButtons.forEach(navId => {
        const navElement = document.getElementById(navId);
        if (navElement) {
            navElement.classList.remove('active');
            navElement.disabled = false;
        }
    });
    const treeChildren = document.querySelectorAll('.tree-child');
    treeChildren.forEach(child => {
        child.classList.remove('active');
        child.disabled = false;
    });
    const navAutoStatus = document.getElementById('nav-auto-status');
    if (navAutoStatus) {
        navAutoStatus.classList.add('active');
        navAutoStatus.disabled = true;
    }
    const treeToggle = document.getElementById('nav-extras');
    const treeContent = treeToggle?.nextElementSibling;
    if (treeToggle && treeContent) {
        treeContent.classList.add('expanded');
        treeToggle.classList.add('expanded');
        const arrow = treeToggle.querySelector('.arrow');
        if (arrow) {
            arrow.textContent = '▼';
        }
    }
    debugLog('Switched to Auto-Status view');
}
function showCalendarView() {
    const views = ['main-view', 'osc-view', 'vosk-view', 'Hyperate-view', 'arcfeedback-view', 'chatbox-view', 'vrchatapi-view', 'osc-leash-view', 'oscgoesbrrr-view', 'auto-inviter-view', 'arclink-view', 'openshock-view', 'lovense-view', 'auto-status-view', 'calendar-view', 'logs-view', 'settings-view', 'vrc-timeline-view'].map(id => document.getElementById(id));
    views.forEach(view => {
        if (view) view.style.opacity = '0';
    });
    setTimeout(() => {
        views.forEach(view => {
            if (view) view.style.display = 'none';
        });
        const calendarView = document.getElementById('calendar-view');
        calendarView.style.display = 'block';
        calendarView.style.opacity = '0';
        requestAnimationFrame(() => {
            calendarView.style.opacity = '1';
        });
    }, 300);
    const allMainNavButtons = ['nav-main', 'nav-osc', 'nav-logs', 'nav-settings'];
    allMainNavButtons.forEach(navId => {
        const navElement = document.getElementById(navId);
        if (navElement) {
            navElement.classList.remove('active');
            navElement.disabled = false;
        }
    });
    const treeChildren = document.querySelectorAll('.tree-child');
    treeChildren.forEach(child => {
        child.classList.remove('active');
        child.disabled = false;
    });
    const navCalendar = document.getElementById('nav-calendar');
    if (navCalendar) {
        navCalendar.classList.add('active');
        navCalendar.disabled = true;
    }
    const treeToggle = document.getElementById('nav-extras');
    const treeContent = treeToggle?.nextElementSibling;
    if (treeToggle && treeContent) {
        treeContent.classList.add('expanded');
        treeToggle.classList.add('expanded');
        const arrow = treeToggle.querySelector('.arrow');
        if (arrow) {
            arrow.textContent = '▼';
        }
    }
    debugLog('Switched to Calendar Viewing view');
}
async function updateAppSettings() {
    try {
        const logLevel = document.getElementById('log-level').value;
        const settings = {
            logLevel
        };
        await window.electronAPI.setAppSettings(settings);
        debugLog(`Application settings updated - Log level: ${logLevel}`);
    } catch (error) {
        debugLog(`Error updating app settings: ${error.message}`, 'error');
    }
}
async function loadAppSettings() {
    try {
        const settings = await window.electronAPI.getAppSettings();
        const logLevelSelect = document.getElementById('log-level');
        if (logLevelSelect) {
            logLevelSelect.value = settings.logLevel || 'info';
        }
        // Apply theme from settings
        currentTheme = settings.theme || 'light';
        applyTheme(currentTheme);
        
        // Apply snow setting (default to true)
        applySnowSetting(settings.snowEnabled !== false);
        // Initialize WebSocket forwarding status from settings
        wsForwardingEnabled = settings.enableWebSocketForwarding || false;
        updateWebSocketForwardingStatus(wsForwardingEnabled);
        debugLog('Application settings loaded from saved config');
    } catch (error) {
        debugLog(`Error loading app settings: ${error.message}`, 'error');
    }
}
async function loadLastUsername() {
    try {
        const lastUsername = await window.electronAPI.getLastUsername();
        const usernameInput = document.getElementById('username');
        if (usernameInput && lastUsername) {
            usernameInput.value = lastUsername;
            debugLog(`Last username loaded: ${lastUsername}`);
        }
    } catch (error) {
        debugLog(`Error loading last username: ${error.message}`, 'error');
    }
}
window.addEventListener('beforeunload', () => {
    // Clear runtime timer
    if (runtimeInterval) {
        clearInterval(runtimeInterval);
    }
    // Clear OSC log flush and cleanup intervals
    if (oscFlushInterval) {
        clearInterval(oscFlushInterval);
        oscFlushInterval = null;
    }
    if (cleanupInterval) {
        clearInterval(cleanupInterval);
        cleanupInterval = null;
    }
    // Clear pending parameter update debounce
    if (paramUpdateTimer) {
        clearTimeout(paramUpdateTimer);
        paramUpdateTimer = null;
    }
    // Clear float rate limiting data and pending timeouts
    clearFloatRateLimitingData();
    window.electronAPI.removeAllListeners('osc-received');
    window.electronAPI.removeAllListeners('osc-server-status');
    window.electronAPI.removeAllListeners('websocket-status');
    window.electronAPI.removeAllListeners('websocket-error');
    window.electronAPI.removeAllListeners('websocket-authenticated');
    window.electronAPI.removeAllListeners('websocket-osc-data');
    window.electronAPI.removeAllListeners('websocket-avatar-change');
    window.electronAPI.removeAllListeners('websocket-parameter-update');
    window.electronAPI.removeAllListeners('websocket-server-message');
    window.electronAPI.removeAllListeners('websocket-panel-connections-update');
    window.electronAPI.removeAllListeners('app-settings');
});
async function addOscConnection(type) {
    if (additionalOscConnections.length >= maxAdditionalConnections) {
        debugLog(`Maximum ${maxAdditionalConnections} additional connections allowed`, 'error');
        return;
    }
    const newConnection = {
        id: Date.now().toString(),
        type: type, // 'incoming' or 'outgoing'
        port: null,
        address: '127.0.0.1',
        enabled: false, // Default to disabled for new connections
        name: '', // Optional user-defined name
        enableWebSocketForwarding: false // Default to disabled for WebSocket forwarding
    };
    additionalOscConnections.push(newConnection);
    
    // Apply the change immediately
    try {
        const currentConfig = await window.electronAPI.getServerConfig();
        const updatedConfig = {
            ...currentConfig,
            additionalOscConnections: additionalOscConnections
        };
        await window.electronAPI.setConfig(updatedConfig);
        debugLog(`Added new ${type} OSC connection slot (${additionalOscConnections.length}/${maxAdditionalConnections}) - configuration updated`);
    } catch (error) {
        debugLog(`Error adding OSC connection: ${error.message}`, 'error');
    }
    
    renderAdditionalOscConnections();
}
async function removeOscConnection(id) {
    additionalOscConnections = additionalOscConnections.filter(conn => conn.id !== id);
    
    // Apply the change immediately
    try {
        const currentConfig = await window.electronAPI.getServerConfig();
        const updatedConfig = {
            ...currentConfig,
            additionalOscConnections: additionalOscConnections
        };
        await window.electronAPI.setConfig(updatedConfig);
        debugLog(`Removed OSC connection - configuration updated`);
    } catch (error) {
        debugLog(`Error removing OSC connection: ${error.message}`, 'error');
    }
    
    renderAdditionalOscConnections();
}
async function toggleOscConnection(id, enabled) {
    try {
        const connection = additionalOscConnections.find(conn => conn.id === id);
        if (connection) {
            connection.enabled = enabled;
            // Update the configuration immediately
            const currentConfig = await window.electronAPI.getServerConfig();
            const updatedConfig = {
                ...currentConfig,
                additionalOscConnections: additionalOscConnections
            };
            await window.electronAPI.setConfig(updatedConfig);
            // Re-render to update the UI
            renderAdditionalOscConnections();
            debugLog(`${connection.name || 'Connection'} ${enabled ? 'enabled' : 'disabled'} - configuration updated`);
        }
    } catch (error) {
        debugLog(`Error toggling OSC connection: ${error.message}`, 'error');
    }
}
async function toggleOscConnectionWebSocketForwarding(id, enabled) {
    try {
        const connection = additionalOscConnections.find(conn => conn.id === id);
        if (connection) {
            connection.enableWebSocketForwarding = enabled;
            // Update the configuration immediately
            const currentConfig = await window.electronAPI.getServerConfig();
            const updatedConfig = {
                ...currentConfig,
                additionalOscConnections: additionalOscConnections
            };
            await window.electronAPI.setConfig(updatedConfig);
            // Re-render to update the UI
            renderAdditionalOscConnections();
            debugLog(`${connection.name || 'Connection'} WebSocket forwarding ${enabled ? 'enabled' : 'disabled'} - configuration updated`);
        }
    } catch (error) {
        debugLog(`Error toggling OSC connection WebSocket forwarding: ${error.message}`, 'error');
    }
}
async function updateOscConnection(id, field, value) {
    const connection = additionalOscConnections.find(conn => conn.id === id);
    if (connection) {
        if (field === 'port') {
            connection[field] = value ? parseInt(value) : null;
        } else {
            connection[field] = value;
        }
        // Apply changes immediately if it's a critical field
        if (field === 'port' || field === 'address') {
            try {
                const currentConfig = await window.electronAPI.getServerConfig();
                const updatedConfig = {
                    ...currentConfig,
                    additionalOscConnections: additionalOscConnections
                };
                await window.electronAPI.setConfig(updatedConfig);
                debugLog(`${connection.name || 'Connection'} ${field} updated to ${value} - configuration applied`);
            } catch (error) {
                debugLog(`Error updating OSC connection ${field}: ${error.message}`, 'error');
            }
        }
    }
}
function renderAdditionalOscConnections() {
    const container = document.getElementById('additional-osc-connections');
    const addIncomingBtn = document.getElementById('add-incoming-btn');
    const addOutgoingBtn = document.getElementById('add-outgoing-btn');
    const countSpan = document.getElementById('connection-count');
    if (!container || !addIncomingBtn || !addOutgoingBtn || !countSpan) {
        console.warn('OSC connection elements not found in DOM');
        return;
    }
    if (additionalOscConnections.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #999; font-style: italic; padding: 40px;">No additional connections configured</p>';
        countSpan.textContent = '0/20 additional connections';
        return;
    }
    container.innerHTML = '';
    const incomingConnections = additionalOscConnections.filter(conn => conn.type === 'incoming');
    const outgoingConnections = additionalOscConnections.filter(conn => conn.type === 'outgoing');
    const columnsContainer = document.createElement('div');
    columnsContainer.style.cssText = 'display: grid; grid-template-columns: 1fr 1fr; gap: 20px;';
    const incomingColumn = document.createElement('div');
    incomingColumn.style.cssText = 'min-height: 100px;';
    const outgoingColumn = document.createElement('div');
    outgoingColumn.style.cssText = 'min-height: 100px;';
    const isDarkTheme = document.body.classList.contains('dark-theme');
    const textColor = isDarkTheme ? '#b0b0b0' : '#666';
    const incomingHeader = document.createElement('h5');
    incomingHeader.style.cssText = 'margin: 0 0 15px 0; color: #27ae60; font-size: 1.1em; display: flex; align-items: center; padding-bottom: 8px; border-bottom: 2px solid #27ae60;';
    incomingHeader.innerHTML = '📥 Incoming <span style="font-size: 0.8em; margin-left: 10px; color: ' + textColor + ';">(' + incomingConnections.length + ')</span>';
    incomingColumn.appendChild(incomingHeader);
    const outgoingHeader = document.createElement('h5');
    outgoingHeader.style.cssText = 'margin: 0 0 15px 0; color: #e74c3c; font-size: 1.1em; display: flex; align-items: center; padding-bottom: 8px; border-bottom: 2px solid #e74c3c;';
    outgoingHeader.innerHTML = '📤 Outgoing <span style="font-size: 0.8em; margin-left: 10px; color: ' + textColor + ';">(' + outgoingConnections.length + ')</span>';
    outgoingColumn.appendChild(outgoingHeader);
    if (incomingConnections.length === 0) {
        const emptyState = document.createElement('p');
        emptyState.style.cssText = 'text-align: center; color: #999; font-style: italic; padding: 20px; border: 2px dashed #ddd; border-radius: 5px; margin-top: 10px;';
        emptyState.textContent = 'No incoming connections';
        incomingColumn.appendChild(emptyState);
    } else {
        incomingConnections.forEach((connection, index) => {
            incomingColumn.appendChild(createConnectionElement(connection, index + 1, 'Incoming'));
        });
    }
    if (outgoingConnections.length === 0) {
        const emptyState = document.createElement('p');
        emptyState.style.cssText = 'text-align: center; color: #999; font-style: italic; padding: 20px; border: 2px dashed #ddd; border-radius: 5px; margin-top: 10px;';
        emptyState.textContent = 'No outgoing connections';
        outgoingColumn.appendChild(emptyState);
    } else {
        outgoingConnections.forEach((connection, index) => {
            outgoingColumn.appendChild(createConnectionElement(connection, index + 1, 'Outgoing'));
        });
    }
    columnsContainer.appendChild(incomingColumn);
    columnsContainer.appendChild(outgoingColumn);
    container.appendChild(columnsContainer);
    const maxReached = additionalOscConnections.length >= maxAdditionalConnections;
    addIncomingBtn.disabled = maxReached;
    addOutgoingBtn.disabled = maxReached;
    countSpan.textContent = `${additionalOscConnections.length}/${maxAdditionalConnections} additional connections`;
    if (maxReached) {
        addIncomingBtn.textContent = '+ Maximum Reached';
        addIncomingBtn.className = 'btn btn-secondary';
        addOutgoingBtn.textContent = '+ Maximum Reached';
        addOutgoingBtn.className = 'btn btn-secondary';
    } else {
        addIncomingBtn.textContent = '+ Add Incoming';
        addIncomingBtn.className = 'btn btn-success';
        addOutgoingBtn.textContent = '+ Add Outgoing';
        addOutgoingBtn.className = 'btn btn-success';
    }
}
function createConnectionElement(connection, index, typeLabel) {
    const connectionDiv = document.createElement('div');
    connectionDiv.className = 'osc-connection-item';
    connectionDiv.style.cssText = `
        border: 1px solid ${connection.type === 'incoming' ? '#27ae60' : '#e74c3c'};
        border-radius: 5px;
        padding: 15px;
        margin-bottom: 15px;
        background-color: ${connection.type === 'incoming' ? '#f8fff8' : '#fff8f8'};
        transition: box-shadow 0.2s ease;
    `;
    connectionDiv.onmouseenter = () => {
        connectionDiv.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';
    };
    connectionDiv.onmouseleave = () => {
        connectionDiv.style.boxShadow = 'none';
    };
    const portLabel = connection.type === 'incoming' ? 'Listen Port' : 'Target Port';
    const addressLabel = connection.type === 'incoming' ? 'Listen Address' : 'Target Address';
    const defaultAddress = connection.type === 'incoming' ? '0.0.0.0' : '127.0.0.1';
    if (!connection.address) {
        connection.address = defaultAddress;
    }
    const statusBadge = connection.enabled ? 
        '<span style="background: #27ae60; color: white; padding: 2px 8px; border-radius: 12px; font-size: 0.75em;">Enabled</span>' :
        '<span style="background: #95a5a6; color: white; padding: 2px 8px; border-radius: 12px; font-size: 0.75em;">Disabled</span>';
    const isDarkTheme = document.body.classList.contains('dark-theme');
    const smallTextColor = isDarkTheme ? '#b0b0b0' : '#666';
    const headerTextColor = isDarkTheme ? '#e0e0e0' : '#2c3e50';
    connectionDiv.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 15px;">
            <div style="flex: 1;">
                <h6 style="margin: 0 0 5px 0; color: ${headerTextColor}; font-size: 0.95em;">
                    ${connection.name || `Connection ${index}`}
                </h6>
                <div style="margin-bottom: 8px;">${statusBadge}</div>
                <small style="color: ${smallTextColor}; font-size: 0.8em; line-height: 1.3;">
                    ${connection.type === 'incoming' ? '🔽 Receives OSC data' : '🔼 Sends OSC data'}
                </small>
            </div>
            <button class="btn btn-danger" onclick="removeOscConnection('${connection.id}')" style="padding: 4px 12px; font-size: 12px;">Remove</button>
        </div>
        
        <div style="display: flex; flex-direction: column; gap: 10px;">
            <div class="form-group" style="margin-bottom: 0;">
                <label style="font-size: 0.85em; font-weight: 600; color: ${headerTextColor};">Connection Name</label>
                <input type="text" placeholder="e.g. TouchOSC, SteamVR.." value="${connection.name || ''}" 
                       onchange="updateOscConnection('${connection.id}', 'name', this.value)"
                       style="width: 100%; padding: 6px 8px; font-size: 13px; border: 1px solid #ddd; border-radius: 3px;">
            </div>
            
            <div class="form-group" style="margin-bottom: 0;">
                <label style="font-size: 0.85em; font-weight: 600; color: ${headerTextColor};">${portLabel}</label>
                <input type="number" placeholder="9040" value="${connection.port || ''}" 
                       onchange="updateOscConnection('${connection.id}', 'port', this.value)"
                       style="width: 100%; padding: 6px 8px; font-size: 13px; border: 1px solid #ddd; border-radius: 3px;"
                       min="1" max="65535">
            </div>
            
            <div class="form-group" style="margin-bottom: 0;">
                <label style="font-size: 0.85em; font-weight: 600; color: ${headerTextColor};">${addressLabel}</label>
                <input type="text" value="${connection.address}" 
                       onchange="updateOscConnection('${connection.id}', 'address', this.value)"
                       style="width: 100%; padding: 6px 8px; font-size: 13px; border: 1px solid #ddd; border-radius: 3px;"
                       placeholder="${defaultAddress}">
            </div>
            
            <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 8px;">
                <label style="font-size: 0.85em; font-weight: 600; color: ${headerTextColor}; margin: 0;">Connection Status:</label>
                <button class="btn ${connection.enabled ? 'btn-danger' : 'btn-success'}" 
                        onclick="toggleOscConnection('${connection.id}', ${!connection.enabled})"
                        style="padding: 4px 12px; font-size: 12px; min-width: 70px;">
                    ${connection.enabled ? 'Disable' : 'Enable'}
                </button>
            </div>
            
            ${connection.type === 'incoming' ? `
            <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 8px;">
                <label style="font-size: 0.85em; font-weight: 600; color: ${headerTextColor}; margin: 0;">ARC Server Forward:</label>
                <button class="btn ${connection.enableWebSocketForwarding ? 'btn-danger' : 'btn-success'}" 
                        onclick="toggleOscConnectionWebSocketForwarding('${connection.id}', ${!connection.enableWebSocketForwarding})"
                        style="padding: 4px 12px; font-size: 12px; min-width: 70px;">
                    ${connection.enableWebSocketForwarding ? 'Disable' : 'Enable'}
                </button>
            </div>
            ` : ''}
        </div>
    `;
    return connectionDiv;
}
// OSC-Query Unsubscription Management
// Note: By default, OSC-Query receives ALL OSC data (/*).
// Unsubscriptions allow you to ignore specific paths that you don't need.

async function loadOscQueryUnsubscriptions() {
    try {
        const result = await window.electronAPI.getOscQueryUnsubscriptions();
        if (result && result.success) {
            renderOscQueryUnsubscriptions(result.unsubscriptions || []);
            debugLog(`OSC-Query unsubscriptions loaded: ${result.unsubscriptions.length === 0 ? 'None (listening to all)' : result.unsubscriptions.length}`, 'info');
        }
    } catch (error) {
        debugLog(`Error loading OSC-Query unsubscriptions: ${error.message}`, 'error');
    }
}

function renderOscQueryUnsubscriptions(unsubscriptions) {
    const container = document.getElementById('oscquery-unsubscriptions-list');
    if (!container) return;

    const isDarkTheme = document.body.classList.contains('dark-theme');
    const itemBgColor = isDarkTheme ? '#2c2c2c' : '#fff';
    const pathColor = isDarkTheme ? '#e0e0e0' : '#495057';
    const emptyTextColor = isDarkTheme ? '#a0a0a0' : '#666';

    if (unsubscriptions.length === 0) {
        container.innerHTML = `
            <p style="color: ${emptyTextColor}; font-size: 0.9em; font-style: italic; text-align: center; padding: 10px;">
                No paths are being ignored. All OSC data is being received.
            </p>
        `;
        return;
    }

    container.innerHTML = unsubscriptions.map(path => `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 12px;
                    background-color: ${itemBgColor}; border-radius: 4px; margin-bottom: 5px; border-left: 3px solid #dc3545;">
            <span style="font-family: monospace; color: ${pathColor};">${path}</span>
            <button class="btn btn-success" onclick="removeOscQueryUnsubscription('${path}')"
                    style="padding: 2px 8px; font-size: 12px;">Remove (Listen Again)</button>
        </div>
    `).join('');
}

async function addOscQueryUnsubscription() {
    const input = document.getElementById('oscquery-unsubscribe-path');
    if (!input) return;
    
    const path = input.value.trim();
    if (!path) {
        debugLog('Please enter a valid OSC path', 'error');
        return;
    }
    
    // Validate OSC path format
    if (!path.startsWith('/')) {
        debugLog('OSC path must start with /', 'error');
        return;
    }
    
    try {
        const result = await window.electronAPI.addOscQueryUnsubscription(path);
        if (result && result.success) {
            debugLog(`Added unsubscription: ${path}`, 'info');
            renderOscQueryUnsubscriptions(result.unsubscriptions || []);
            input.value = ''; // Clear input
        } else {
            debugLog(`Failed to add unsubscription: ${result.error || result.message}`, 'error');
        }
    } catch (error) {
        debugLog(`Error adding unsubscription: ${error.message}`, 'error');
    }
}

async function removeOscQueryUnsubscription(path) {
    try {
        const result = await window.electronAPI.removeOscQueryUnsubscription(path);
        if (result && result.success) {
            debugLog(`Removed unsubscription: ${path} - now listening to this path again`, 'info');
            renderOscQueryUnsubscriptions(result.unsubscriptions || []);
        } else {
            debugLog(`Failed to remove unsubscription: ${result.error}`, 'error');
        }
    } catch (error) {
        debugLog(`Error removing unsubscription: ${error.message}`, 'error');
    }
}

// Server-Managed Blocked Parameters Display
// Shows hardcoded blocks, server blocklist, and server suppressions with simple indicators

async function loadBlockedParameters() {
    try {
        const [blocklistResult, suppressionsResult, hardcodedResult] = await Promise.all([
            window.electronAPI.getServerBlocklist(),
            window.electronAPI.getServerSuppressions(),
            window.electronAPI.getHardcodedUnsubscriptions()
        ]);
        renderBlockedParameters(
            hardcodedResult?.patterns || [],
            blocklistResult?.patterns || [],
            suppressionsResult?.addresses || [],
            suppressionsResult?.metadata || {}
        );
    } catch (error) {
        debugLog(`Error loading blocked parameters: ${error.message}`, 'error');
    }
}

function renderBlockedParameters(hardcoded, serverBlocklist, serverSuppressions, suppressionMetadata) {
    const container = document.getElementById('blocked-parameters-list');
    if (!container) return;
    const isDarkTheme = document.body.classList.contains('dark-theme');
    const itemBg = isDarkTheme ? '#3a3520' : '#fff8e1';
    const textColor = isDarkTheme ? '#e0d8a0' : '#856404';
    const emptyColor = isDarkTheme ? '#a0a0a0' : '#666';
    const badgeBlockedBg = isDarkTheme ? '#4a4020' : '#ffc107';
    const badgeBlockedColor = isDarkTheme ? '#ffd700' : '#856404';
    const badgeUserBg = isDarkTheme ? '#2a3a4a' : '#d1ecf1';
    const badgeUserColor = isDarkTheme ? '#8cc8e0' : '#0c5460';
    const badgeSuppressedBg = isDarkTheme ? '#4a2020' : '#f8d7da';
    const badgeSuppressedColor = isDarkTheme ? '#e08080' : '#721c24';
    const badgePanelBg = isDarkTheme ? '#1a3a2a' : '#cce5ff';
    const badgePanelColor = isDarkTheme ? '#70c0a0' : '#004085';
    const badgeAvatarJsonBg = isDarkTheme ? '#1a3a1a' : '#d4edda';
    const badgeAvatarJsonColor = isDarkTheme ? '#70c070' : '#155724';
    const totalCount = hardcoded.length + serverBlocklist.length + serverSuppressions.length;
    if (totalCount === 0) {
        container.innerHTML = `<p style="color: ${emptyColor}; font-size: 0.9em; font-style: italic; text-align: center; padding: 10px;">
            No blocked parameters. All data is being forwarded normally.
        </p>`;
        return;
    }
    const renderStaticItem = (path, source) => {
        const isServer = source === 'Blocked';
        const bg = isServer ? badgeBlockedBg : badgeUserBg;
        const color = isServer ? badgeBlockedColor : badgeUserColor;
        return `<div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 12px;
                    background-color: ${itemBg}; border-radius: 4px; margin-bottom: 4px; border-left: 3px solid #ffc107;">
            <span style="font-family: monospace; font-size: 0.85em; color: ${textColor};">${path}</span>
            <span style="font-size: 11px; padding: 2px 8px; border-radius: 3px; background: ${bg}; color: ${color}; font-weight: 600;">${source}</span>
        </div>`;
    };
    const renderSuppressedItem = (path, meta) => {
        const isPanelParam = meta?.isPanelParam || false;
        const isInAvatarJson = meta?.isInAvatarJson || false;
        const canUnsuppress = isPanelParam || isInAvatarJson;
        const hoverBg = isDarkTheme ? '#4a3a20' : '#fff0c0';
        let badges = `<span style="font-size: 11px; padding: 2px 8px; border-radius: 3px; background: ${badgeSuppressedBg}; color: ${badgeSuppressedColor}; font-weight: 600;">Suppressed</span>`;
        if (isPanelParam) {
            badges += ` <span style="font-size: 10px; padding: 1px 6px; border-radius: 3px; background: ${badgePanelBg}; color: ${badgePanelColor}; font-weight: 600;">Panel</span>`;
        }
        if (isInAvatarJson) {
            badges += ` <span style="font-size: 10px; padding: 1px 6px; border-radius: 3px; background: ${badgeAvatarJsonBg}; color: ${badgeAvatarJsonColor}; font-weight: 600;">Avatar JSON</span>`;
        }
        const cursorStyle = canUnsuppress ? 'cursor: pointer;' : '';
        const hoverAttr = canUnsuppress ? `onmouseenter="this.style.backgroundColor='${hoverBg}'" onmouseleave="this.style.backgroundColor='${itemBg}'"` : '';
        const clickAttr = canUnsuppress ? `onclick="handleUnsuppressClick('${path.replace(/'/g, "\\'")}')"` : '';
        const unsuppressHint = canUnsuppress
            ? `<span style="font-size: 10px; color: ${isDarkTheme ? '#a0a080' : '#888'}; margin-left: 8px;">Click to unsuppress</span>`
            : '';
        return `<div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 12px;
                    background-color: ${itemBg}; border-radius: 4px; margin-bottom: 4px; border-left: 3px solid #dc3545; ${cursorStyle}"
                    ${hoverAttr} ${clickAttr}>
            <span style="font-family: monospace; font-size: 0.85em; color: ${textColor};">${path}${unsuppressHint}</span>
            <span style="white-space: nowrap;">${badges}</span>
        </div>`;
    };
    let html = '';
    if (hardcoded.length > 0) {
        html += hardcoded.map(p => renderStaticItem(p, 'User')).join('');
    }
    if (serverBlocklist.length > 0) {
        html += serverBlocklist.map(p => renderStaticItem(p, 'Blocked')).join('');
    }
    if (serverSuppressions.length > 0) {
        html += serverSuppressions.map(p => renderSuppressedItem(p, suppressionMetadata?.[p])).join('');
    }
    const existingItems = document.getElementById('blocked-parameters-items');
    const wasExpanded = existingItems && existingItems.style.display !== 'none';
    const displayStyle = wasExpanded ? 'block' : 'none';
    const arrowChar = wasExpanded ? '▼' : '▶';
    const toggleLabel = wasExpanded ? 'Collapse' : 'Expand';
    container.innerHTML = `
        <div style="margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center;">
            <span style="color: ${isDarkTheme ? '#b0b0b0' : '#666'}; font-size: 0.85em;">
                <strong>${totalCount} blocked path(s)</strong>
            </span>
            <button class="btn btn-secondary" onclick="toggleBlockedParametersList()"
                    style="padding: 2px 8px; font-size: 11px;" id="toggle-blocked-list-btn">
                <span id="toggle-blocked-arrow">${arrowChar}</span> ${toggleLabel}
            </button>
        </div>
        <div id="blocked-parameters-items" style="display: ${displayStyle};">
            ${html}
        </div>
    `;
}

async function handleUnsuppressClick(address) {
    try {
        const result = await window.electronAPI.requestUnsuppress(address);
        if (!result.success) {
            debugLog(`Unsuppress request failed: ${result.error}`, 'error');
        }
    } catch (error) {
        debugLog(`Error requesting unsuppress: ${error.message}`, 'error');
    }
}

function toggleBlockedParametersList() {
    const items = document.getElementById('blocked-parameters-items');
    const btn = document.getElementById('toggle-blocked-list-btn');
    const arrow = document.getElementById('toggle-blocked-arrow');
    if (!items || !btn || !arrow) return;
    if (items.style.display === 'none') {
        items.style.display = 'block';
        arrow.textContent = '▼';
        btn.innerHTML = '<span id="toggle-blocked-arrow">▼</span> Collapse';
    } else {
        items.style.display = 'none';
        arrow.textContent = '▶';
        btn.innerHTML = '<span id="toggle-blocked-arrow">▶</span> Expand';
    }
}

// Legacy functions kept for compatibility (now empty or redirected)
async function loadOscQuerySubscriptions() {
    // Redirected to unsubscriptions
    await loadOscQueryUnsubscriptions();
}

function renderOscQuerySubscriptions(subscriptions) {
    // Deprecated - now uses unsubscriptions
}


async function addOscQuerySubscription() {
    // Deprecated
    debugLog('Function deprecated - use unsubscription management instead', 'info');
}

async function removeOscQuerySubscription(pattern) {
    // Deprecated
    debugLog('Function deprecated - use unsubscription management instead', 'info');
}

async function loadTheme() {
    try {
        const settings = await window.electronAPI.getAppSettings();
        currentTheme = settings.theme || 'light';
        applyTheme(currentTheme);
        debugLog(`Theme loaded: ${currentTheme}`);
    } catch (error) {
        debugLog(`Error loading theme: ${error.message}`, 'error');
        currentTheme = 'light';
        applyTheme(currentTheme);
    }
}
function applyTheme(theme) {
    const body = document.body;
    if (theme === 'dark') {
        body.classList.add('dark-theme');
    } else {
        body.classList.remove('dark-theme');
    }
    currentTheme = theme;
}
async function toggleTheme() {
    try {
        const newTheme = currentTheme === 'light' ? 'dark' : 'light';
        applyTheme(newTheme);
        // Save the theme setting
        const currentSettings = await window.electronAPI.getAppSettings();
        currentSettings.theme = newTheme;
        await window.electronAPI.setAppSettings(currentSettings);
        debugLog(`Theme switched to ${newTheme} mode`);
    } catch (error) {
        debugLog(`Error toggling theme: ${error.message}`, 'error');
    }
}

// Snow overlay toggle
let snowEnabled = true;

async function toggleSnow() {
    try {
        snowEnabled = !snowEnabled;
        const snowOverlay = document.getElementById('snow-overlay');
        const snowButton = document.getElementById('snow-toggle');
        
        if (snowEnabled) {
            snowOverlay.classList.remove('hidden');
            snowButton.classList.remove('disabled');
        } else {
            snowOverlay.classList.add('hidden');
            snowButton.classList.add('disabled');
        }
        
        // Save the setting
        const currentSettings = await window.electronAPI.getAppSettings();
        currentSettings.snowEnabled = snowEnabled;
        await window.electronAPI.setAppSettings(currentSettings);
        debugLog(`Snow overlay ${snowEnabled ? 'enabled' : 'disabled'}`);
    } catch (error) {
        debugLog(`Error toggling snow: ${error.message}`, 'error');
    }
}

function applySnowSetting(enabled) {
    snowEnabled = enabled !== false; // Default to true if undefined
    const snowOverlay = document.getElementById('snow-overlay');
    const snowButton = document.getElementById('snow-toggle');
    
    if (snowOverlay && snowButton) {
        if (snowEnabled) {
            snowOverlay.classList.remove('hidden');
            snowButton.classList.remove('disabled');
        } else {
            snowOverlay.classList.add('hidden');
            snowButton.classList.add('disabled');
        }
    }
}
// Password saving functionality
async function handleSavePasswordCheckbox() {
    const checkbox = document.getElementById('save-password-checkbox');
    
    if (checkbox.checked) {
        // Save current password if there is one
        const password = document.getElementById('password').value;
        if (password) {
            try {
                await window.electronAPI.setSavedPassword(password);
                debugLog('Password saved to configuration (encrypted)');
            } catch (error) {
                debugLog(`Error saving password: ${error.message}`, 'error');
                checkbox.checked = false;
            }
        }
    } else {
        // Unchecking - remove saved password
        try {
            await window.electronAPI.setSavedPassword('');
            debugLog('Saved password removed from configuration');
        } catch (error) {
            debugLog(`Error removing saved password: ${error.message}`, 'error');
        }
    }
}

async function loadSavedPasswordSetting() {
    try {
        const result = await window.electronAPI.getSavedPassword();
        const checkbox = document.getElementById('save-password-checkbox');
        const passwordInput = document.getElementById('password');
        const usernameInput = document.getElementById('username');
        
        if (result && result.password) {
            checkbox.checked = true;
            passwordInput.value = result.password;
            debugLog('Saved password loaded from configuration (encrypted)');
            
            // Auto-connect if username is also present
            if (usernameInput && usernameInput.value.trim()) {
                debugLog('Auto-connecting with saved credentials...');
                // Delay slightly to ensure UI is ready
                setTimeout(() => {
                    authenticate();
                }, 500);
            }
        }
    } catch (error) {
        debugLog(`Error loading saved password: ${error.message}`, 'error');
    }
}

// Update password saving when user types new password
async function handlePasswordChange() {
    const checkbox = document.getElementById('save-password-checkbox');
    const passwordInput = document.getElementById('password');
    
    if (checkbox.checked) {
        const password = passwordInput.value;
        try {
            await window.electronAPI.setSavedPassword(password);
        } catch (error) {
            debugLog(`Error updating saved password: ${error.message}`, 'error');
        }
    }
}

// Add password change listener after DOM loads
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        const passwordInput = document.getElementById('password');
        if (passwordInput) {
            let saveTimeout;
            passwordInput.addEventListener('input', () => {
                if (saveTimeout) {
                    clearTimeout(saveTimeout);
                }
                saveTimeout = setTimeout(handlePasswordChange, 1000);
            });
        }
    }, 100);
});

// =============================================
// HypeRate Integration - See Hyperate-UI.js
// =============================================
// All HypeRate UI functions have been moved to Hyperate-UI.js
// Functions include: toggleHyperate(), refreshHyperateStatus(), addHyperateTracker(),
// removeHyperateTracker(), setPrimaryHyperateTracker(), refreshHyperateTrackers(), 
// updateHyperateUI(), and tracker edit modal functions
// Access via: window.HyperateUI.functionName()

// Enhanced showHyperateView to include auto-refresh functionality
const originalShowHyperateView = showHyperateView;
showHyperateView = function() {
    try {
        // Stop any existing status updates first
        if (window.HyperateUI && typeof window.HyperateUI.stopHyperateStatusUpdates === 'function') {
            window.HyperateUI.stopHyperateStatusUpdates();
        }
        
        // Call the original function
        originalShowHyperateView.call(this);
        
        // Refresh HypeRate status after view loads
        setTimeout(async () => {
            try {
                if (window.HyperateUI) {
                    await window.HyperateUI.refreshHyperateStatus();
                    await window.HyperateUI.refreshHyperateTrackers();
                    if (typeof window.HyperateUI.startHyperateStatusUpdates === 'function') {
                        window.HyperateUI.startHyperateStatusUpdates();
                    }
                }
            } catch (error) {
                debugLog(`Error refreshing HypeRate view: ${error.message}`, 'error');
            }
        }, 800);
    } catch (error) {
        debugLog(`Error in showHyperateView: ${error.message}`, 'error');
        originalShowHyperateView.call(this);
    }
};

// Listen for heart rate updates from main process
window.electronAPI.onHyperateUpdate?.((data) => {
    if (data.heartRate && window.HyperateUI && typeof window.HyperateUI.updateHeartRateDisplay === 'function') {
        window.HyperateUI.updateHeartRateDisplay(data.heartRate);
    }
});

// =============================================
// OSCLeash Integration - See OSCLeash-UI.js
// =============================================
// All OSCLeash UI functions have been moved to OSCLeash-UI.js
// Functions include: toggleOSCLeash(), refreshOSCLeashStatus(), updateLeashesDisplay(),
// loadOSCLeashConfig(), saveOSCLeashConfig(), resetOSCLeashConfig(), showConfigTab()
// Access via: window.OSCLeashUI.functionName()

// Listen for OSCLeash movement data updates from main process
window.electronAPI.onOSCLeashMovement?.((data) => {
    // Only update displays if OSCLeash view is visible
    if (document.getElementById('osc-leash-view').style.display !== 'none') {
        if (window.OSCLeashUI) {
            // Update movement display with real-time data
            if (typeof window.OSCLeashUI.updateMovementDisplay === 'function') {
                window.OSCLeashUI.updateMovementDisplay(data.vertical, data.horizontal, data.run);
            }
            
            // Update physbone inputs display with real-time data
            if (typeof window.OSCLeashUI.updatePhysboneInputsDisplay === 'function') {
                window.OSCLeashUI.updatePhysboneInputsDisplay(data.physboneData);
            }
        }
    }
});

// Enhanced showOSCLeashView to load configuration
const originalShowOSCLeashView = showOSCLeashView;
showOSCLeashView = function() {
    try {
        originalShowOSCLeashView.call(this);
        setTimeout(async () => {
            try {
                if (window.OSCLeashUI) {
                    await window.OSCLeashUI.refreshOSCLeashStatus();
                    await window.OSCLeashUI.loadOSCLeashConfig();
                    await window.OSCLeashUI.loadOSCLeashAutostartStatus();
                }
            } catch (error) {
                debugLog(`Error refreshing OSCLeash view: ${error.message}`, 'error');
            }
        }, 100);
    } catch (error) {
        debugLog(`Error in showOSCLeashView: ${error.message}`, 'error');
        originalShowOSCLeashView.call(this);
    }
};

// =============================================
// VRChat API Integration - See VRC-API-UI.js
// =============================================
// All VRChat API UI functions have been moved to VRC-API-UI.js
// Functions include: loadVRChatApiStatus(), vrchatApiLogin(), vrchatApiVerify2FA(),
// vrchatApiLogout(), shareVRChatWithARC(), confirmVRChatLink(), and modal functions
// Access via: window.VRChatAPIUI.functionName()

// Wrap showVRChatAPIView to load status and stats
const originalShowVRChatAPIView = showVRChatAPIView;
window.showVRChatAPIView = function() {
    try {
        originalShowVRChatAPIView.call(this);
        
        // Load status and stats after view is shown
        setTimeout(() => {
            if (window.VRChatAPIUI) {
                window.VRChatAPIUI.loadVRChatApiStatus();
                window.VRChatAPIUI.loadVRChatApiStats();
            }
        }, 100);
    } catch (error) {
        debugLog(`Error in showVRChatAPIView: ${error.message}`, 'error');
        originalShowVRChatAPIView.call(this);
    }
};

// ============================================
// Panel Dashboard Functions
// ============================================

function renderPanelDashboard() {
    const container = document.getElementById('panels-grid');
    if (!container) return;
    
    if (!panelConnectionsData || Object.keys(panelConnectionsData).length === 0) {
        container.innerHTML = '<p class="panels-loading">No panels found. Create panels in the ARC dashboard.</p>';
        return;
    }
    
    container.innerHTML = '';
    const now = Date.now();
    
    Object.entries(panelConnectionsData).forEach(([panelId, panelInfo]) => {
        const card = document.createElement('div');
        card.className = 'panel-card';
        
        const statusClass = panelInfo.isActive ? 'active' : 'inactive';
        const statusText = panelInfo.isActive ? 'Active' : 'Inactive';
        
        // Panel lock status
        const lockClass = panelInfo.panelEnabled ? 'unlocked' : 'locked';
        const lockText = panelInfo.panelEnabled ? 'Unlocked' : 'Locked';
        
        // Safety bubbles HTML
        const safetyStatuses = [
            panelInfo.safetyEnabled,
            panelInfo.safety2Enabled,
            panelInfo.safety3Enabled,
            panelInfo.safety4Enabled,
            panelInfo.safety5Enabled
        ];
        const safetyBubblesHtml = safetyStatuses.map((enabled, index) => {
            const statusClass = enabled ? 'enabled' : 'disabled';
            return `<span class="safety-bubble ${statusClass}">${index + 1}</span>`;
        }).join('');
        
        // Access indicators HTML
        // Visibility: Private (red) or Public (green) - mutually exclusive
        const visibilityClass = panelInfo.isPublic ? 'public' : 'private';
        const visibilityText = panelInfo.isPublic ? 'Public' : 'Private';
        // Password protection
        const passClass = panelInfo.hasPassword ? 'active' : 'inactive';
        // Panel-level friend sharing (yellow when enabled)
        const friendsClass = panelInfo.allowFriends ? 'friends' : 'inactive';
        // Links with breakdown: L:N (F:X P:Y)
        const linkCount = panelInfo.activeLinkCount || 0;
        const friendLinkCount = panelInfo.friendLinkCount || 0;
        const publicLinkCount = panelInfo.publicLinkCount || 0;
        let linksHtml = '';
        if (linkCount > 0) {
            let breakdown = [];
            if (friendLinkCount > 0) breakdown.push(`F:${friendLinkCount}`);
            if (publicLinkCount > 0) breakdown.push(`P:${publicLinkCount}`);
            const breakdownText = breakdown.length > 0 ? ` (${breakdown.join(' ')})` : '';
            linksHtml = `<span class="access-indicator links">L:${linkCount}${breakdownText}</span>`;
        } else {
            linksHtml = `<span class="access-indicator inactive">Links</span>`;
        }
        
        // Calculate connection time display (will update every 30s)
        const connectionTime = panelInfo.connectionCount > 0 ? 
            '<div class="panel-connection-time" data-panel-id="' + escapeHtml(panelId) + '">Viewing now</div>' :
            '';
        
        card.innerHTML = `
            <div class="panel-card-header">
                <h4 class="panel-name">${escapeHtml(panelInfo.panelName)}</h4>
                <div style="display: flex; gap: 6px;">
                    <span class="panel-lock-badge ${lockClass}">${lockText}</span>
                    <span class="panel-status-badge ${statusClass}">${statusText}</span>
                </div>
            </div>
            <div class="panel-stats">
                <div class="panel-stat">
                    <span class="panel-stat-value">${panelInfo.connectionCount}</span>
                    <span class="panel-stat-label">Connections</span>
                </div>
            </div>
            <div class="safety-bubbles-row">
                <span class="safety-label">Safety</span>
                <div class="safety-bubbles">
                    ${safetyBubblesHtml}
                </div>
            </div>
            <div class="access-indicators-row">
                <span class="access-indicator ${visibilityClass}">${visibilityText}</span>
                <span class="access-indicator ${passClass}">Pass</span>
                <span class="access-indicator ${friendsClass}">Friends</span>
                ${linksHtml}
            </div>
            ${connectionTime}
        `;
        
        container.appendChild(card);
    });
    
    // Start/restart the 30-second update interval for connection times
    startPanelUpdateInterval();
}

function startPanelUpdateInterval() {
    // Clear existing interval if any
    if (panelUpdateInterval) {
        clearInterval(panelUpdateInterval);
    }
    
    // Update connection times every 30 seconds
    panelUpdateInterval = setInterval(() => {
        updatePanelConnectionTimes();
    }, 30000);
}

function updatePanelConnectionTimes() {
    const timeElements = document.querySelectorAll('.panel-connection-time');
    timeElements.forEach(el => {
        const panelId = el.getAttribute('data-panel-id');
        if (panelId && panelConnectionsData[panelId] && panelConnectionsData[panelId].connectionCount > 0) {
            el.textContent = 'Viewing now';
        }
    });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Clear panel update interval on disconnect
const originalDisconnect = disconnect;
disconnect = function() {
    if (panelUpdateInterval) {
        clearInterval(panelUpdateInterval);
        panelUpdateInterval = null;
    }
    panelConnectionsData = {};
    if (originalDisconnect) {
        return originalDisconnect();
    }
};

// =============================================
// VRC Timeline Link Modal Functions
// =============================================
let vrcTimelineLinkUrl = '';

window.showVRCTimelineLinkModal = function showVRCTimelineLinkModal(url) {
    vrcTimelineLinkUrl = url;
    const modal = document.getElementById('vrc-timeline-link-modal');
    const urlDisplay = document.getElementById('vrc-timeline-link-url');
    if (modal && urlDisplay) {
        urlDisplay.textContent = url;
        modal.style.display = 'block';
        requestAnimationFrame(() => {
            modal.style.opacity = '1';
        });
    }
};

window.closeVRCTimelineLinkModal = function closeVRCTimelineLinkModal() {
    const modal = document.getElementById('vrc-timeline-link-modal');
    if (modal) {
        modal.style.opacity = '0';
        setTimeout(() => {
            modal.style.display = 'none';
            vrcTimelineLinkUrl = '';
        }, 300);
    }
};

window.copyVRCTimelineLink = function copyVRCTimelineLink() {
    if (vrcTimelineLinkUrl) {
        window.electronAPI.clipboardWriteText(vrcTimelineLinkUrl);
        debugLog(`Copied link to clipboard: ${vrcTimelineLinkUrl}`);
        closeVRCTimelineLinkModal();
    }
};

window.openVRCTimelineLinkInBrowser = function openVRCTimelineLinkInBrowser() {
    if (vrcTimelineLinkUrl) {
        window.electronAPI.openExternal(vrcTimelineLinkUrl);
        debugLog(`Opening link in browser: ${vrcTimelineLinkUrl}`);
        closeVRCTimelineLinkModal();
    }
};
