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
// Runtime timer
let startTime = Date.now();
let runtimeInterval = null;
// OSC message rate limiting
let oscLogBuffer = [];
let lastOscLogFlush = 0;
let oscReceivedDisplayEnabled = true; // Controls if OSC received logs are displayed and processed
const OSC_LOG_BUFFER_SIZE = 100; // Reduced for better memory management
const OSC_LOG_FLUSH_INTERVAL = 1000; // Flush every 1 second
const MAX_LOG_ENTRIES = 10000; // Maximum log entries to keep in DOM
// OSC parameter frequency tracking for unsubscription suggestions
let oscParameterFrequency = new Map(); // Track message count per address
let oscParameterLastUpdate = new Map(); // Track last update time per address
const FREQUENCY_TRACKING_WINDOW = 10000; // 10 second window
const HIGH_FREQUENCY_THRESHOLD = 20; // Messages per tracking window to be considered "high frequency"

// Adaptive suggestion system configuration
const LEARNING_PHASE_DURATION = 120000; // 2 minutes learning phase
const LEARNING_UPDATE_INTERVAL = 5000; // 5 seconds during learning
const NORMAL_UPDATE_INTERVAL = 30000; // 30 seconds after learning
const PATTERN_CACHE_INVALIDATION_THRESHOLD = 10; // Re-detect if 10+ new parameters appear

// Traffic monitoring thresholds (messages per second)
const TRAFFIC_NORMAL_THRESHOLD = 100; // <100 msg/sec = normal
const TRAFFIC_HEAVY_THRESHOLD = 1000; // 100-1000 msg/sec = heavy
// >1000 msg/sec = excessive

// Adaptive suggestion system state
let suggestionUpdateTimer = null;
let learningPhaseStartTime = null;
let isInLearningPhase = false;
let cachedPatterns = null;
let cachedPatternFingerprint = null; // Hash of high-freq parameters for change detection
let currentTrafficStatus = 'unknown'; // 'normal', 'heavy', 'excessive', 'unknown'
let lastTrafficAnalysis = null;
// Float rate limiting (similar to server implementation)
const FLOAT_THROTTLE_INTERVAL = 750; // ms
let lastFloatLogTimes = new Map(); // Track last log time per address
let pendingFloatTimeouts = new Map(); // Track pending timeouts for float logging
let lastFloatValues = new Map(); // Store latest values for delayed logging
// Websocket connection states end
document.addEventListener('DOMContentLoaded', async () => {
    await loadConfig();
    await loadAppSettings();
    await loadLastUsername();
    await loadTheme();
    setupEventListeners();
    setupExtrasDropdown();
    
    // Load OSC Query unsubscriptions on app start (visible whether OSC is enabled or not)
    await loadOscQueryUnsubscriptions();
    
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
    setInterval(() => {
        if (oscLogBuffer.length > 0) {
            flushOscLogBuffer();
        }
    }, OSC_LOG_FLUSH_INTERVAL);
    // Add periodic memory cleanup every 30 minutes
    setInterval(() => {
        // Clear float rate limiting data periodically
        clearFloatRateLimitingData();
        // More aggressive cleanup when OSC received display is disabled
        if (!oscReceivedDisplayEnabled) {
            oscLogBuffer = oscLogBuffer.filter(msg => msg.type !== 'received');
            if (window.gc) window.gc();
        }
        // If OSC received logs are getting too large, rotate them
        const receivedContainer = document.getElementById('osc-received-log-container');
        if (receivedContainer && receivedContainer.children.length > MAX_LOG_ENTRIES/2) {
            rotateLogContainers();
        }
        //debugLog('Performed periodic memory cleanup');
    }, 10000); // Every 30 minutes
    // Add UI responsiveness monitoring
    let lastHeartbeatTime = Date.now();
    function uiHeartbeat() {
        lastHeartbeatTime = Date.now();
    }
    // Call this on common UI interactions
    document.addEventListener('click', uiHeartbeat);
    document.addEventListener('keydown', uiHeartbeat);
    // Monitor UI responsiveness
    setInterval(() => {
        const now = Date.now();
        if (now - lastHeartbeatTime > 10000) {  // 30 minutes without UI interaction
            // Force cleanup
            clearFloatRateLimitingData();
            rotateLogContainers();
            if (window.gc) window.gc();
        }
    }, 10000);
});
async function loadConfig() {
    try {
        const config = await window.electronAPI.getServerConfig();
        document.getElementById('local-port-settings').value = config.localOscPort;
        document.getElementById('target-port-settings').value = config.targetOscPort;
        document.getElementById('target-address-settings').value = config.targetOscAddress;
        // Set WebSocket server URL
        const serverUrlInput = document.getElementById('server-url-settings');
        if (serverUrlInput) {
            serverUrlInput.value = config.websocketServerUrl || 'wss://avatar.comfychloe.uk:48255';
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
        // Track parameter frequency for suggestions
        trackOscParameter(data.address);
        
        oscReceivedLog(data.address, data.value, data.connectionId);
    });
    window.electronAPI.onOscForwarded((data) => {
        oscForwardedLog(data.address, data.value, data.connectionId);
    });
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
                setupSuggestionUpdater();
            } else if (data.status === 'error') {
                debugLog(`OSC-Query service error: ${data.error}`, 'error');
            } else if (data.status === 'stopped') {
                debugLog('OSC-Query service stopped');
                stopSuggestionUpdater();
            }
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
        } else if (data.status === 'disconnected') {
            isConnected = false;
            isAuthenticated = false;
            currentUser = null;
            currentAvatar = null;
            parameters = {};
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
            parameters = { ...parameters, ...data.parameters };
            updateParameterList();
        }
    });
    window.electronAPI.onWebSocketServerMessage((data) => {
        debugLog(`Server message: ${data.message || JSON.stringify(data)}`);
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
        const config = {
            websocketServerUrl: document.getElementById('server-url-settings').value
        };
        await window.electronAPI.setConfig(config);
        // Update the current server status after configuration update
        detectCurrentServer();
        debugLog('Server configuration updated');
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
                serverUrl = 'wss://avatar.comfychloe.uk:48255';
                serverName = 'ARC-Live';
                break;
            case 'beta':
                serverUrl = 'wss://beta.avatar.comfychloe.uk:48255';
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
            await window.electronAPI.websocketDisconnect();
        }
        
        // Update the configuration
        const config = {
            websocketServerUrl: serverUrl
        };
        
        // For custom server, don't persist the configuration
        if (serverType !== 'custom') {
            await window.electronAPI.setConfig(config);
            debugLog(`Switched to ${serverName} (${serverUrl}) - configuration saved`);
        } else {
            // Just update the WebSocket manager configuration without saving to file
            await window.electronAPI.setConfig(config);
            debugLog(`Switched to ${serverName} (${serverUrl}) - configuration NOT saved (dev mode)`);
        }
        
        // Auto-reconnect if we were previously connected
        if (wasConnected && currentUser) {
            const username = document.getElementById('username').value;
            const password = document.getElementById('password').value;
            if (username && password) {
                debugLog(`Auto-reconnecting to ${serverName}...`);
                setTimeout(async () => {
                    try {
                        await authenticate();
                        debugLog(`Successfully reconnected to ${serverName}`);
                    } catch (error) {
                        debugLog(`Failed to reconnect to ${serverName}: ${error.message}`, 'error');
                    }
                }, 1000);
            }
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
    
    if (serverUrl.includes('beta.avatar.comfychloe.uk')) {
        updateCurrentServerStatus('ARC-Beta', 'beta');
    } else if (serverUrl.includes('127.0.0.1')) {
        updateCurrentServerStatus('Custom (Dev)', 'custom');
    } else {
        updateCurrentServerStatus('ARC-Live', 'live');
    }
}
async function updateOscPorts() {
    try {
        const config = {
            localOscPort: parseInt(document.getElementById('local-port-settings').value),
            targetOscPort: parseInt(document.getElementById('target-port-settings').value),
            targetOscAddress: document.getElementById('target-address-settings').value
        };
        await window.electronAPI.setConfig(config);
        debugLog('Primary OSC configuration updated - OSC services will restart');
    } catch (error) {
        debugLog(`Error updating primary OSC configuration: ${error.message}`, 'error');
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
        return;
    }
    if (Object.keys(parameters).length === 0) {
        parameterList.innerHTML = '<p>No parameters detected. Make sure VRChat is running and avatar has parameters.</p>';
        return;
    }
    parameterList.innerHTML = '';
    Object.entries(parameters).forEach(([name, value]) => {
        const paramDiv = document.createElement('div');
        paramDiv.className = 'parameter-item';
        paramDiv.style.cssText = 'display: flex; justify-content: space-between; padding: 8px; border: 1px solid #ddd; margin-bottom: 5px; border-radius: 3px; background: #f9f9f9;';
        const nameSpan = document.createElement('span');
        nameSpan.style.fontWeight = 'bold';
        nameSpan.textContent = name;
        const valueSpan = document.createElement('span');
        valueSpan.style.color = '#666';
        valueSpan.textContent = typeof value === 'number' ? value.toFixed(3) : value.toString();
        paramDiv.appendChild(nameSpan);
        paramDiv.appendChild(valueSpan);
        parameterList.appendChild(paramDiv);
    });
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
        // Send via WebSocket if authenticated, otherwise use local OSC
        if (isAuthenticated && isConnected) {
            await window.electronAPI.sendOsc(oscData);
            debugLog(`OSC Sent via WebSocket: ${address} = ${parsedValue} (${type})`);
        } else {
            await window.electronAPI.sendOsc(oscData);
            debugLog(`OSC Sent locally: ${address} = ${parsedValue} (${type})`);
        }
        document.getElementById('osc-address').value = '';
        document.getElementById('osc-value').value = '';
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
function debugLog(message, type = 'info') {
    const container = document.getElementById('client-log-container');
    const timestamp = new Date().toLocaleTimeString();
    let color = '#00ff00'; // Default green
    if (type === 'error') color = '#ff0000';
    else if (type === 'warning') color = '#ffff00';
    const logEntry = document.createElement('div');
    logEntry.style.color = color;
    logEntry.innerHTML = `[${timestamp}] ${message}`;
    container.appendChild(logEntry);
    container.scrollTop = container.scrollHeight;
    while (container.children.length > 100) {
        container.removeChild(container.firstChild);
    }
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
    // Skip processing received logs if display is disabled
    if (type === 'received' && !oscReceivedDisplayEnabled) return;
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
        const logEntry = document.createElement('div');
        logEntry.style.color = color;
        logEntry.innerHTML = `[${timestamp}] ${address} = ${value}`;
        container.appendChild(logEntry);
        // Auto-scroll to bottom
        container.scrollTop = container.scrollHeight;
        // Limit log entries to prevent memory issues
        const maxEntries = type === 'arc-received' ? 500 : MAX_LOG_ENTRIES;
        while (container.children.length > maxEntries) {
            container.removeChild(container.firstChild);
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
function rotateLogContainers() {
    document.getElementById('osc-received-log-container').innerHTML = 'Log rotation performed<br>';
    clearFloatRateLimitingData();
    // Explicitly clear buffer to free memory immediately
    oscLogBuffer = oscLogBuffer.filter(msg => msg.type !== 'received');
    // Force garbage collection if available
    if (window.gc) window.gc();
    //debugLog('OSC received log container rotated to prevent memory issues');
}
function oscReceivedLog(address, value, connectionId = null) {
    // Skip processing if OSC received display is disabled
    if (!oscReceivedDisplayEnabled) return;
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
        // Clear DOM elements as well for complete reset
        document.getElementById('osc-received-log-container').innerHTML = 'Emergency buffer cleanup performed<br>';
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
            const logEntry = document.createElement('div');
            logEntry.style.color = '#00ff00';
            logEntry.innerHTML = `[${timestamp}] ${msg.address} = ${msg.value}`;
            fragment.appendChild(logEntry);
        });
        receivedContainer.appendChild(fragment);
        receivedContainer.scrollTop = receivedContainer.scrollHeight;
        // Trim logs to prevent memory bloat - use MAX_LOG_ENTRIES
        while (receivedContainer.children.length > MAX_LOG_ENTRIES) {
            receivedContainer.removeChild(receivedContainer.firstChild);
        }
    }
    // Batch update forwarded logs
    if (forwarded.length > 0 && forwardedContainer) {
        const fragment = document.createDocumentFragment();
        forwarded.forEach(msg => {
            const timestamp = new Date(msg.timestamp).toLocaleTimeString();
            const logEntry = document.createElement('div');
            logEntry.style.color = '#00aaff';
            logEntry.innerHTML = `[${timestamp}] ${msg.address} = ${msg.value}`;
            fragment.appendChild(logEntry);
        });
        forwardedContainer.appendChild(fragment);
        forwardedContainer.scrollTop = forwardedContainer.scrollHeight;
        // Trim logs to prevent memory bloat - use MAX_LOG_ENTRIES
        while (forwardedContainer.children.length > MAX_LOG_ENTRIES) {
            forwardedContainer.removeChild(forwardedContainer.firstChild);
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
        const logEntry = document.createElement('div');
        logEntry.style.color = '#ff8c00'; // Orange color to distinguish from regular OSC
        logEntry.innerHTML = `[${timestamp}] ${address} = ${value}`;
        container.appendChild(logEntry);
        // Auto-scroll to bottom
        container.scrollTop = container.scrollHeight;
        // Limit log entries to prevent memory issues
        const entries = container.children;
        if (entries.length > 500) {
            container.removeChild(entries[0]);
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
    [oscView, logsView, settingsView, voskView, hyperateView, arcfeedbackView, chatboxView, vrchatapiView, oscLeashView, autoInviterView].forEach(view => {
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
    const navMain = document.getElementById('nav-main');
    const navOsc = document.getElementById('nav-osc');
    const navLogs = document.getElementById('nav-logs');
    const navSettings = document.getElementById('nav-settings');
    const navVosk = document.getElementById('nav-vosk');
    const navHyperate = document.getElementById('nav-Hyperate');
    [mainView, logsView, settingsView, voskView, hyperateView, arcfeedbackView, chatboxView, vrchatapiView, oscLeashView, autoInviterView].forEach(view => {
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
    const navVosk = document.getElementById('nav-vosk');
    const navHyperate = document.getElementById('nav-Hyperate');
    [mainView, oscView, logsView, voskView, hyperateView, arcfeedbackView, chatboxView, vrchatapiView, oscLeashView, autoInviterView].forEach(view => {
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
    const navMain = document.getElementById('nav-main');
    const navOsc = document.getElementById('nav-osc');
    const navLogs = document.getElementById('nav-logs');
    const navSettings = document.getElementById('nav-settings');
    const navVosk = document.getElementById('nav-vosk');
    const navHyperate = document.getElementById('nav-Hyperate');
    [mainView, oscView, settingsView, voskView, hyperateView, arcfeedbackView, chatboxView, vrchatapiView, oscLeashView, autoInviterView].forEach(view => {
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
        // Update OSC received display status when logs view is shown
        updateOscReceivedDisplayStatus();
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
function showVOSKView() {
    const views = ['main-view', 'osc-view', 'vosk-view', 'Hyperate-view', 'arcfeedback-view', 'chatbox-view', 'vrchatapi-view', 'osc-leash-view', 'auto-inviter-view', 'logs-view', 'settings-view'].map(id => document.getElementById(id));
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
function showHyperateView() {
    debugLog('showHyperateView called');
    const views = ['main-view', 'osc-view', 'vosk-view', 'Hyperate-view', 'arcfeedback-view', 'chatbox-view', 'vrchatapi-view', 'osc-leash-view', 'auto-inviter-view', 'logs-view', 'settings-view'].map(id => document.getElementById(id));
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
    const views = ['main-view', 'osc-view', 'vosk-view', 'Hyperate-view', 'arcfeedback-view', 'chatbox-view', 'vrchatapi-view', 'osc-leash-view', 'auto-inviter-view', 'logs-view', 'settings-view'].map(id => document.getElementById(id));
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
    const views = ['main-view', 'osc-view', 'vosk-view', 'Hyperate-view', 'arcfeedback-view', 'chatbox-view', 'vrchatapi-view', 'osc-leash-view', 'auto-inviter-view', 'logs-view', 'settings-view'].map(id => document.getElementById(id));
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
    const views = ['main-view', 'osc-view', 'vosk-view', 'Hyperate-view', 'arcfeedback-view', 'chatbox-view', 'vrchatapi-view', 'osc-leash-view', 'auto-inviter-view', 'logs-view', 'settings-view'].map(id => document.getElementById(id));
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
    const views = ['main-view', 'osc-view', 'vosk-view', 'Hyperate-view', 'arcfeedback-view', 'chatbox-view', 'vrchatapi-view', 'osc-leash-view', 'auto-inviter-view', 'logs-view', 'settings-view'].map(id => document.getElementById(id));
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

function showAutoInviterView() {
    const views = ['main-view', 'osc-view', 'vosk-view', 'Hyperate-view', 'arcfeedback-view', 'chatbox-view', 'vrchatapi-view', 'osc-leash-view', 'auto-inviter-view', 'logs-view', 'settings-view'].map(id => document.getElementById(id));
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
        // Set OSC received display state
        oscReceivedDisplayEnabled = settings.oscReceivedDisplayEnabled !== false; // Default to true for backward compatibility
        updateOscReceivedDisplayStatus();
        // Apply theme from settings
        currentTheme = settings.theme || 'light';
        applyTheme(currentTheme);
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
    window.electronAPI.removeAllListeners('osc-received');
    window.electronAPI.removeAllListeners('osc-server-status');
    window.electronAPI.removeAllListeners('websocket-status');
    window.electronAPI.removeAllListeners('websocket-error');
    window.electronAPI.removeAllListeners('websocket-authenticated');
    window.electronAPI.removeAllListeners('websocket-osc-data');
    window.electronAPI.removeAllListeners('websocket-avatar-change');
    window.electronAPI.removeAllListeners('websocket-parameter-update');
    window.electronAPI.removeAllListeners('websocket-server-message');
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
    const headerColor = isDarkTheme ? '#b0b0b0' : '#666';
    // Check if list is currently expanded (not collapsed) before re-rendering
    const itemsContainer = document.getElementById('unsubscription-items-container');
    const wasExpanded = itemsContainer && itemsContainer.style.display !== 'none';

    if (unsubscriptions.length === 0) {
        container.innerHTML = `
            <p style="color: ${emptyTextColor}; font-size: 0.9em; font-style: italic; text-align: center; padding: 10px;">
                No paths are being ignored. All OSC data is being received.
            </p>
        `;
        return;
    }

    const unsubsHtml = unsubscriptions.map(path => `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; 
                    background-color: ${itemBgColor}; border-radius: 4px; margin-bottom: 5px; border-left: 3px solid #dc3545;">
            <span style="font-family: monospace; color: ${pathColor};">${path}</span>
            <button class="btn btn-success" onclick="removeOscQueryUnsubscription('${path}')" 
                    style="padding: 2px 8px; font-size: 12px;">Remove (Listen Again)</button>
        </div>
    `).join('');

    container.innerHTML = `
        <div style="margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center;">
            <span style="color: ${headerColor}; font-size: 0.85em;">
                <strong>Ignoring ${unsubscriptions.length} path(s):</strong>
            </span>
            <button class="btn btn-secondary" onclick="toggleUnsubscriptionList()" 
                    style="padding: 2px 8px; font-size: 11px;" id="toggle-unsub-list-btn">
                <span id="toggle-unsub-arrow">▶</span> Expand
            </button>
        </div>
        <div id="unsubscription-items-container" style="display: none;">
            ${unsubsHtml}
        </div>
    `;
    
    // Restore expanded state only if it was expanded before
    if (wasExpanded) {
        const newItemsContainer = document.getElementById('unsubscription-items-container');
        const newToggleBtn = document.getElementById('toggle-unsub-list-btn');
        const newArrow = document.getElementById('toggle-unsub-arrow');
        
        if (newItemsContainer && newToggleBtn && newArrow) {
            newItemsContainer.style.display = 'block';
            newArrow.textContent = '▼';
            newToggleBtn.innerHTML = '<span id="toggle-unsub-arrow">▼</span> Collapse';
        }
    }
}

function toggleUnsubscriptionList() {
    const itemsContainer = document.getElementById('unsubscription-items-container');
    const toggleBtn = document.getElementById('toggle-unsub-list-btn');
    const arrow = document.getElementById('toggle-unsub-arrow');
    
    if (!itemsContainer || !toggleBtn || !arrow) return;
    
    if (itemsContainer.style.display === 'none') {
        itemsContainer.style.display = 'block';
        arrow.textContent = '▼';
        toggleBtn.innerHTML = '<span id="toggle-unsub-arrow">▼</span> Collapse';
    } else {
        itemsContainer.style.display = 'none';
        arrow.textContent = '▶';
        toggleBtn.innerHTML = '<span id="toggle-unsub-arrow">▶</span> Expand';
    }
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

// OSC Parameter Frequency Tracking for Suggestions
function trackOscParameter(address) {
    // Ignore self-sent parameters (ARCOSC client parameters)
    if (address.startsWith('/avatar/parameters/ARCOSC/')) {
        return; // Don't track our own parameters
    }
    
    const now = Date.now();
    
    // Update frequency count
    const currentCount = oscParameterFrequency.get(address) || 0;
    oscParameterFrequency.set(address, currentCount + 1);
    oscParameterLastUpdate.set(address, now);
    
    // Clean up old entries (outside tracking window)
    for (const [addr, lastUpdate] of oscParameterLastUpdate.entries()) {
        if (now - lastUpdate > FREQUENCY_TRACKING_WINDOW * 2) {
            oscParameterFrequency.delete(addr);
            oscParameterLastUpdate.delete(addr);
        }
    }
}

function getHighFrequencyParameters() {
    const now = Date.now();
    const highFreq = [];
    
    for (const [address, count] of oscParameterFrequency.entries()) {
        const lastUpdate = oscParameterLastUpdate.get(address) || 0;
        
        // Only consider parameters updated recently
        if (now - lastUpdate < FREQUENCY_TRACKING_WINDOW) {
            // Calculate messages per second
            const messagesPerSecond = count / (FREQUENCY_TRACKING_WINDOW / 1000);
            
            if (count >= HIGH_FREQUENCY_THRESHOLD) {
                highFreq.push({
                    address,
                    count,
                    messagesPerSecond: messagesPerSecond.toFixed(1)
                });
            }
        }
    }
    
    // Sort by count (highest first)
    highFreq.sort((a, b) => b.count - a.count);
    
    // Return ALL high-frequency parameters (no limit here)
    // The limit of 10 is applied only to individual display, not pattern detection
    return highFreq;
}

/**
 * Analyze current OSC traffic patterns and determine traffic status
 * Returns analysis including total msg/sec, parameter type breakdown, and status
 */
function analyzeTrafficStatus() {
    const now = Date.now();
    let totalMessagesPerSecond = 0;
    let floatCount = 0;
    let boolCount = 0;
    let intCount = 0;
    let otherCount = 0;
    
    // Calculate total traffic and categorize by likely parameter type
    for (const [address, count] of oscParameterFrequency.entries()) {
        const lastUpdate = oscParameterLastUpdate.get(address) || 0;
        
        // Only consider parameters updated recently
        if (now - lastUpdate < FREQUENCY_TRACKING_WINDOW) {
            const messagesPerSecond = count / (FREQUENCY_TRACKING_WINDOW / 1000);
            totalMessagesPerSecond += messagesPerSecond;
            
            // Categorize by parameter name patterns
            // Floats are typically high-spam but user-induced (tracking, positions, etc.)
            if (address.includes('Float') || address.includes('X') || address.includes('Y') || 
                address.includes('Z') || address.includes('Velocity') || address.includes('Angular') ||
                address.includes('Position') || address.includes('/FT/')) {
                floatCount += messagesPerSecond;
            } else if (address.includes('Bool')) {
                boolCount += messagesPerSecond;
            } else if (address.includes('Int')) {
                intCount += messagesPerSecond;
            } else {
                otherCount += messagesPerSecond;
            }
        }
    }
    
    // Determine status based on total traffic
    let status = 'normal';
    if (totalMessagesPerSecond >= TRAFFIC_HEAVY_THRESHOLD) {
        status = 'excessive';
    } else if (totalMessagesPerSecond >= TRAFFIC_NORMAL_THRESHOLD) {
        status = 'heavy';
    }
    
    const analysis = {
        totalMessagesPerSecond: Math.round(totalMessagesPerSecond),
        floatMessagesPerSecond: Math.round(floatCount),
        boolMessagesPerSecond: Math.round(boolCount),
        intMessagesPerSecond: Math.round(intCount),
        otherMessagesPerSecond: Math.round(otherCount),
        status: status,
        timestamp: now
    };
    
    lastTrafficAnalysis = analysis;
    currentTrafficStatus = status;
    
    return analysis;
}

/**
 * Detect common patterns in parameter addresses and suggest wildcard patterns
 * For example: /avatar/parameters/VF56_SyncDataBool3, VF56_SyncDataBool7 
 * => suggests /avatar/parameters/VF56_Sync*
 * 
 * Also detects subdirectory patterns:
 * /avatar/parameters/FT/v2/EyeY, /avatar/parameters/FT/v2/EyeLeftX
 * => suggests /avatar/parameters/FT/v2/*
 */
function detectParameterPatterns(parameters) {
    const patterns = new Map(); // pattern -> { addresses: [], count: 0, messagesPerSecond: 0 }
    
    for (const param of parameters) {
        const address = param.address;
        const parts = address.split('/').filter(p => p); // Remove empty strings
        
        if (parts.length < 3) continue; // Need at least avatar/parameters/something
        
        // Strategy 1: Subdirectory Pattern Detection
        // If path has subdirectories (more than 3 parts), suggest the parent directory
        // Example: /avatar/parameters/FT/v2/EyeY -> /avatar/parameters/FT/v2/*
        if (parts.length >= 4) {
            // Try different levels of subdirectory grouping
            for (let depth = 3; depth < parts.length; depth++) {
                const directoryPath = '/' + parts.slice(0, depth).join('/') + '/*';
                
                // Blacklist: Never suggest ignoring these critical directories
                const isTogglesDirectory = directoryPath.includes('/toggles/') || directoryPath.match(/\/avatar\/parameters\/toggles[\/\*]/);
                if (isTogglesDirectory) {
                    continue; // Skip this pattern entirely
                }
                
                // Special case: Face tracking directories should always be marked as safe to ignore
                const isFaceTracking = directoryPath.includes('/FT/') || directoryPath.match(/\/avatar\/parameters\/FT[\/\*]/);
                
                if (!patterns.has(directoryPath)) {
                    patterns.set(directoryPath, {
                        addresses: [],
                        count: 0,
                        messagesPerSecond: 0,
                        type: 'subdirectory',
                        riskLevel: isFaceTracking ? 'safe' : 'safe',
                        description: isFaceTracking 
                            ? 'Face tracking data directory. This high-frequency data is NOT needed by most servers and should be ignored to reduce bandwidth.'
                            : 'Subdirectory grouping pattern. Usually organizational and safe to ignore if all parameters in this directory are similar.'
                    });
                }
                
                const pattern = patterns.get(directoryPath);
                if (!pattern.addresses.includes(address)) {
                    pattern.addresses.push(address);
                    pattern.count += param.count;
                    pattern.messagesPerSecond = parseFloat(pattern.messagesPerSecond) + parseFloat(param.messagesPerSecond);
                }
            }
        }
        
        const paramName = parts[parts.length - 1]; // Last part (the actual parameter name)
        const basePath = '/' + parts.slice(0, -1).join('/'); // Everything before the parameter name
        
        // Strategy 2: Find common prefix in parameter names (at least 3 chars) ending before a number or common suffix
        const prefixMatch = paramName.match(/^([A-Za-z_]{3,}[A-Za-z0-9_]*?)(?:\d+|Bool|Float|Int|X|Y|Z|Left|Right|Upper|Lower|[0-9]+)$/);
        if (prefixMatch) {
            const prefix = prefixMatch[1];
            // Only suggest if prefix is meaningful (at least 3 chars)
            if (prefix.length >= 3) {
                const patternKey = `${basePath}/${prefix}*`;
                
                if (!patterns.has(patternKey)) {
                    patterns.set(patternKey, {
                        addresses: [],
                        count: 0,
                        messagesPerSecond: 0,
                        type: 'prefix',
                        riskLevel: 'caution',
                        description: 'Prefix-based parameter grouping. Review individual parameters to ensure no critical toggles or functions are included.'
                    });
                }
                
                const pattern = patterns.get(patternKey);
                if (!pattern.addresses.includes(address)) {
                    pattern.addresses.push(address);
                    pattern.count += param.count;
                    pattern.messagesPerSecond = parseFloat(pattern.messagesPerSecond) + parseFloat(param.messagesPerSecond);
                }
            }
        }
        
        // Strategy 3: Common VRChat patterns like Viseme, Voice, Velocity, Angular, etc.
        const commonPatterns = [
            { prefix: 'Viseme', minLength: 6, riskLevel: 'safe', description: 'Voice viseme data used for lipsync animation. Safe to ignore if not using voice features.' },
            { prefix: 'Voice', minLength: 5, riskLevel: 'safe', description: 'Voice activity parameters. Safe to ignore if not using voice features.' },
            { prefix: 'Velocity', minLength: 8, riskLevel: 'safe', description: 'Movement velocity tracking. Usually safe to ignore.' },
            { prefix: 'Angular', minLength: 7, riskLevel: 'safe', description: 'Angular velocity tracking. Usually safe to ignore.' },
            { prefix: 'FT', minLength: 2, riskLevel: 'safe', description: 'Face tracking data, typically high-frequency. Safe to ignore if not using face tracking features.' },
            { prefix: 'VF', minLength: 2, riskLevel: 'caution', description: 'VRCFury parameters: MIXED - some are compression helpers (VF56_SyncDataBool*) safe to ignore, others are CRITICAL toggles/functions that MUST be forwarded. Always expand and review the full list before ignoring. Look for obvious names indicating functionality.' },
            { prefix: 'Sync', minLength: 4, riskLevel: 'caution', description: 'Sync parameters, often used for network synchronization. Review individual parameters to ensure no critical toggles are included.' },
            { prefix: 'Eye', minLength: 3, riskLevel: 'safe', description: 'Eye tracking or animation parameters. Usually safe to ignore if not using eye tracking.' },
            { prefix: 'Mouth', minLength: 5, riskLevel: 'safe', description: 'Mouth animation parameters. Usually safe to ignore.' },
            { prefix: 'Brow', minLength: 4, riskLevel: 'safe', description: 'Eyebrow animation parameters. Usually safe to ignore.' },
            { prefix: 'Jaw', minLength: 3, riskLevel: 'safe', description: 'Jaw animation parameters. Usually safe to ignore.' }
        ];
        
        for (const { prefix, minLength, riskLevel, description } of commonPatterns) {
            if (paramName.startsWith(prefix) && paramName.length >= minLength) {
                const patternKey = `${basePath}/${prefix}*`;
                
                if (!patterns.has(patternKey)) {
                    patterns.set(patternKey, {
                        addresses: [],
                        count: 0,
                        messagesPerSecond: 0,
                        type: 'common',
                        riskLevel: riskLevel,
                        description: description
                    });
                }
                
                const pattern = patterns.get(patternKey);
                if (!pattern.addresses.includes(address)) {
                    pattern.addresses.push(address);
                    pattern.count += param.count;
                    pattern.messagesPerSecond = parseFloat(pattern.messagesPerSecond) + parseFloat(param.messagesPerSecond);
                }
            }
        }
    }
    
    // Filter and prioritize patterns
    const significantPatterns = [];
    for (const [patternStr, data] of patterns.entries()) {
        // Only include patterns that match multiple addresses (at least 2)
        if (data.addresses.length >= 2) {
            // Calculate efficiency: how many addresses vs pattern specificity
            const efficiency = data.addresses.length;
            
            significantPatterns.push({
                pattern: patternStr,
                matchCount: data.addresses.length,
                addresses: data.addresses,
                count: data.count,
                messagesPerSecond: data.messagesPerSecond.toFixed(1),
                type: data.type,
                riskLevel: data.riskLevel || 'caution',
                description: data.description || 'No description available.',
                efficiency
            });
        }
    }
    
    // Sort by efficiency and message count
    // Prioritize: subdirectory patterns > high message count > match count
    significantPatterns.sort((a, b) => {
        // Subdirectory patterns first (they're usually more comprehensive)
        if (a.type === 'subdirectory' && b.type !== 'subdirectory') return -1;
        if (b.type === 'subdirectory' && a.type !== 'subdirectory') return 1;
        
        // Then by total message count
        if (b.count !== a.count) return b.count - a.count;
        
        // Then by number of matches
        return b.matchCount - a.matchCount;
    });
    
    // Remove redundant patterns (if a subdirectory pattern covers everything a prefix pattern does)
    const filteredPatterns = [];
    const coveredAddresses = new Set();
    
    for (const pattern of significantPatterns) {
        // Check if this pattern's addresses are already fully covered by a previous pattern
        const newAddresses = pattern.addresses.filter(addr => !coveredAddresses.has(addr));
        
        if (newAddresses.length >= 2) {
            // This pattern still covers useful addresses
            filteredPatterns.push(pattern);
            pattern.addresses.forEach(addr => coveredAddresses.add(addr));
        }
    }
    
    return filteredPatterns.slice(0, 10); // Top 10 most useful patterns
}

function renderHighFrequencySuggestions() {
    const container = document.getElementById('oscquery-suggestions');
    if (!container) return;
    
    const highFreq = getHighFrequencyParameters();
    
    // Use cached patterns if available, otherwise detect new patterns
    const patterns = cachedPatterns || detectParameterPatterns(highFreq);
    const isDarkTheme = document.body.classList.contains('dark-theme');
    
    // Theme-aware colors
    const itemBgColor = isDarkTheme ? '#2c2c2c' : '#fff';
    const patternBgColor = isDarkTheme ? '#1a4d2e' : '#d4edda';
    const addressColor = isDarkTheme ? '#e0e0e0' : '#212529';
    const statsColor = isDarkTheme ? '#a0a0a0' : '#6c757d';
    const headerColor = isDarkTheme ? '#d4a017' : '#856404';
    const patternTextColor = isDarkTheme ? '#90ee90' : '#155724';
    
    if (highFreq.length === 0) {
        const emptyTextColor = isDarkTheme ? '#a0a0a0' : '#666';
        container.innerHTML = `
            <p style="color: ${emptyTextColor}; font-size: 0.9em; font-style: italic;">
                No high-frequency parameters detected yet. Enable OSC and wait for data...
            </p>
        `;
        return;
    }
    
    // Helper function to check if an address matches any pattern
    const matchesAnyPattern = (address, patternList) => {
        for (const pattern of patternList) {
            const patternStr = pattern.pattern;
            // Convert wildcard pattern to regex
            if (patternStr.includes('*')) {
                const regexPattern = patternStr
                    .replace(/\//g, '\\/')  // Escape slashes
                    .replace(/\*/g, '.*');  // Convert * to .*
                const regex = new RegExp(`^${regexPattern}$`);
                if (regex.test(address)) {
                    return true;
                }
            } else if (address === patternStr) {
                return true;
            }
        }
        return false;
    };
    
    // Filter out parameters that match any smart pattern, EXCEPT VF* patterns (allow them in individual list for granular control)
    const patternsToFilterBy = patterns.filter(p => !p.pattern.includes('/VF*'));
    const uncoveredParams = highFreq.filter(param => !matchesAnyPattern(param.address, patternsToFilterBy));
    
    // If we filtered out too many, get more from the frequency map to fill the top 10
    const now = Date.now();
    if (uncoveredParams.length < 10) {
        const additionalParams = [];
        for (const [address, count] of oscParameterFrequency.entries()) {
            const lastUpdate = oscParameterLastUpdate.get(address) || 0;
            
            // Only consider parameters updated recently
            if (now - lastUpdate < FREQUENCY_TRACKING_WINDOW) {
                // Skip if already in uncoveredParams or matches any pattern (except VF*)
                if (!matchesAnyPattern(address, patternsToFilterBy) && !uncoveredParams.find(p => p.address === address)) {
                    const messagesPerSecond = count / (FREQUENCY_TRACKING_WINDOW / 1000);
                    if (count >= HIGH_FREQUENCY_THRESHOLD * 0.5) { // Lower threshold for additional params
                        additionalParams.push({
                            address,
                            count,
                            messagesPerSecond: messagesPerSecond.toFixed(1)
                        });
                    }
                }
            }
        }
        
        // Sort additional params by count
        additionalParams.sort((a, b) => b.count - a.count);
        
        // Add them to uncoveredParams until we have 10
        uncoveredParams.push(...additionalParams.slice(0, 10 - uncoveredParams.length));
    }
    
    // Render smart pattern suggestions first (if any)
    let patternSuggestionsHtml = '';
    if (patterns.length > 0) {
        const patternItems = patterns.slice(0, 5).map(p => {
            // Determine badge and styling based on risk level
            let riskBadge = '';
            let riskBadgeStyle = '';
            let borderColor = '#28a745'; // Default green
            
            if (p.riskLevel === 'safe') {
                riskBadge = '[SAFE]';
                riskBadgeStyle = 'background-color: #28a745; color: white; padding: 2px 6px; border-radius: 3px; font-size: 0.75em; font-weight: bold; margin-right: 6px;';
                borderColor = '#28a745';
            } else if (p.riskLevel === 'caution') {
                riskBadge = '[CAUTION]';
                riskBadgeStyle = 'background-color: #ffc107; color: #000; padding: 2px 6px; border-radius: 3px; font-size: 0.75em; font-weight: bold; margin-right: 6px;';
                borderColor = '#ffc107';
            } else if (p.riskLevel === 'critical') {
                riskBadge = '[CRITICAL]';
                riskBadgeStyle = 'background-color: #dc3545; color: white; padding: 2px 6px; border-radius: 3px; font-size: 0.75em; font-weight: bold; margin-right: 6px;';
                borderColor = '#dc3545';
            }
            
            // Determine type label based on pattern type
            let typeLabel = '';
            if (p.type === 'subdirectory') {
                typeLabel = '<span style="font-size: 0.7em; color: #17a2b8; font-weight: normal;"> (Subdirectory)</span>';
            } else if (p.type === 'prefix') {
                typeLabel = '<span style="font-size: 0.7em; color: #6c757d; font-weight: normal;"> (Prefix Pattern)</span>';
            } else if (p.type === 'common') {
                typeLabel = '<span style="font-size: 0.7em; color: #ffc107; font-weight: normal;"> (Common VRChat)</span>';
            }
            
            // For VF* patterns, ignore individually instead of as wildcard
            const isVFPattern = p.pattern.includes('/VF*');
            const addressesJson = JSON.stringify(p.addresses).replace(/"/g, '&quot;');
            const onclickHandler = isVFPattern 
                ? `ignorePatternIndividually(${addressesJson})`
                : `quickIgnoreParameter('${p.pattern.replace(/'/g, "\\'")}')`;
            const buttonText = isVFPattern ? 'Ignore All Matched' : 'Ignore Pattern';
            
            return `
            <div style="background-color: ${patternBgColor}; border-radius: 4px; padding: 10px; margin-bottom: 8px; border: 2px solid ${borderColor};" 
                 title="${p.description}">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px;">
                    <div style="flex: 1;">
                        <div style="font-family: monospace; color: ${patternTextColor}; font-weight: bold; margin-bottom: 4px;">
                            <span style="${riskBadgeStyle}" title="${p.description}">${riskBadge}</span>${p.pattern}${typeLabel}
                        </div>
                        <div style="font-size: 0.75em; color: ${statsColor};">
                            Matches ${p.matchCount} parameter(s) • ${p.count} total messages (~${p.messagesPerSecond} msg/sec)
                        </div>
                        <div style="font-size: 0.78em; color: ${statsColor}; margin-top: 4px; font-style: italic;">
                            ${p.description}
                        </div>
                    </div>
                    <button class="btn btn-success" onclick="${onclickHandler}" 
                            style="padding: 4px 12px; font-size: 12px; white-space: nowrap; margin-left: 10px;">
                        ${buttonText}
                    </button>
                </div>
                <details style="margin-top: 6px;">
                    <summary style="cursor: pointer; font-size: 0.8em; color: ${statsColor}; user-select: none;">
                        Show matched parameters (${p.matchCount})
                    </summary>
                    <div style="margin-top: 6px; padding-left: 10px; font-size: 0.75em; font-family: monospace; color: ${addressColor};">
                        ${p.addresses.map(addr => `• ${addr}`).join('<br>')}
                    </div>
                </details>
            </div>
        `;
        }).join('');
        
        patternSuggestionsHtml = `
            <div style="margin-bottom: 15px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                    <div style="color: #28a745; font-size: 0.9em; font-weight: bold;">
                        Smart Pattern Suggestions (Ignore Multiple at Once):
                    </div>
                    <button class="btn btn-secondary" onclick="manualReanalyze()" 
                            style="padding: 4px 12px; font-size: 11px; white-space: nowrap;">
                        Re-analyze Now
                    </button>
                </div>
                <div style="background-color: ${isDarkTheme ? '#1a1a1a' : '#f8f9fa'}; border-radius: 4px; padding: 8px 12px; margin-bottom: 12px; border: 1px solid ${isDarkTheme ? '#444' : '#dee2e6'};">
                    <div style="font-size: 0.8em; color: ${statsColor}; font-weight: bold; margin-bottom: 4px;">Risk Level Legend:</div>
                    <div style="font-size: 0.75em; color: ${statsColor}; line-height: 1.6;">
                        <span style="background-color: #28a745; color: white; padding: 1px 4px; border-radius: 2px; font-weight: bold; margin-right: 4px;">[SAFE]</span> 
                        Safe to ignore - typically high-frequency data not needed by servers<br>
                        <span style="background-color: #ffc107; color: #000; padding: 1px 4px; border-radius: 2px; font-weight: bold; margin-right: 4px;">[CAUTION]</span> 
                        Review carefully - may contain critical toggles or functions<br>
                        <span style="background-color: #dc3545; color: white; padding: 1px 4px; border-radius: 2px; font-weight: bold; margin-right: 4px;">[CRITICAL]</span> 
                        Do not ignore - contains essential parameters
                    </div>
                </div>
                ${patternItems}
            </div>
        `;
    }
    
    // Render individual high-frequency parameters (excluding those covered by patterns)
    let individualSuggestionsHtml = '';
    if (uncoveredParams.length > 0) {
        // Limit individual display to top 10 (pattern detection uses all params)
        const visibleParams = uncoveredParams.slice(0, 10);
        const individualItems = visibleParams.map(param => `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; 
                        background-color: ${itemBgColor}; border-radius: 4px; margin-bottom: 5px; border: 1px solid #ffc107;">
                <div style="flex: 1;">
                    <div style="font-family: monospace; color: ${addressColor}; margin-bottom: 2px;">${param.address}</div>
                    <div style="font-size: 0.75em; color: ${statsColor};">
                        ${param.count} messages (~${param.messagesPerSecond} msg/sec)
                    </div>
                </div>
                <button class="btn btn-warning" onclick="quickIgnoreParameter('${param.address.replace(/'/g, "\\'")}')" 
                        style="padding: 4px 12px; font-size: 12px; white-space: nowrap;">
                    Ignore This
                </button>
            </div>
        `).join('');
        
        // Create array of visible parameter addresses for "Ignore All" functionality
        const visibleAddresses = visibleParams.map(p => p.address);
        const addressesJson = JSON.stringify(visibleAddresses).replace(/"/g, '&quot;');
        
        individualSuggestionsHtml = `
            <div style="margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center;">
                <span style="color: ${headerColor}; font-size: 0.85em;">
                    <strong>Individual High-Frequency Parameters (Top 10):</strong>
                </span>
                <button class="btn btn-danger" onclick='ignoreAllVisibleParameters(${addressesJson})' 
                        style="padding: 4px 12px; font-size: 12px; white-space: nowrap;">
                    Ignore All (${visibleParams.length})
                </button>
            </div>
            ${individualItems}
        `;
    }
    
    container.innerHTML = `
        ${patternSuggestionsHtml}
        ${individualSuggestionsHtml}
    `;
}

async function quickIgnoreParameter(address) {
    try {
        const result = await window.electronAPI.addOscQueryUnsubscription(address);
        if (result && result.success) {
            debugLog(`Added ${address} to ignore list`, 'info');
            renderOscQueryUnsubscriptions(result.unsubscriptions || []);
            
            // If this is a wildcard pattern, remove all matching addresses from frequency tracking
            if (address.includes('*')) {
                // Convert wildcard pattern to regex
                const regexPattern = address
                    .replace(/\//g, '\\/')  // Escape slashes
                    .replace(/\*/g, '.*');  // Convert * to .*
                const regex = new RegExp(`^${regexPattern}$`);
                
                // Remove all matching addresses
                const addressesToRemove = [];
                for (const [trackedAddress] of oscParameterFrequency.entries()) {
                    if (regex.test(trackedAddress)) {
                        addressesToRemove.push(trackedAddress);
                    }
                }
                
                addressesToRemove.forEach(addr => {
                    oscParameterFrequency.delete(addr);
                    oscParameterLastUpdate.delete(addr);
                });
                
                debugLog(`Removed ${addressesToRemove.length} parameter(s) matching pattern ${address}`, 'info');
            } else {
                // Remove exact address from frequency tracking
                oscParameterFrequency.delete(address);
                oscParameterLastUpdate.delete(address);
            }
            
            // Update suggestions immediately
            renderHighFrequencySuggestions();
        }
    } catch (error) {
        debugLog(`Error ignoring parameter: ${error.message}`, 'error');
    }
}

async function ignoreAllVisibleParameters(addresses) {
    try {
        debugLog(`Ignoring ${addresses.length} visible parameters`, 'info');
        
        // Add each address to the ignore list
        for (const address of addresses) {
            await window.electronAPI.addOscQueryUnsubscription(address);
        }
        
        // Remove from frequency tracking
        for (const address of addresses) {
            oscParameterFrequency.delete(address);
            oscParameterLastUpdate.delete(address);
        }
        
        // Reload the unsubscriptions list
        await loadOscQueryUnsubscriptions();
        
        // Update suggestions immediately
        renderHighFrequencySuggestions();
        
        debugLog(`Successfully ignored all ${addresses.length} parameters`, 'info');
    } catch (error) {
        debugLog(`Error ignoring all parameters: ${error.message}`, 'error');
    }
}

async function ignorePatternIndividually(addresses) {
    try {
        debugLog(`Ignoring pattern by adding ${addresses.length} individual parameters`, 'info');
        
        // Add each address to the ignore list individually
        for (const address of addresses) {
            await window.electronAPI.addOscQueryUnsubscription(address);
        }
        
        // Remove from frequency tracking
        for (const address of addresses) {
            oscParameterFrequency.delete(address);
            oscParameterLastUpdate.delete(address);
        }
        
        // Reload the unsubscriptions list
        await loadOscQueryUnsubscriptions();
        
        // Update suggestions immediately
        renderHighFrequencySuggestions();
        
        debugLog(`Successfully ignored pattern (${addresses.length} individual parameters added)`, 'info');
    } catch (error) {
        debugLog(`Error ignoring pattern individually: ${error.message}`, 'error');
    }
}

function manualReanalyze() {
    debugLog('Manual re-analysis triggered by user', 'info');
    
    // Clear cache to force re-detection
    cachedPatterns = null;
    cachedPatternFingerprint = null;
    
    // Get fresh data and re-detect patterns
    const highFreq = getHighFrequencyParameters();
    cachedPatterns = detectParameterPatterns(highFreq);
    
    // Update fingerprint
    const addresses = Array.from(oscParameterFrequency.keys()).sort();
    cachedPatternFingerprint = addresses.join('|');
    
    // Re-analyze traffic
    const trafficAnalysis = analyzeTrafficStatus();
    updateTrafficStatusUI(trafficAnalysis);
    
    // Re-render suggestions
    renderHighFrequencySuggestions();
    
    debugLog('Re-analysis complete', 'info');
}

function updateTrafficStatusUI(analysis) {
    // Update or create traffic status indicator
    const statusContainer = document.getElementById('osc-traffic-status');
    if (!statusContainer) return;
    
    let statusText = 'Unknown';
    let statusColor = '#6c757d';
    let tooltipText = 'No traffic data available';
    
    if (analysis) {
        const { totalMessagesPerSecond, floatMessagesPerSecond, status } = analysis;
        
        switch (status) {
            case 'normal':
                statusText = 'Normal';
                statusColor = '#28a745';
                tooltipText = `${totalMessagesPerSecond} msg/sec - Traffic is within normal range`;
                break;
            case 'heavy':
                statusText = 'Heavy Traffic';
                statusColor = '#ffc107';
                tooltipText = `${totalMessagesPerSecond} msg/sec - YOU are sending high traffic. Consider ignoring high-frequency parameters. Float params: ${floatMessagesPerSecond} msg/sec (user-induced, typically safe)`;
                break;
            case 'excessive':
                statusText = 'Excessive';
                statusColor = '#dc3545';
                tooltipText = `${totalMessagesPerSecond} msg/sec - EXCESSIVE traffic! You are over-sending. Review and ignore unnecessary parameters immediately. Float params: ${floatMessagesPerSecond} msg/sec`;
                break;
        }
    }
    
    statusContainer.innerHTML = `
        <span style="color: ${statusColor}; font-weight: bold;" title="${tooltipText}">
            ${statusText}
        </span>
    `;
}

function setupSuggestionUpdater() {
    // Clear any existing timer
    if (suggestionUpdateTimer) {
        clearInterval(suggestionUpdateTimer);
    }
    
    // Start learning phase
    learningPhaseStartTime = Date.now();
    isInLearningPhase = true;
    cachedPatterns = null;
    cachedPatternFingerprint = null;
    currentTrafficStatus = 'unknown';
    
    debugLog('Started learning phase for OSC traffic analysis (2 minutes)', 'info');
    
    // Create fingerprint of current high-frequency parameters for change detection
    const createFingerprint = () => {
        const addresses = Array.from(oscParameterFrequency.keys()).sort();
        return addresses.join('|');
    };
    
    // Adaptive update function with caching
    const adaptiveUpdate = () => {
        const now = Date.now();
        
        // Check if learning phase is complete
        if (isInLearningPhase && (now - learningPhaseStartTime) >= LEARNING_PHASE_DURATION) {
            isInLearningPhase = false;
            debugLog('Learning phase complete - switching to 30s update interval', 'info');
            
            // Restart timer with normal interval
            clearInterval(suggestionUpdateTimer);
            suggestionUpdateTimer = setInterval(adaptiveUpdate, NORMAL_UPDATE_INTERVAL);
        }
        
        // Analyze traffic status
        const trafficAnalysis = analyzeTrafficStatus();
        updateTrafficStatusUI(trafficAnalysis);
        
        // Check if patterns need re-detection
        const currentFingerprint = createFingerprint();
        const needsRedetection = !cachedPatterns || 
                                  !cachedPatternFingerprint ||
                                  cachedPatternFingerprint !== currentFingerprint;
        
        if (needsRedetection) {
            // Significant change detected or no cache - do full update
            const highFreq = getHighFrequencyParameters();
            
            // Check if change is significant enough (10+ new parameters)
            if (cachedPatternFingerprint) {
                const oldAddresses = new Set(cachedPatternFingerprint.split('|'));
                const newAddresses = new Set(currentFingerprint.split('|'));
                const addedCount = [...newAddresses].filter(addr => !oldAddresses.has(addr)).length;
                
                if (addedCount < PATTERN_CACHE_INVALIDATION_THRESHOLD) {
                    // Not enough change, skip re-detection
                    return;
                }
                
                debugLog(`Detected ${addedCount} new parameters - re-analyzing patterns`, 'info');
            }
            
            // Detect and cache patterns
            cachedPatterns = detectParameterPatterns(highFreq);
            cachedPatternFingerprint = currentFingerprint;
            
            // Render with cached patterns
            renderHighFrequencySuggestions();
        }
        // If no significant change, skip rendering to save CPU
    };
    
    // Start with learning phase interval
    suggestionUpdateTimer = setInterval(adaptiveUpdate, LEARNING_UPDATE_INTERVAL);
    
    // Do immediate initial update
    adaptiveUpdate();
}

function stopSuggestionUpdater() {
    // Clear the timer
    if (suggestionUpdateTimer) {
        clearInterval(suggestionUpdateTimer);
        suggestionUpdateTimer = null;
    }
    
    // Clear learning phase state
    learningPhaseStartTime = null;
    isInLearningPhase = false;
    
    // Clear caches for GC
    cachedPatterns = null;
    cachedPatternFingerprint = null;
    lastTrafficAnalysis = null;
    currentTrafficStatus = 'unknown';
    
    // Clear frequency tracking data
    oscParameterFrequency.clear();
    oscParameterLastUpdate.clear();
    
    // Clear float throttling maps for GC
    lastFloatLogTimes.clear();
    lastFloatValues.clear();
    
    // Clear any pending float timeouts
    for (const timeout of pendingFloatTimeouts.values()) {
        clearTimeout(timeout);
    }
    pendingFloatTimeouts.clear();
    
    // Reset traffic status UI
    const statusContainer = document.getElementById('osc-traffic-status');
    if (statusContainer) {
        statusContainer.innerHTML = '<span style="color: #6c757d;">Unknown</span>';
    }
    
    debugLog('Stopped suggestion updater and cleared all tracking data', 'info');
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

function updateOscReceivedDisplayStatus() {
    const statusElement = document.getElementById('osc-received-display-status');
    const toggleBtn = document.getElementById('osc-received-display-toggle-btn');
    if (statusElement) {
        statusElement.textContent = oscReceivedDisplayEnabled ? 'Enabled' : 'Disabled';
        statusElement.className = oscReceivedDisplayEnabled ? 'status-value' : 'status-value disabled';
    }
    if (toggleBtn) {
        toggleBtn.textContent = oscReceivedDisplayEnabled ? 'Hide OSC Received' : 'Show OSC Received';
        toggleBtn.className = oscReceivedDisplayEnabled ? 'btn btn-warning' : 'btn btn-success';
    }
}
async function toggleOscReceivedDisplay() {
    try {
        oscReceivedDisplayEnabled = !oscReceivedDisplayEnabled;
        // Immediate and complete cleanup when disabling
        if (!oscReceivedDisplayEnabled) {
            // Remove all received messages from buffer
            oscLogBuffer = oscLogBuffer.filter(msg => msg.type !== 'received');
            clearFloatRateLimitingData();
            document.getElementById('osc-received-log-container').innerHTML = 'OSC Received Display Disabled<br>';
            // Force immediate garbage collection
            if (window.gc) window.gc();
        }
        // Save the state to backend settings
        const currentSettings = await window.electronAPI.getAppSettings();
        currentSettings.oscReceivedDisplayEnabled = oscReceivedDisplayEnabled;
        await window.electronAPI.setAppSettings(currentSettings);
        // Update the UI
        updateOscReceivedDisplayStatus();
        // Clear existing OSC received log buffer when disabling
        if (!oscReceivedDisplayEnabled) {
            debugLog(`OSC received display ${oscReceivedDisplayEnabled ? 'enabled' : 'disabled'} - processing load reduced`);
        } else {
            debugLog(`OSC received display ${oscReceivedDisplayEnabled ? 'enabled' : 'disabled'} - processing resumed`);
        }
    } catch (error) {
        debugLog(`Error toggling OSC received display: ${error.message}`, 'error');
    }
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
// Password saving functionality
async function handleSavePasswordCheckbox() {
    const checkbox = document.getElementById('save-password-checkbox');
    const modal = document.getElementById('password-warning-modal');
    
    if (checkbox.checked) {
        // Show warning modal
        modal.style.display = 'flex';
        setupPasswordWarningModal();
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

function setupPasswordWarningModal() {
    const modal = document.getElementById('password-warning-modal');
    const cancelBtn = document.getElementById('password-warning-cancel');
    const confirmBtn = document.getElementById('password-warning-confirm');
    const checkbox = document.getElementById('save-password-checkbox');
    
    cancelBtn.onclick = () => {
        checkbox.checked = false;
        modal.style.display = 'none';
        debugLog('Password save cancelled by user');
    };
    
    confirmBtn.onclick = async () => {
        modal.style.display = 'none';
        debugLog('User confirmed password save warning');
        // Save current password if there is one
        const password = document.getElementById('password').value;
        if (password) {
            try {
                await window.electronAPI.setSavedPassword(password);
                debugLog('Password saved to configuration (encrypted storage would be better, but user confirmed plain text)');
            } catch (error) {
                debugLog(`Error saving password: ${error.message}`, 'error');
            }
        }
    };
    
    // Close modal when clicking overlay
    modal.onclick = (e) => {
        if (e.target === modal) {
            checkbox.checked = false;
            modal.style.display = 'none';
            debugLog('Password save modal closed');
        }
    };
}

async function loadSavedPasswordSetting() {
    try {
        const result = await window.electronAPI.getSavedPassword();
        const checkbox = document.getElementById('save-password-checkbox');
        const passwordInput = document.getElementById('password');
        
        if (result && result.password) {
            checkbox.checked = true;
            passwordInput.value = result.password;
            debugLog('Saved password loaded from configuration');
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
// HypeRate Integration Functions
let hyperateStatus = {
    enabled: false,
    connected: false,
    stopping: false,
    hasApiKey: false
};
async function toggleHyperate() {
    try {
        const toggleBtn = document.getElementById('hyperate-toggle-btn');
        toggleBtn.disabled = true;
        if (hyperateStatus.enabled) {
            // Stop HypeRate - show stopping status immediately
            hyperateStatus.stopping = true;
            updateHyperateUI();
            const result = await window.electronAPI.hyperateStop();
            if (result.success) {
                debugLog('HypeRate stopped');
                hyperateStatus.stopping = false;
                updateHyperateUI();
            } else {
                debugLog(`Failed to stop HypeRate: ${result.error}`, 'error');
                // Reset stopping state on failure
                hyperateStatus.stopping = false;
                updateHyperateUI();
            }
        } else {
            // Start HypeRate - show connecting status immediately
            hyperateStatus.enabled = true;
            hyperateStatus.connected = false;
            updateHyperateUI();
            const result = await window.electronAPI.hyperateStart();
            if (result.success) {
                debugLog('HypeRate started');
                updateHyperateUI();
            } else {
                debugLog(`Failed to start HypeRate: ${result.error}`, 'error');
                alert(`Failed to start HypeRate: ${result.error}`);
                // Reset status on failure
                hyperateStatus.enabled = false;
                updateHyperateUI();
            }
        }
    } catch (error) {
        debugLog(`Error toggling HypeRate: ${error.message}`, 'error');
    } finally {
        const toggleBtn = document.getElementById('hyperate-toggle-btn');
        toggleBtn.disabled = false;
    }
}
// HypeRate auto-start functions
async function toggleHyperateAutostart() {
    try {
        const autostartBtn = document.getElementById('hyperate-autostart-btn');
        autostartBtn.disabled = true;
        // Get current autostart status
        const currentStatus = await window.electronAPI.hyperateGetAutostart();
        const newEnabled = !currentStatus.enabled;
        // Update autostart setting
        const result = await window.electronAPI.hyperateSetAutostart(newEnabled);
        if (result.success) {
            debugLog(`HypeRate autostart ${newEnabled ? 'enabled' : 'disabled'}`);
            updateHyperateAutostartUI(newEnabled);
        } else {
            debugLog(`Failed to update HypeRate autostart: ${result.error}`, 'error');
            alert(`Failed to update autostart setting: ${result.error}`);
        }
    } catch (error) {
        debugLog(`Error toggling HypeRate autostart: ${error.message}`, 'error');
    } finally {
        const autostartBtn = document.getElementById('hyperate-autostart-btn');
        autostartBtn.disabled = false;
    }
}
function updateHyperateAutostartUI(enabled) {
    const autostartBtn = document.getElementById('hyperate-autostart-btn');
    if (autostartBtn) {
        autostartBtn.textContent = `Auto-start: ${enabled ? 'Enabled' : 'Disabled'}`;
        autostartBtn.className = enabled ? 'btn btn-success' : 'btn btn-secondary';
    }
}
async function refreshHyperateStatus(includeAutostart = false) {
    try {
        const status = await window.electronAPI.hyperateGetStatus();
        hyperateStatus = { ...status, stopping: false }; // Ensure stopping is reset from server status
        updateHyperateUI();
        // Only refresh auto-start status when explicitly requested (not during periodic updates)
        if (includeAutostart) {
            const autostartStatus = await window.electronAPI.hyperateGetAutostart();
            updateHyperateAutostartUI(autostartStatus.enabled);
        }
        // Always refresh trackers list to show correct active/inactive states
        await refreshHyperateTrackers();
    } catch (error) {
        debugLog(`Error refreshing HypeRate status: ${error.message}`, 'error');
    }
}
async function addHyperateTracker() {
    try {
        const deviceIdInput = document.getElementById('device-id-input');
        const deviceNameInput = document.getElementById('device-name-input');
        const deviceId = deviceIdInput.value.trim();
        const deviceName = deviceNameInput ? deviceNameInput.value.trim() : null;
        if (!deviceId) {
            alert('Please enter a device ID');
            return;
        }
        const result = await window.electronAPI.hyperateAddTracker(deviceId, deviceName || null);
        if (result.success) {
            debugLog(`Added HypeRate tracker: ${deviceId}${deviceName ? ` (${deviceName})` : ''}`);
            deviceIdInput.value = '';
            if (deviceNameInput) deviceNameInput.value = '';
            await refreshHyperateTrackers();
        } else {
            debugLog(`Failed to add HypeRate tracker: ${result.error}`, 'error');
            alert(`Failed to add tracker: ${result.error}`);
        }
    } catch (error) {
        debugLog(`Error adding HypeRate tracker: ${error.message}`, 'error');
    }
}
async function removeHyperateTracker(deviceId) {
    try {
        const result = await window.electronAPI.hyperateRemoveTracker(deviceId);
        if (result.success) {
            debugLog(`Removed HypeRate tracker: ${deviceId}`);
            await refreshHyperateTrackers();
        } else {
            debugLog(`Failed to remove HypeRate tracker: ${result.error}`, 'error');
        }
    } catch (error) {
        debugLog(`Error removing HypeRate tracker: ${error.message}`, 'error');
    }
}
async function setPrimaryHyperateTracker(deviceId) {
    try {
        const result = await window.electronAPI.hyperateSetPrimary(deviceId);
        if (result.success) {
            debugLog(`Set primary HypeRate tracker: ${deviceId}`);
            await refreshHyperateTrackers();
        } else {
            debugLog(`Failed to set primary HypeRate tracker: ${result.error}`, 'error');
        }
    } catch (error) {
        debugLog(`Error setting primary HypeRate tracker: ${error.message}`, 'error');
    }
}
async function refreshHyperateTrackers() {
    try {
        const trackers = await window.electronAPI.hyperateGetTrackers();
        const trackersList = document.getElementById('hyperate-trackers-list');
        if (trackers.length === 0) {
            trackersList.innerHTML = '<p style="color: #666; text-align: center; padding: 10px;">No trackers added yet</p>';
            const primaryInfo = document.getElementById('primary-tracker-info');
            if (primaryInfo) {
                primaryInfo.textContent = 'No primary tracker set';
            }
            return;
        }
        let trackersHtml = '';
        let primaryTracker = null;
        trackers.forEach(tracker => {
            const lastUpdate = tracker.lastUpdate ? new Date(tracker.lastUpdate).toLocaleTimeString() : 'Never';
            const heartRate = tracker.lastHeartRate || '--';
            const isPrimary = tracker.isPrimary;
            const displayName = tracker.name || tracker.deviceId;
            const status = tracker.isActive ? 'Active' : 'Inactive';
            const statusColor = tracker.isActive ? '#2ecc71' : '#95a5a6';
            if (isPrimary) {
                primaryTracker = tracker;
                updateHeartRateDisplay(tracker.lastHeartRate);
            }
            const primaryBadge = isPrimary ? '<span style="background: #2ecc71; color: white; padding: 2px 6px; border-radius: 3px; font-size: 10px; margin-left: 5px;">PRIMARY</span>' : '';
            const primaryAction = isPrimary ? '' : `<button class="btn btn-secondary btn-small" onclick="setPrimaryHyperateTracker('${tracker.deviceId}')" style="margin-right: 5px;">Set Primary</button>`;
            trackersHtml += `
                <div class="tracker-item" style="border: 1px solid ${isPrimary ? '#2ecc71' : '#ddd'}; border-radius: 4px; padding: 10px; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center; background: ${isPrimary ? '#f8fff8' : 'white'};">
                    <div>
                        <strong>${displayName}</strong>${primaryBadge}<br>
                        <small style="color: #666;">ID: ${tracker.deviceId}</small><br>
                        <small>Status: <span style="color: ${statusColor};">${status}</span> | HR: ${heartRate} BPM | Last Update: ${lastUpdate}</small>
                    </div>
                    <div>
                        <button class="btn btn-secondary btn-small" onclick="editTrackerName('${tracker.deviceId}', '${tracker.name || ''}')" style="margin-right: 5px;">Edit</button>
                        ${primaryAction}
                        <button class="btn btn-danger btn-small" onclick="removeHyperateTracker('${tracker.deviceId}')">Remove</button>
                    </div>
                </div>
            `;
        });
        trackersList.innerHTML = trackersHtml;
        const primaryInfo = document.getElementById('primary-tracker-info');
        if (primaryInfo) {
            if (primaryTracker) {
                const displayName = primaryTracker.name || primaryTracker.deviceId;
                primaryInfo.textContent = `Primary: ${displayName}`;
            } else {
                primaryInfo.textContent = 'No primary tracker set';
            }
        }
    } catch (error) {
        debugLog(`Error refreshing HypeRate trackers: ${error.message}`, 'error');
    }
}
function updateHyperateUI() {
    const statusIndicator = document.getElementById('hyperate-status');
    const statusText = document.getElementById('hyperate-status-text');
    const toggleBtn = document.getElementById('hyperate-toggle-btn');
    if (!hyperateStatus.hasApiKey) {
        statusIndicator.className = 'status-indicator status-error';
        statusText.textContent = 'No API Key - Check secrets.json';
        toggleBtn.textContent = 'Missing API Key';
        toggleBtn.disabled = true;
        return;
    }
    if (hyperateStatus.enabled && hyperateStatus.connected) {
        statusIndicator.className = 'status-indicator status-connected';
        statusText.textContent = 'Connected and Active';
        toggleBtn.textContent = 'Stop HypeRate';
        toggleBtn.disabled = false;
    } else if (hyperateStatus.stopping) {
        statusIndicator.className = 'status-indicator status-stopping';
        statusText.textContent = 'Stopping...';
        toggleBtn.textContent = 'Stopping...';
        toggleBtn.disabled = true;
    } else if (hyperateStatus.enabled) {
        statusIndicator.className = 'status-indicator status-connecting';
        statusText.textContent = 'Connecting...';
        toggleBtn.textContent = 'Stop HypeRate';
        toggleBtn.disabled = false;
    } else {
        statusIndicator.className = 'status-indicator status-disconnected';
        statusText.textContent = 'Stopped';
        toggleBtn.textContent = 'Start HypeRate';
        toggleBtn.disabled = false;
    }
    // Update current heart rate from status
    if (hyperateStatus.enabled && hyperateStatus.lastHeartRate) {
        updateHeartRateDisplay(hyperateStatus.lastHeartRate);
    } else if (!hyperateStatus.enabled) {
        updateHeartRateDisplay(null);
    }
}
// Auto-refresh HypeRate status when viewing the HypeRate page
let hyperateStatusInterval = null;
function startHyperateStatusUpdates() {
    if (hyperateStatusInterval) {
        clearInterval(hyperateStatusInterval);
    }
    hyperateStatusInterval = setInterval(async () => {
        if (document.getElementById('Hyperate-view').style.display !== 'none') {
            await refreshHyperateStatus();
            // Periodic cleanup during HypeRate updates
            if (Math.random() < 0.1) { // 10% chance per update
                clearFloatRateLimitingData();
            }
        }
    }, 2000); // Update every 2 seconds
}
function stopHyperateStatusUpdates() {
    if (hyperateStatusInterval) {
        clearInterval(hyperateStatusInterval);
        hyperateStatusInterval = null;
    }
}
// Update heart rate display
function updateHeartRateDisplay(heartRate) {
    const heartRateElement = document.getElementById('current-heartrate');
    if (heartRateElement) {
        heartRateElement.textContent = heartRate || '--';
        // Add a pulse animation for valid heart rates
        if (heartRate && heartRate > 0) {
            heartRateElement.style.animation = 'none';
            setTimeout(() => {
                heartRateElement.style.animation = 'pulse 1s ease-in-out';
            }, 10);
        }
    }
}
// Listen for heart rate updates from main process
window.electronAPI.onHyperateUpdate?.((data) => {
    if (data.heartRate) {
        updateHeartRateDisplay(data.heartRate);
        hyperateStatus.lastHeartRate = data.heartRate;
    }
});

// Listen for OSCLeash movement data updates from main process
window.electronAPI.onOSCLeashMovement?.((data) => {
    // Only update displays if OSCLeash view is visible
    if (document.getElementById('osc-leash-view').style.display !== 'none') {
        // Update movement display with real-time data
        updateMovementDisplay(data.vertical, data.horizontal, data.run);
        
        // Update physbone inputs display with real-time data
        updatePhysboneInputsDisplay(data.physboneData);
    }
});
// Enhanced showHyperateView function to include auto-refresh
const originalShowHyperateView = showHyperateView;
showHyperateView = function() {
    try {
        // Stop any existing status updates first
        stopHyperateStatusUpdates();
        
        // Call the original function
        originalShowHyperateView.call(this);
        
        // Use a longer delay to ensure the view transition is complete
        setTimeout(async () => {
            try {
                await refreshHyperateStatus();
                await refreshHyperateTrackers();
                startHyperateStatusUpdates();
            } catch (error) {
                debugLog(`Error refreshing HypeRate view: ${error.message}`, 'error');
            }
        }, 800);
    } catch (error) {
        debugLog(`Error in showHyperateView: ${error.message}`, 'error');
        // Fallback to original function
        try {
            originalShowHyperateView.call(this);
        } catch (fallbackError) {
            debugLog(`Fallback error in showHyperateView: ${fallbackError.message}`, 'error');
        }
    }
};
// Stop updates when leaving HypeRate view
const originalShowMainView = showMainView;
const originalShowOscView = showOscView;
const originalShowLogsView = showLogsView;
const originalShowSettingsView = showSettingsView;
const originalShowVOSKView = showVOSKView;
showMainView = function() {
    stopHyperateStatusUpdates();
    originalShowMainView.call(this);
};
showOscView = function() {
    stopHyperateStatusUpdates();
    originalShowOscView.call(this);
};
showLogsView = function() {
    stopHyperateStatusUpdates();
    originalShowLogsView.call(this);
};
showSettingsView = function() {
    stopHyperateStatusUpdates();
    originalShowSettingsView.call(this);
};
showVOSKView = function() {
    stopHyperateStatusUpdates();
    originalShowVOSKView.call(this);
};
// Tracker edit modal functionality
let currentEditingTrackerId = null;
function openTrackerEditModal(deviceId, currentName) {
    currentEditingTrackerId = deviceId;
    const modal = document.getElementById('tracker-edit-modal');
    const nameInput = document.getElementById('edit-tracker-name');
    const idInput = document.getElementById('edit-tracker-id');
    // Populate the form
    nameInput.value = currentName || '';
    idInput.value = deviceId;
    modal.style.display = 'flex';
    nameInput.focus();
    // Setup event handlers
    setupTrackerEditModalHandlers();
}
function setupTrackerEditModalHandlers() {
    const modal = document.getElementById('tracker-edit-modal');
    const cancelBtn = document.getElementById('tracker-edit-cancel');
    const saveBtn = document.getElementById('tracker-edit-save');
    // Remove existing handlers
    cancelBtn.onclick = null;
    saveBtn.onclick = null;
    modal.onclick = null;
    cancelBtn.onclick = () => {
        modal.style.display = 'none';
        currentEditingTrackerId = null;
    };
    saveBtn.onclick = async () => {
        const nameInput = document.getElementById('edit-tracker-name');
        if (!currentEditingTrackerId) return;
        try {
            // Update name
            const newName = nameInput.value.trim() || null;
            const nameResult = await window.electronAPI.hyperateUpdateTrackerName(currentEditingTrackerId, newName);
            if (nameResult.success) {
                debugLog(`Updated tracker ${currentEditingTrackerId}: name="${newName || 'default'}"`);
                await refreshHyperateTrackers();
                modal.style.display = 'none';
                currentEditingTrackerId = null;
            } else {
                const error = nameResult.error || 'Unknown error';
                alert(`Failed to update tracker: ${error}`);
            }
        } catch (error) {
            debugLog(`Error updating tracker: ${error.message}`, 'error');
            alert(`Error updating tracker: ${error.message}`);
        }
    };
    // Close modal when clicking overlay
    modal.onclick = (e) => {
        if (e.target === modal) {
            modal.style.display = 'none';
            currentEditingTrackerId = null;
        }
    };
    // Handle Enter key in name input
    const nameInput = document.getElementById('edit-tracker-name');
    nameInput.onkeydown = (e) => {
        if (e.key === 'Enter') {
            saveBtn.click();
        }
    };
}
async function editTrackerName(deviceId, currentName) {
    openTrackerEditModal(deviceId, currentName);
}

// =============================================
// OSC LEASH FUNCTIONS
// =============================================

// OSC Leash status tracking
let oscLeashStatus = {
    enabled: false,
    leashCount: 0,
    activeLeashes: []
};

// Real-time movement data
let movementData = {
    vertical: 0,
    horizontal: 0,
    run: 0,

};

// Physbone input data
let physboneInputs = {
    stretch: 0,
    grabbed: false,
    zPos: 0,
    zNeg: 0,
    xPos: 0,
    xNeg: 0,
    yPos: 0,
    yNeg: 0
};

function showOSCLeashView() {
    debugLog('showOSCLeashView called');
    const views = ['main-view', 'osc-view', 'vosk-view', 'Hyperate-view', 'arcfeedback-view', 'chatbox-view', 'vrchatapi-view', 'osc-leash-view', 'auto-inviter-view', 'logs-view', 'settings-view'].map(id => document.getElementById(id));
    
    views.forEach(view => {
        if (view) view.style.opacity = '0';
    });
    
    setTimeout(() => {
        views.forEach(view => {
            if (view) view.style.display = 'none';
        });
        
        const oscLeashView = document.getElementById('osc-leash-view');
        if (oscLeashView) {
            oscLeashView.style.display = 'block';
            oscLeashView.style.opacity = '0';
            requestAnimationFrame(() => {
                oscLeashView.style.opacity = '1';
            });
            
            // Automatically load the current configuration when opening OSCLeash view
            loadOSCLeashConfig();
        } else {
            debugLog('Error: OSC Leash view element not found!', 'error');
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

    // Initialize OSC Leash status
    refreshOSCLeashStatus(true);
    debugLog('Switched to OSC Leash view');
}

async function toggleOSCLeash() {
    try {
        const toggleBtn = document.getElementById('oscleash-toggle-btn');
        toggleBtn.disabled = true;

        if (oscLeashStatus.enabled) {
            // Stop OSC Leash
            const result = await window.electronAPI.oscleashStop();
            if (result.success) {
                debugLog('OSC Leash stopped');
                oscLeashStatus.enabled = false;
                updateOSCLeashUI();
                clearMovementData();
                clearPhysboneInputs();
            } else {
                debugLog(`Failed to stop OSC Leash: ${result.error}`, 'error');
                alert(`Failed to stop OSC Leash: ${result.error}`);
            }
        } else {
            // Start OSC Leash
            const result = await window.electronAPI.oscleashStart();
            if (result.success) {
                debugLog('OSC Leash started');
                oscLeashStatus.enabled = true;
                updateOSCLeashUI();
                await refreshOSCLeashStatus();
            } else {
                debugLog(`Failed to start OSC Leash: ${result.error}`, 'error');
                alert(`Failed to start OSC Leash: ${result.error}`);
            }
        }
    } catch (error) {
        debugLog(`Error toggling OSC Leash: ${error.message}`, 'error');
    } finally {
        const toggleBtn = document.getElementById('oscleash-toggle-btn');
        toggleBtn.disabled = false;
    }
}

async function refreshOSCLeashStatus(includeConfig = false) {
    try {
        const status = await window.electronAPI.oscleashGetStatus();
        oscLeashStatus = status;
        updateOSCLeashUI();
        updateLeashesDisplay();
        // Update movement displays with real OSC data
        if (status.enabled && status.activeLeashes.length > 0) {
            // Update movement display with real calculated movement
            updateMovementDisplay(
                status.movementData.vertical,
                status.movementData.horizontal,
                status.movementData.run
            );
            // Update physbone inputs display with real leash data
            const activeLeash = status.activeLeashes[0]; // Use first active leash
            updatePhysboneInputsDisplay({
                stretch: activeLeash.stretch,
                grabbed: activeLeash.grabbed,
                zPos: activeLeash.zPos,
                zNeg: activeLeash.zNeg,
                xPos: activeLeash.xPos,
                xNeg: activeLeash.xNeg,
                yPos: activeLeash.yPos,
                yNeg: activeLeash.yNeg
            });
        } else {
            // Clear displays when no active leashes
            clearMovementData();
            clearPhysboneInputs();
        }

        if (includeConfig) {
            await refreshOSCLeashConfig();
        }
    } catch (error) {
        debugLog(`Error refreshing OSC Leash status: ${error.message}`, 'error');
    }
}

async function refreshOSCLeashConfig() {
    try {
        const config = await window.electronAPI.oscleashGetConfig();
        updateConfigDisplay(config);
    } catch (error) {
        debugLog(`Error refreshing OSC Leash config: ${error.message}`, 'error');
    }
}

function updateOSCLeashUI() {
    const statusIndicator = document.getElementById('oscleash-status');
    const statusText = document.getElementById('oscleash-status-text');
    const toggleBtn = document.getElementById('oscleash-toggle-btn');

    if (oscLeashStatus.enabled) {
        statusIndicator.className = 'status-indicator status-connected';
        statusText.textContent = 'Enabled and Active';
        toggleBtn.textContent = 'Disable OSC Leash';
        toggleBtn.className = 'btn btn-danger';
    } else {
        statusIndicator.className = 'status-indicator status-disconnected';
        statusText.textContent = 'Disabled';
        toggleBtn.textContent = 'Enable OSC Leash';
        toggleBtn.className = 'btn btn-primary';
    }
}

function updateLeashesDisplay() {
    const container = document.getElementById('oscleash-leashes-container');
    
    if (!oscLeashStatus.enabled) {
        container.innerHTML = '<div class="leash-disabled-message">OSC Leash is disabled. Enable it to see leash status.</div>';
        return;
    }

    // Use discoveredLeashes if available, fallback to activeLeashes for compatibility
    const leashesToDisplay = oscLeashStatus.discoveredLeashes || oscLeashStatus.activeLeashes || [];
    if (leashesToDisplay.length === 0) {
        container.innerHTML = `
            <div class="leash-empty-message">
                <div class="empty-primary">OSC Leash is enabled but no leashes have been detected yet.</div>
                <div class="empty-secondary">Grab a leash in VRChat to detect and see it appear here.</div>
            </div>
        `;
        return;
    }

    let leashesHtml = '';
    leashesToDisplay.forEach(leash => {
        const stretchPercent = (leash.stretch * 100).toFixed(1);
        const stretchColor = leash.stretch > 0.7 ? '#e74c3c' : leash.stretch > 0.15 ? '#f39c12' : '#2ecc71';
        
        leashesHtml += `
            <div class="leash-item ${leash.grabbed ? 'grabbed' : 'released'}">
                <div class="leash-item-content">
                    <div class="leash-info">
                        <strong class="leash-name">${leash.name}</strong>
                        <span class="leash-status ${leash.grabbed ? 'grabbed' : 'released'}">
                            ${leash.grabbed ? 'GRABBED' : 'RELEASED'}
                        </span>
                    </div>
                    <div class="leash-metrics">
                        <div class="stretch-value" style="color: ${stretchColor};">
                            ${stretchPercent}% stretch
                        </div>
                        <div class="stretch-thresholds">
                            Walk: ${(0.15 * 100).toFixed(0)}% | Run: ${(0.7 * 100).toFixed(0)}%
                        </div>
                    </div>
                </div>
            </div>
        `;
    });

    container.innerHTML = leashesHtml;
}

function updateConfigDisplay(config) {
    const display = document.getElementById('oscleash-config-display');
    
    if (!config) {
        display.textContent = 'Configuration not available';
        return;
    }

    const configText = `
Run Deadzone: ${(config.RunDeadzone * 100).toFixed(0)}%
Walk Deadzone: ${(config.WalkDeadzone * 100).toFixed(0)}%
Strength Multiplier: ${config.StrengthMultiplier}
Up/Down Compensation: ${config.UpDownCompensation}
Up/Down Deadzone: ${(config.UpDownDeadzone * 100).toFixed(0)}%

Active Delay: ${config.ActiveDelay}ms
Inactive Delay: ${config.InactiveDelay}ms
Physbone Parameters: ${config.PhysboneParameters.join(', ')}
    `.trim();

    display.textContent = configText;
}

function updateMovementDisplay(vertical, horizontal, run) {
    movementData = { vertical, horizontal, run };

    const verticalEl = document.getElementById('movement-vertical');
    const horizontalEl = document.getElementById('movement-horizontal');
    const runEl = document.getElementById('movement-run');


    if (verticalEl) {
        verticalEl.textContent = vertical.toFixed(2);
        verticalEl.style.color = Math.abs(vertical) > 0.1 ? '#2ecc71' : '#bdc3c7';
    }

    if (horizontalEl) {
        horizontalEl.textContent = horizontal.toFixed(2);
        horizontalEl.style.color = Math.abs(horizontal) > 0.1 ? '#e74c3c' : '#bdc3c7';
    }

    if (runEl) {
        if (run === 1) {
            runEl.innerHTML = '<span style="color: #e74c3c;">RUNNING</span>';
        } else if (Math.abs(vertical) > 0.1 || Math.abs(horizontal) > 0.1) {
            runEl.innerHTML = '<span style="color: #f39c12;">WALKING</span>';
        } else {
            runEl.innerHTML = '<span style="color: #95a5a6;">IDLE</span>';
        }
    }


}

function updatePhysboneInputsDisplay(inputs) {
    physboneInputs = { ...physboneInputs, ...inputs };

    const container = document.getElementById('physbone-inputs');
    if (!container) return;

    const formatValue = (val) => val.toFixed(3).padStart(6, ' ');
    const getColor = (val) => Math.abs(val) > 0.1 ? '#2ecc71' : '#666';

    const html = `
<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
    <div>
        <div style="color: #3498db; font-weight: bold; margin-bottom: 5px;">LEASH STATE</div>
        <div>Stretch: <span style="color: ${getColor(physboneInputs.stretch)};">${formatValue(physboneInputs.stretch)}</span></div>
        <div>Grabbed: <span style="color: ${physboneInputs.grabbed ? '#2ecc71' : '#e74c3c'};">${physboneInputs.grabbed ? 'TRUE ' : 'FALSE'}</span></div>
    </div>
    <div>
        <div style="color: #e74c3c; font-weight: bold; margin-bottom: 5px;">DIRECTIONAL FORCES</div>
        <div>Z+ (Fwd): <span style="color: ${getColor(physboneInputs.zPos)};">${formatValue(physboneInputs.zPos)}</span></div>
        <div>Z- (Back): <span style="color: ${getColor(physboneInputs.zNeg)};">${formatValue(physboneInputs.zNeg)}</span></div>
        <div>X+ (Right): <span style="color: ${getColor(physboneInputs.xPos)};">${formatValue(physboneInputs.xPos)}</span></div>
        <div>X- (Left): <span style="color: ${getColor(physboneInputs.xNeg)};">${formatValue(physboneInputs.xNeg)}</span></div>
        <div>Y+ (Up): <span style="color: ${getColor(physboneInputs.yPos)};">${formatValue(physboneInputs.yPos)}</span></div>
        <div>Y- (Down): <span style="color: ${getColor(physboneInputs.yNeg)};">${formatValue(physboneInputs.yNeg)}</span></div>
    </div>
</div>
    `;

    container.innerHTML = html;
}
function clearMovementData() {
    updateMovementDisplay(0, 0, 0);
}
function clearPhysboneInputs() {
    const container = document.getElementById('physbone-inputs');
    if (container) {
        container.innerHTML = '<div style="text-align: center; padding: 20px; color: #666;">No physbone data available</div>';
    }
}
// Auto-refresh OSC Leash status when viewing the OSC Leash page
let oscLeashStatusInterval = null;
function startOSCLeashStatusUpdates() {
    if (oscLeashStatusInterval) {
        clearInterval(oscLeashStatusInterval);
    }
    oscLeashStatusInterval = setInterval(async () => {
        if (document.getElementById('osc-leash-view').style.display !== 'none') {
            await refreshOSCLeashStatus();
        }
    }, 400); // Update every 400ms for responsive movement display
}
function stopOSCLeashStatusUpdates() {
    if (oscLeashStatusInterval) {
        clearInterval(oscLeashStatusInterval);
        oscLeashStatusInterval = null;
    }
}
// Start status updates when OSC Leash view is shown
const originalShowOSCLeashView = showOSCLeashView;
showOSCLeashView = function() {
    originalShowOSCLeashView();
    startOSCLeashStatusUpdates();
};
// =============================================
// OSC LEASH CONFIGURATION FUNCTIONS
// =============================================
let currentOSCLeashConfig = null;
// Tab switching for configuration
function showConfigTab(tabName) {
    // Remove active class from all tabs
    document.querySelectorAll('.tab').forEach(tab => {
        tab.classList.remove('active');
    });
    // Hide all config content
    document.querySelectorAll('.config-tab-content').forEach(content => {
        content.style.display = 'none';
    });
    // Show selected tab and content
    document.getElementById(`config-tab-${tabName}`).classList.add('active');
    document.getElementById(`config-content-${tabName}`).style.display = 'block';
}
// Load current configuration from backend
async function loadOSCLeashConfig() {
    try {
        const config = await window.electronAPI.oscleashGetConfig();
        if (config) {
            currentOSCLeashConfig = config;
            populateConfigForm(config);
            updateConfigDisplay(config);
            debugLog('OSC Leash configuration loaded');
        } else {
            debugLog('No OSC Leash configuration available', 'warning');
        }
    } catch (error) {
        debugLog(`Error loading OSC Leash config: ${error.message}`, 'error');
        alert('Failed to load configuration. Please try again.');
    }
}
// Populate form fields with config values
function populateConfigForm(config) {
    // Movement settings
    document.getElementById('config-run-deadzone').value = (config.RunDeadzone * 100);
    document.getElementById('config-walk-deadzone').value = (config.WalkDeadzone * 100);
    document.getElementById('config-strength-multiplier').value = config.StrengthMultiplier;
    document.getElementById('config-updown-compensation').value = config.UpDownCompensation;
    document.getElementById('config-updown-deadzone').value = (config.UpDownDeadzone * 100);
    // Timing settings
    document.getElementById('config-active-delay').value = config.ActiveDelay;
    document.getElementById('config-inactive-delay').value = config.InactiveDelay;
    document.getElementById('config-logging').checked = config.Logging;
    // Advanced settings (physbone parameters)
    document.getElementById('config-physbone-params').value = config.PhysboneParameters.join(', ');
    document.getElementById('config-z-positive').value = config.DirectionalParameters.Z_Positive_Param;
    document.getElementById('config-z-negative').value = config.DirectionalParameters.Z_Negative_Param;
    document.getElementById('config-x-positive').value = config.DirectionalParameters.X_Positive_Param;
    document.getElementById('config-x-negative').value = config.DirectionalParameters.X_Negative_Param;
    document.getElementById('config-y-positive').value = config.DirectionalParameters.Y_Positive_Param;
    document.getElementById('config-y-negative').value = config.DirectionalParameters.Y_Negative_Param;
    // Update all slider displays
    updateSliderDisplays();

}
// Update slider value displays
function updateSliderDisplays() {
    const sliders = [
        { id: 'config-run-deadzone', suffix: '%' },
        { id: 'config-walk-deadzone', suffix: '%' },
        { id: 'config-strength-multiplier', suffix: '' },
        { id: 'config-updown-compensation', suffix: '' },
        { id: 'config-updown-deadzone', suffix: '%' },
        { id: 'config-active-delay', suffix: 'ms' },
        { id: 'config-inactive-delay', suffix: 'ms' },

    ];

    sliders.forEach(slider => {
        const element = document.getElementById(slider.id);
        const display = document.getElementById(slider.id + '-value');
        if (element && display) {
            element.addEventListener('input', () => {
                display.textContent = element.value + slider.suffix;
            });
            // Trigger initial update
            display.textContent = element.value + slider.suffix;
        }
    });
}




// Collect configuration from form
function collectConfigFromForm() {
    return {
        RunDeadzone: parseFloat(document.getElementById('config-run-deadzone').value) / 100,
        WalkDeadzone: parseFloat(document.getElementById('config-walk-deadzone').value) / 100,
        StrengthMultiplier: parseFloat(document.getElementById('config-strength-multiplier').value),
        UpDownCompensation: parseFloat(document.getElementById('config-updown-compensation').value),
        UpDownDeadzone: parseFloat(document.getElementById('config-updown-deadzone').value) / 100,
        ActiveDelay: parseInt(document.getElementById('config-active-delay').value),
        InactiveDelay: parseInt(document.getElementById('config-inactive-delay').value),
        Logging: document.getElementById('config-logging').checked,
        PhysboneParameters: document.getElementById('config-physbone-params').value.split(',').map(p => p.trim()),
        DirectionalParameters: {
            Z_Positive_Param: document.getElementById('config-z-positive').value,
            Z_Negative_Param: document.getElementById('config-z-negative').value,
            X_Positive_Param: document.getElementById('config-x-positive').value,
            X_Negative_Param: document.getElementById('config-x-negative').value,
            Y_Positive_Param: document.getElementById('config-y-positive').value,
            Y_Negative_Param: document.getElementById('config-y-negative').value
        }
    };
}

// Save configuration to backend
async function saveOSCLeashConfig() {
    try {
        const config = collectConfigFromForm();
        const result = await window.electronAPI.oscleashUpdateConfig(config);
        
        if (result.success) {
            currentOSCLeashConfig = config;
            updateConfigDisplay(config);
            debugLog('OSC Leash configuration saved successfully');
            
            // Show success message
            const saveBtn = document.getElementById('oscleash-save-config-btn');
            const originalText = saveBtn.textContent;
            saveBtn.textContent = 'Saved!';
            saveBtn.className = 'btn btn-success';
            setTimeout(() => {
                saveBtn.textContent = originalText;
                saveBtn.className = 'btn btn-success';
            }, 2000);
        } else {
            throw new Error(result.error || 'Unknown error');
        }
    } catch (error) {
        debugLog(`Error saving OSC Leash config: ${error.message}`, 'error');
        alert(`Failed to save configuration: ${error.message}`);
    }
}

// Reset configuration to defaults
async function resetOSCLeashConfig() {
    if (!confirm('Are you sure you want to reset all OSC Leash settings to their default values?')) {
        return;
    }

    const defaultConfig = {
        RunDeadzone: 0.70,
        WalkDeadzone: 0.15,
        StrengthMultiplier: 1.2,
        UpDownCompensation: 1.0,
        UpDownDeadzone: 0.5,

        ActiveDelay: 20,
        InactiveDelay: 500,
        Logging: false,
        PhysboneParameters: ["Leash"],
        DirectionalParameters: {
            Z_Positive_Param: "Leash_Z+",
            Z_Negative_Param: "Leash_Z-",
            X_Positive_Param: "Leash_X+",
            X_Negative_Param: "Leash_X-",
            Y_Positive_Param: "Leash_Y+",
            Y_Negative_Param: "Leash_Y-"
        }
    };

    try {
        populateConfigForm(defaultConfig);
        debugLog('OSC Leash configuration reset to defaults');
        
        // Show reset message
        const resetBtn = document.getElementById('oscleash-reset-config-btn');
        const originalText = resetBtn.textContent;
        resetBtn.textContent = 'Reset!';
        setTimeout(() => {
            resetBtn.textContent = originalText;
        }, 2000);
    } catch (error) {
        debugLog(`Error resetting OSC Leash config: ${error.message}`, 'error');
        alert('Failed to reset configuration. Please try again.');
    }
}

// OSC Leash autostart functionality
async function toggleOSCLeashAutostart() {
    try {
        const autostartBtn = document.getElementById('oscleash-autostart-btn');
        autostartBtn.disabled = true;

        // Get current autostart status
        const currentStatus = await window.electronAPI.oscleashGetAutostart();
        const newEnabled = !currentStatus.enabled;

        // Update autostart setting
        const result = await window.electronAPI.oscleashSetAutostart(newEnabled);
        
        if (result.success) {
            debugLog(`OSCLeash autostart ${newEnabled ? 'enabled' : 'disabled'}`);
            updateOSCLeashAutostartButton(newEnabled);
        } else {
            debugLog(`Failed to update OSCLeash autostart: ${result.error}`, 'error');
            alert(`Failed to update autostart setting: ${result.error}`);
        }
    } catch (error) {
        debugLog(`Error toggling OSCLeash autostart: ${error.message}`, 'error');
        alert('Failed to update autostart setting. Please try again.');
    } finally {
        const autostartBtn = document.getElementById('oscleash-autostart-btn');
        autostartBtn.disabled = false;
    }
}

function updateOSCLeashAutostartButton(enabled) {
    const autostartBtn = document.getElementById('oscleash-autostart-btn');
    if (autostartBtn) {
        autostartBtn.textContent = `Auto-start: ${enabled ? 'Enabled' : 'Disabled'}`;
        autostartBtn.className = enabled ? 'btn btn-success' : 'btn btn-secondary';
    }
}

async function loadOSCLeashAutostartStatus() {
    try {
        const status = await window.electronAPI.oscleashGetAutostart();
        updateOSCLeashAutostartButton(status.enabled);
    } catch (error) {
        debugLog(`Error loading OSCLeash autostart status: ${error.message}`, 'error');
    }
}

// Initialize configuration UI when OSC Leash view is shown  
// Override the existing showOSCLeashView function to include config loading
const originalOSCLeashView = showOSCLeashView;
window.showOSCLeashView = function() {
    debugLog('showOSCLeashView called with config loading');
    const views = ['main-view', 'osc-view', 'vosk-view', 'Hyperate-view', 'arcfeedback-view', 'chatbox-view', 'vrchatapi-view', 'osc-leash-view', 'auto-inviter-view', 'logs-view', 'settings-view'].map(id => document.getElementById(id));
    
    views.forEach(view => {
        if (view) view.style.opacity = '0';
    });
    
    setTimeout(() => {
        views.forEach(view => {
            if (view) view.style.display = 'none';
        });
        
        const oscLeashView = document.getElementById('osc-leash-view');
        if (oscLeashView) {
            oscLeashView.style.display = 'block';
            oscLeashView.style.opacity = '0';
            requestAnimationFrame(() => {
                oscLeashView.style.opacity = '1';
            });
        } else {
            debugLog('Error: OSC Leash view element not found!', 'error');
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

    // Initialize OSC Leash status and configuration
    refreshOSCLeashStatus(true);
    startOSCLeashStatusUpdates();
    
    // Load configuration and autostart status automatically
    setTimeout(() => {
        loadOSCLeashConfig();
        updateSliderDisplays();
        loadOSCLeashAutostartStatus();
    }, 500);
    
    debugLog('Switched to OSC Leash view with configuration');
};
