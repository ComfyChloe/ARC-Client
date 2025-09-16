let additionalOscConnections = [];
let maxAdditionalConnections = 20;
let oscEnabled = false;
let wsForwardingEnabled = false;

let isConnected = false;
let isAuthenticated = false;
let currentUser = null;
let currentAvatar = null;
let parameters = {};
let appSettings = {};
let currentTheme = 'light';

let startTime = Date.now();
let runtimeInterval = null;

let oscLogBuffer = [];
let lastOscLogFlush = 0;
let oscReceivedDisplayEnabled = true; 
const OSC_LOG_BUFFER_SIZE = 100; 
const OSC_LOG_FLUSH_INTERVAL = 1000; 
const MAX_LOG_ENTRIES = 10000; 

const FLOAT_THROTTLE_INTERVAL = 750; 
let lastFloatLogTimes = new Map(); 
let pendingFloatTimeouts = new Map(); 
let lastFloatValues = new Map(); 

document.addEventListener('DOMContentLoaded', async () => {
    await loadConfig();
    await loadAppSettings();
    await loadLastUsername();
    await loadTheme();
    setupEventListeners();
    setupExtrasDropdown();
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
    
    initializeRuntimeTimer();
    
    setTimeout(() => {
        loadParameterBlacklist();
    }, 500);
    
    setTimeout(() => {
        const blacklistInput = document.getElementById('blacklist-pattern');
        if (blacklistInput) {
            blacklistInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    addBlacklistPattern();
                }
            });
        }
    }, 100);
    
    setTimeout(() => {
        const usernameInput = document.getElementById('username');
        const passwordInput = document.getElementById('password');
        const savePasswordCheckbox = document.getElementById('save-password-checkbox');
        if (usernameInput) {
            let saveTimeout;
            
            usernameInput.addEventListener('input', (e) => {
                
                if (saveTimeout) {
                    clearTimeout(saveTimeout);
                }
                
                saveTimeout = setTimeout(async () => {
                    const username = e.target.value.trim().toLowerCase();
                    if (username) {
                        try {
                            await window.electronAPI.setLastUsername(username);
                        } catch (error) {
                            
                            console.warn('Could not auto-save username:', error.message);
                        }
                    }
                }, 1000);
            });
            
            usernameInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    authenticate();
                }
            });
        }
        
        if (passwordInput) {
            passwordInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    authenticate();
                }
            });
        }
        if (savePasswordCheckbox) {
            savePasswordCheckbox.addEventListener('change', handleSavePasswordCheckbox);
        }
        loadSavedPasswordSetting();
    }, 100);
    setInterval(() => {
        if (oscLogBuffer.length > 0) {
            flushOscLogBuffer();
        }
    }, OSC_LOG_FLUSH_INTERVAL);
    setInterval(() => {
        clearFloatRateLimitingData();
        if (!oscReceivedDisplayEnabled) {
            oscLogBuffer = oscLogBuffer.filter(msg => msg.type !== 'received');
            if (window.gc) window.gc();
        }
        const receivedContainer = document.getElementById('osc-received-log-container');
        if (receivedContainer && receivedContainer.children.length > MAX_LOG_ENTRIES/2) {
            rotateLogContainers();
        }
    }, 10000); 
    let lastHeartbeatTime = Date.now();
    function uiHeartbeat() {
        lastHeartbeatTime = Date.now();
    }
    document.addEventListener('click', uiHeartbeat);
    document.addEventListener('keydown', uiHeartbeat);
    setInterval(() => {
        const now = Date.now();
        if (now - lastHeartbeatTime > 10000) {  
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
        const serverUrlInput = document.getElementById('server-url-settings');
        if (serverUrlInput) {
            serverUrlInput.value = config.websocketServerUrl || 'wss://avatar.comfychloe.uk:48255';
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
    
    window.electronAPI.onAppSettings((settings) => {
        console.log('Received app settings from main process:', settings);
        
        appSettings = settings;
        
        wsForwardingEnabled = settings.enableWebSocketForwarding || false;
        updateWebSocketForwardingStatus(wsForwardingEnabled);
    });
    
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
        
        if (!data.id || data.id === null) {
            currentAvatar = null;
            parameters = {}; 
            updateAvatarDisplay();
            updateParameterList();
            debugLog(`Avatar unloaded for user ${data.username}`);
            return;
        }
        
        currentAvatar = {
            id: data.id,
            name: data.name, 
            username: data.username,
            
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
            oscEnabled = true;
            break;
        case 'disabled':
            indicator.classList.add('status-disconnected');
            text.textContent = 'OSC Status: Disabled';
            toggleBtn.textContent = 'Enable OSC';
            toggleBtn.className = 'btn btn-primary';
            oscEnabled = false;
            break;
        case 'error':
            indicator.classList.add('status-disconnected');
            text.textContent = 'OSC Status: Error';
            toggleBtn.textContent = 'Enable OSC';
            toggleBtn.className = 'btn btn-primary';
            oscEnabled = false;
            break;
        default:
            indicator.classList.add('status-disconnected');
            text.textContent = 'OSC Status: Off';
            toggleBtn.textContent = 'Enable OSC';
            toggleBtn.className = 'btn btn-primary';
            oscEnabled = false;
    }
}
function updateWebSocketForwardingStatus(enabled) {
    const indicator = document.getElementById('ws-forwarding-status');
    const text = document.getElementById('ws-forwarding-status-text');
    const toggleBtn = document.getElementById('ws-forwarding-toggle-btn');
    if (!indicator || !text || !toggleBtn) {
        return; 
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
        document.getElementById('server-url-settings').value = serverUrl;
        updateCurrentServerStatus(serverName, serverType);
        const wasConnected = isConnected;
        if (wasConnected) {
            debugLog(`Disconnecting from current server to switch to ${serverName}...`);
            await window.electronAPI.websocketDisconnect();
        }
        const config = {
            websocketServerUrl: serverUrl
        };
        if (serverType !== 'custom') {
            await window.electronAPI.setConfig(config);
            debugLog(`Switched to ${serverName} (${serverUrl}) - configuration saved`);
        } else {
            await window.electronAPI.setConfig(config);
            debugLog(`Switched to ${serverName} (${serverUrl}) - configuration NOT saved (dev mode)`);
        }
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
        let borderColor = '#3498db'; 
        switch (serverType) {
            case 'live':
                borderColor = '#3498db'; 
                break;
            case 'beta':
                borderColor = '#95a5a6'; 
                break;
            case 'custom':
                borderColor = '#f39c12'; 
                break;
        }
        statusElement.style.borderLeftColor = borderColor;
    }
    updateServerButtonStates(serverType);
}
function updateServerButtonStates(activeServerType) {
    const buttons = ['server-btn-live', 'server-btn-beta', 'server-btn-custom'];
    buttons.forEach(buttonId => {
        const button = document.getElementById(buttonId);
        if (button) {
            button.classList.remove('server-btn-active');
        }
    });
    
    
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
    try {
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
        
        avatarName.textContent = currentAvatar.displayName || 'Unknown Avatar';
        
        avatarId.textContent = `ID: ${currentAvatar.id}`;
        avatarId.style.display = 'block';
        
        unloadBtn.style.display = 'block';
    } else if (isAuthenticated) {
        avatarSection.style.display = 'block';
        avatarName.textContent = 'No avatar detected';
        avatarId.textContent = 'ID: Not available';
        avatarId.style.display = 'block';
        
        unloadBtn.style.display = 'none';
    } else {
        avatarSection.style.display = 'none';
        
        unloadBtn.style.display = 'none';
    }
}

function getDisplayNameFromAvatarId(avatarId) {
    if (!avatarId || typeof avatarId !== 'string') {
        return null;
    }
    
    
    
    
    
    if (avatarId.startsWith('avtr_')) {
        
        const uuid = avatarId.substring(5); 
        const shortId = uuid.substring(0, 8);
        return `Avatar ${shortId}`;
    }
    
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
    let color = '#00ff00'; 
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

function isFloatValue(value) {
    
    if (typeof value === 'number') {
        return !Number.isInteger(value);
    }
    if (typeof value === 'string') {
        const num = parseFloat(value);
        return !isNaN(num) && value.includes('.') && !Number.isInteger(num);
    }
    return false;
}

function handleFloatOscLog(type, address, value, connectionId) {
    
    if (type === 'received' && !oscReceivedDisplayEnabled) return;
    const key = `${type}-${address}`;
    const now = Date.now();
    const lastLogTime = lastFloatLogTimes.get(key) || 0;
    
    lastFloatValues.set(key, { type, address, value, connectionId, timestamp: now });
    
    if (pendingFloatTimeouts.has(key)) {
        clearTimeout(pendingFloatTimeouts.get(key));
    }
    
    if (now - lastLogTime >= FLOAT_THROTTLE_INTERVAL) {
        logFloatValueImmediate(type, address, value, connectionId);
        lastFloatLogTimes.set(key, now);
        return;
    }
    
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
        
        container.scrollTop = container.scrollHeight;
        
        const maxEntries = type === 'arc-received' ? 500 : MAX_LOG_ENTRIES;
        while (container.children.length > maxEntries) {
            container.removeChild(container.firstChild);
        }
    }
}

function clearFloatRateLimitingData() {
    
    pendingFloatTimeouts.forEach(timeoutId => clearTimeout(timeoutId));
    lastFloatLogTimes.clear();
    pendingFloatTimeouts.clear();
    lastFloatValues.clear();
    
}
function rotateLogContainers() {
    document.getElementById('osc-received-log-container').innerHTML = 'Log rotation performed<br>';
    clearFloatRateLimitingData();
    
    oscLogBuffer = oscLogBuffer.filter(msg => msg.type !== 'received');
    
    if (window.gc) window.gc();
    
}
function oscReceivedLog(address, value, connectionId = null) {
    
    if (!oscReceivedDisplayEnabled) return;
    
    if (isFloatValue(value)) {
        handleFloatOscLog('received', address, value, connectionId);
        return;
    }
    
    oscLogBuffer.push({
        type: 'received',
        address,
        value,
        connectionId,
        timestamp: Date.now()
    });
    
    const now = Date.now();
    if (oscLogBuffer.length >= OSC_LOG_BUFFER_SIZE || (now - lastOscLogFlush) >= OSC_LOG_FLUSH_INTERVAL) {
        flushOscLogBuffer();
    }
}
function oscForwardedLog(address, value, connectionId = null) {
    
    if (isFloatValue(value)) {
        handleFloatOscLog('forwarded', address, value, connectionId);
        return;
    }
    
    oscLogBuffer.push({
        type: 'forwarded',
        address,
        value,
        connectionId,
        timestamp: Date.now()
    });
    
    const now = Date.now();
    if (oscLogBuffer.length >= OSC_LOG_BUFFER_SIZE || (now - lastOscLogFlush) >= OSC_LOG_FLUSH_INTERVAL) {
        flushOscLogBuffer();
    }
}
function flushOscLogBuffer() {
    if (oscLogBuffer.length === 0) return;
    
    if (oscLogBuffer.length > 5000) {
        clearFloatRateLimitingData();
        debugLog(`Emergency buffer cleanup - buffer size was ${oscLogBuffer.length}`, 'warning');
        
        const forwardedOnly = oscLogBuffer.filter(msg => msg.type === 'forwarded').slice(-100);
        oscLogBuffer = forwardedOnly;
        lastOscLogFlush = Date.now();
        if (window.gc) window.gc();
        
        document.getElementById('osc-received-log-container').innerHTML = 'Emergency buffer cleanup performed<br>';
        return;
    }
    const receivedContainer = document.getElementById('osc-received-log-container');
    const forwardedContainer = document.getElementById('osc-forwarded-log-container');
    
    const received = oscLogBuffer.filter(msg => msg.type === 'received');
    const forwarded = oscLogBuffer.filter(msg => msg.type === 'forwarded');
    
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
        
        while (receivedContainer.children.length > MAX_LOG_ENTRIES) {
            receivedContainer.removeChild(receivedContainer.firstChild);
        }
    }
    
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
        
        while (forwardedContainer.children.length > MAX_LOG_ENTRIES) {
            forwardedContainer.removeChild(forwardedContainer.firstChild);
        }
    }
    
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
    
    if (isFloatValue(value)) {
        handleFloatOscLog('arc-received', address, value, null);
        return;
    }
    
    
    const container = document.getElementById('osc-arc-received-log-container');
    if (container) {
        const timestamp = new Date().toLocaleTimeString();
        const logEntry = document.createElement('div');
        logEntry.style.color = '#ff8c00'; 
        logEntry.innerHTML = `[${timestamp}] ${address} = ${value}`;
        container.appendChild(logEntry);
        
        container.scrollTop = container.scrollHeight;
        
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
    const navMain = document.getElementById('nav-main');
    const navOsc = document.getElementById('nav-osc');
    const navLogs = document.getElementById('nav-logs');
    const navSettings = document.getElementById('nav-settings');
    const navVosk = document.getElementById('nav-vosk');
    const navHyperate = document.getElementById('nav-Hyperate');
    [oscView, logsView, settingsView, voskView, hyperateView, arcfeedbackView, chatboxView, vrchatapiView].forEach(view => {
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
    
    [navOsc, navLogs, navSettings].forEach(nav => {
        nav.classList.remove('active');
        nav.disabled = false;
    });
    
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
    const navMain = document.getElementById('nav-main');
    const navOsc = document.getElementById('nav-osc');
    const navLogs = document.getElementById('nav-logs');
    const navSettings = document.getElementById('nav-settings');
    const navVosk = document.getElementById('nav-vosk');
    const navHyperate = document.getElementById('nav-Hyperate');
    [mainView, logsView, settingsView, voskView, hyperateView, arcfeedbackView, chatboxView, vrchatapiView].forEach(view => {
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
        
        renderAdditionalOscConnections();
    }, 300);
    
    [navMain, navLogs, navSettings].forEach(nav => {
        nav.classList.remove('active');
        nav.disabled = false;
    });
    
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
    const navVosk = document.getElementById('nav-vosk');
    const navHyperate = document.getElementById('nav-Hyperate');
    [mainView, oscView, logsView, voskView, hyperateView, arcfeedbackView, chatboxView, vrchatapiView].forEach(view => {
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
    
    [navMain, navOsc, navLogs].forEach(nav => {
        nav.classList.remove('active');
        nav.disabled = false;
    });
    
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
    const navMain = document.getElementById('nav-main');
    const navOsc = document.getElementById('nav-osc');
    const navLogs = document.getElementById('nav-logs');
    const navSettings = document.getElementById('nav-settings');
    const navVosk = document.getElementById('nav-vosk');
    const navHyperate = document.getElementById('nav-Hyperate');
    [mainView, oscView, settingsView, voskView, hyperateView, arcfeedbackView, chatboxView, vrchatapiView].forEach(view => {
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
        
        updateOscReceivedDisplayStatus();
    }, 300);
    
    [navMain, navOsc, navSettings].forEach(nav => {
        nav.classList.remove('active');
        nav.disabled = false;
    });
    
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
    
    const treeChildren = document.querySelectorAll('.tree-child');
    treeChildren.forEach(child => {
        child.addEventListener('click', () => {
            treeChildren.forEach(c => c.classList.remove('active'));
            child.classList.add('active');
        });
    });
    
    treeContent.addEventListener('click', (e) => {
        e.stopPropagation();
    });
}
function showVOSKView() {
    const views = ['main-view', 'osc-view', 'vosk-view', 'Hyperate-view', 'arcfeedback-view', 'chatbox-view', 'vrchatapi-view', 'logs-view', 'settings-view'].map(id => document.getElementById(id));
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
    const navVOSK = document.getElementById('nav-vosk');
    if (navVOSK) {
        navVOSK.classList.add('active');
        navVOSK.disabled = true;
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
    debugLog('Switched to VOSK view');
}
function showHyperateView() {
    debugLog('showHyperateView called');
    const views = ['main-view', 'osc-view', 'vosk-view', 'Hyperate-view', 'arcfeedback-view', 'chatbox-view', 'vrchatapi-view', 'logs-view', 'settings-view'].map(id => document.getElementById(id));
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
    const navHyperate = document.getElementById('nav-Hyperate');
    if (navHyperate) {
        navHyperate.classList.add('active');
        navHyperate.disabled = true;
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
    
    refreshHyperateStatus(true);
    debugLog('Switched to Hyperate view');
}
function showARCFeedbackView() {
    const views = ['main-view', 'osc-view', 'vosk-view', 'Hyperate-view', 'arcfeedback-view', 'chatbox-view', 'vrchatapi-view', 'logs-view', 'settings-view'].map(id => document.getElementById(id));
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
    const navARCFeedback = document.getElementById('nav-arcfeedback');
    if (navARCFeedback) {
        navARCFeedback.classList.add('active');
        navARCFeedback.disabled = true;
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
    debugLog('Switched to ARC Feedback view');
}
function showChatboxView() {
    const views = ['main-view', 'osc-view', 'vosk-view', 'Hyperate-view', 'arcfeedback-view', 'chatbox-view', 'vrchatapi-view', 'logs-view', 'settings-view'].map(id => document.getElementById(id));
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
    const navChatbox = document.getElementById('nav-chatbox');
    if (navChatbox) {
        navChatbox.classList.add('active');
        navChatbox.disabled = true;
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
    debugLog('Switched to Chatbox view');
}
function showVRChatAPIView() {
    const views = ['main-view', 'osc-view', 'vosk-view', 'Hyperate-view', 'arcfeedback-view', 'chatbox-view', 'vrchatapi-view', 'logs-view', 'settings-view'].map(id => document.getElementById(id));
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
    const navVRChatAPI = document.getElementById('nav-vrchatapi');
    if (navVRChatAPI) {
        navVRChatAPI.classList.add('active');
        navVRChatAPI.disabled = true;
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
    debugLog('Switched to VRChat API view');
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
        
        oscReceivedDisplayEnabled = settings.oscReceivedDisplayEnabled !== false; 
        updateOscReceivedDisplayStatus();
        
        currentTheme = settings.theme || 'light';
        applyTheme(currentTheme);
        
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
        type: type, 
        port: null,
        address: '127.0.0.1',
        enabled: false, 
        name: '', 
        enableWebSocketForwarding: false 
    };
    additionalOscConnections.push(newConnection);
    
    
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
            
            const currentConfig = await window.electronAPI.getServerConfig();
            const updatedConfig = {
                ...currentConfig,
                additionalOscConnections: additionalOscConnections
            };
            await window.electronAPI.setConfig(updatedConfig);
            
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
            
            const currentConfig = await window.electronAPI.getServerConfig();
            const updatedConfig = {
                ...currentConfig,
                additionalOscConnections: additionalOscConnections
            };
            await window.electronAPI.setConfig(updatedConfig);
            
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

async function loadParameterBlacklist() {
    try {
        const patterns = await window.electronAPI.getParameterBlacklist();
        renderBlacklistPatterns(patterns);
    } catch (error) {
        debugLog(`Error loading parameter blacklist: ${error.message}`, 'error');
    }
}
function renderBlacklistPatterns(patterns) {
    const container = document.getElementById('blacklist-patterns');
    if (patterns.length === 0) {
        const isDarkTheme = document.body.classList.contains('dark-theme');
        const textColor = isDarkTheme ? '#b0b0b0' : '#666';
        container.innerHTML = `<p style="color: ${textColor}; font-style: italic;">No patterns configured</p>`;
        return;
    }
    const patternsHtml = patterns.map(pattern => `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; 
                    background-color: #f8f9fa; border-radius: 4px; margin-bottom: 5px; border-left: 3px solid #007bff;">
            <span style="font-family: monospace; color: #495057;">${pattern}</span>
            <button class="btn btn-danger" onclick="removeBlacklistPattern('${pattern}')" 
                    style="padding: 2px 8px; font-size: 12px;">Remove</button>
        </div>
    `).join('');

    container.innerHTML = patternsHtml;
}
async function addBlacklistPattern() {
    const input = document.getElementById('blacklist-pattern');
    const pattern = input.value.trim();
    if (!pattern) {
        debugLog('Please enter a pattern to blacklist', 'warning');
        return;
    }
    try {
        const result = await window.electronAPI.addBlacklistPattern(pattern);
        if (result.success) {
            input.value = '';
            renderBlacklistPatterns(result.patterns);
            debugLog(`Added blacklist pattern: ${pattern}`);
        } else {
            debugLog(result.error || 'Failed to add pattern', 'error');
        }
    } catch (error) {
        debugLog(`Error adding blacklist pattern: ${error.message}`, 'error');
    }
}
async function removeBlacklistPattern(pattern) {
    try {
        const result = await window.electronAPI.removeBlacklistPattern(pattern);
        if (result.success) {
            renderBlacklistPatterns(result.patterns);
            debugLog(`Removed blacklist pattern: ${pattern}`);
        } else {
            debugLog(result.error || 'Failed to remove pattern', 'error');
        }
    } catch (error) {
        debugLog(`Error removing blacklist pattern: ${error.message}`, 'error');
    }
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
        
        if (!oscReceivedDisplayEnabled) {
            
            oscLogBuffer = oscLogBuffer.filter(msg => msg.type !== 'received');
            clearFloatRateLimitingData();
            document.getElementById('osc-received-log-container').innerHTML = 'OSC Received Display Disabled<br>';
            
            if (window.gc) window.gc();
        }
        
        const currentSettings = await window.electronAPI.getAppSettings();
        currentSettings.oscReceivedDisplayEnabled = oscReceivedDisplayEnabled;
        await window.electronAPI.setAppSettings(currentSettings);
        
        updateOscReceivedDisplayStatus();
        
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
        
        const currentSettings = await window.electronAPI.getAppSettings();
        currentSettings.theme = newTheme;
        await window.electronAPI.setAppSettings(currentSettings);
        debugLog(`Theme switched to ${newTheme} mode`);
    } catch (error) {
        debugLog(`Error toggling theme: ${error.message}`, 'error');
    }
}

async function handleSavePasswordCheckbox() {
    const checkbox = document.getElementById('save-password-checkbox');
    const modal = document.getElementById('password-warning-modal');
    
    if (checkbox.checked) {
        
        modal.style.display = 'flex';
        setupPasswordWarningModal();
    } else {
        
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
            
            hyperateStatus.stopping = true;
            updateHyperateUI();
            const result = await window.electronAPI.hyperateStop();
            if (result.success) {
                debugLog('HypeRate stopped');
                hyperateStatus.stopping = false;
                updateHyperateUI();
            } else {
                debugLog(`Failed to stop HypeRate: ${result.error}`, 'error');
                
                hyperateStatus.stopping = false;
                updateHyperateUI();
            }
        } else {
            
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

async function toggleHyperateAutostart() {
    try {
        const autostartBtn = document.getElementById('hyperate-autostart-btn');
        autostartBtn.disabled = true;
        
        const currentStatus = await window.electronAPI.hyperateGetAutostart();
        const newEnabled = !currentStatus.enabled;
        
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
        hyperateStatus = { ...status, stopping: false }; 
        updateHyperateUI();
        
        if (includeAutostart) {
            const autostartStatus = await window.electronAPI.hyperateGetAutostart();
            updateHyperateAutostartUI(autostartStatus.enabled);
        }
        
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
    
    if (hyperateStatus.enabled && hyperateStatus.lastHeartRate) {
        updateHeartRateDisplay(hyperateStatus.lastHeartRate);
    } else if (!hyperateStatus.enabled) {
        updateHeartRateDisplay(null);
    }
}

let hyperateStatusInterval = null;
function startHyperateStatusUpdates() {
    if (hyperateStatusInterval) {
        clearInterval(hyperateStatusInterval);
    }
    hyperateStatusInterval = setInterval(async () => {
        if (document.getElementById('Hyperate-view').style.display !== 'none') {
            await refreshHyperateStatus();
            
            if (Math.random() < 0.1) { 
                clearFloatRateLimitingData();
            }
        }
    }, 2000); 
}
function stopHyperateStatusUpdates() {
    if (hyperateStatusInterval) {
        clearInterval(hyperateStatusInterval);
        hyperateStatusInterval = null;
    }
}

function updateHeartRateDisplay(heartRate) {
    const heartRateElement = document.getElementById('current-heartrate');
    if (heartRateElement) {
        heartRateElement.textContent = heartRate || '--';
        
        if (heartRate && heartRate > 0) {
            heartRateElement.style.animation = 'none';
            setTimeout(() => {
                heartRateElement.style.animation = 'pulse 1s ease-in-out';
            }, 10);
        }
    }
}

window.electronAPI.onHyperateUpdate?.((data) => {
    if (data.heartRate) {
        updateHeartRateDisplay(data.heartRate);
        hyperateStatus.lastHeartRate = data.heartRate;
    }
});

const originalShowHyperateView = showHyperateView;
showHyperateView = function() {
    try {
        
        stopHyperateStatusUpdates();
        
        
        originalShowHyperateView.call(this);
        
        
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
        
        try {
            originalShowHyperateView.call(this);
        } catch (fallbackError) {
            debugLog(`Fallback error in showHyperateView: ${fallbackError.message}`, 'error');
        }
    }
};

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

let currentEditingTrackerId = null;
function openTrackerEditModal(deviceId, currentName) {
    currentEditingTrackerId = deviceId;
    const modal = document.getElementById('tracker-edit-modal');
    const nameInput = document.getElementById('edit-tracker-name');
    const idInput = document.getElementById('edit-tracker-id');
    
    nameInput.value = currentName || '';
    idInput.value = deviceId;
    modal.style.display = 'flex';
    nameInput.focus();
    
    setupTrackerEditModalHandlers();
}
function setupTrackerEditModalHandlers() {
    const modal = document.getElementById('tracker-edit-modal');
    const cancelBtn = document.getElementById('tracker-edit-cancel');
    const saveBtn = document.getElementById('tracker-edit-save');
    
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
    
    modal.onclick = (e) => {
        if (e.target === modal) {
            modal.style.display = 'none';
            currentEditingTrackerId = null;
        }
    };
    
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
