// Application state
let currentUser = null;
let currentAvatar = null;
let parameters = {};
let isConnected = false;
let isAuthenticated = false;

// Initialize the application
document.addEventListener('DOMContentLoaded', async () => {
    await loadConfig();
    setupEventListeners();
    addLog('Application initialized');
});

// Load configuration from electron main process
async function loadConfig() {
    try {
        const config = await window.electronAPI.getConfig();
        document.getElementById('server-url').value = config.serverUrl;
        document.getElementById('local-port').value = config.localOscPort;
        document.getElementById('target-port').value = config.targetOscPort;
        document.getElementById('target-address').value = config.targetOscAddress;
    } catch (error) {
        addLog(`Error loading config: ${error.message}`, 'error');
    }
}

// Setup all event listeners
function setupEventListeners() {
    // Server connection events
    window.electronAPI.onServerConnection((data) => {
        updateServerStatus(data.status);
        if (data.status === 'connected') {
            addLog('Connected to ARC-OSC Server');
        } else {
            addLog('Disconnected from ARC-OSC Server');
            isConnected = false;
            isAuthenticated = false;
            updateUI();
        }
    });

    window.electronAPI.onAuthRequired(() => {
        addLog('Authentication required');
    });

    window.electronAPI.onAuthSuccess((data) => {
        addLog(`Authentication successful: ${data.userId}`);
        currentUser = data.userId;
        isAuthenticated = true;
        updateUI();
        // Request current avatar info
        window.electronAPI.getUserAvatar();
        window.electronAPI.getParameters();
    });

    window.electronAPI.onAuthFailed((data) => {
        addLog(`Authentication failed: ${data.message}`, 'error');
        isAuthenticated = false;
        updateUI();
    });

    window.electronAPI.onUserAvatarInfo((data) => {
        currentAvatar = data.avatarId;
        parameters = data.parameters || {};
        updateAvatarDisplay();
        updateParameterList();
        addLog(`Avatar updated: ${data.avatarId || 'None'}`);
    });

    window.electronAPI.onParameterUpdate((data) => {
        if (data.name && data.value !== undefined) {
            parameters[data.name] = data.value;
            updateParameterList();
            addLog(`Parameter updated: ${data.name} = ${data.value}`);
        }
    });

    window.electronAPI.onOscReceived((data) => {
        addLog(`OSC Received: ${data.address} = ${data.value}`);
    });

    window.electronAPI.onOscServerStatus((data) => {
        updateOscStatus(data.status, data.port);
        if (data.status === 'connected') {
            addLog(`OSC Server listening on port ${data.port}`);
        } else if (data.status === 'error') {
            addLog(`OSC Server error: ${data.error}`, 'error');
        }
    });

    window.electronAPI.onServerError((error) => {
        addLog(`Server error: ${error.message}`, 'error');
    });

    // Handle Enter key in password field
    document.getElementById('password').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            authenticate();
        }
    });

    // Handle Enter key in OSC sender
    document.getElementById('osc-value').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            sendOscMessage();
        }
    });
}

// Update server connection status indicator
function updateServerStatus(status) {
    const indicator = document.getElementById('server-status');
    const text = document.getElementById('server-status-text');
    
    indicator.className = 'status-indicator';
    
    switch (status) {
        case 'connected':
            indicator.classList.add('status-connected');
            text.textContent = 'Connected';
            isConnected = true;
            break;
        case 'disconnected':
            indicator.classList.add('status-disconnected');
            text.textContent = 'Disconnected';
            isConnected = false;
            break;
        default:
            indicator.classList.add('status-pending');
            text.textContent = 'Connecting...';
    }
    
    updateUI();
}

// Update OSC server status indicator
function updateOscStatus(status, port) {
    const indicator = document.getElementById('osc-status');
    const text = document.getElementById('osc-status-text');
    
    indicator.className = 'status-indicator';
    
    switch (status) {
        case 'connected':
            indicator.classList.add('status-connected');
            text.textContent = `OSC Server :${port}`;
            break;
        case 'error':
            indicator.classList.add('status-disconnected');
            text.textContent = 'OSC Error';
            break;
        default:
            indicator.classList.add('status-disconnected');
            text.textContent = 'OSC Server Off';
    }
}

// Update UI elements based on connection and authentication state
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

// Update avatar display in sidebar
function updateAvatarDisplay() {
    const avatarId = document.getElementById('avatar-id');
    const paramCount = document.getElementById('parameter-count');
    
    avatarId.textContent = currentAvatar || 'No avatar selected';
    paramCount.textContent = `${Object.keys(parameters).length} parameters`;
}

// Update parameter list in main content
function updateParameterList() {
    const container = document.getElementById('parameter-list');
    
    if (Object.keys(parameters).length === 0) {
        container.innerHTML = '<p>No parameters available</p>';
        return;
    }
    
    container.innerHTML = '';
    
    Object.entries(parameters).forEach(([name, value]) => {
        const item = document.createElement('div');
        item.className = 'parameter-item';
        
        const nameSpan = document.createElement('span');
        nameSpan.textContent = name;
        nameSpan.style.fontWeight = '600';
        
        const valueSpan = document.createElement('span');
        valueSpan.textContent = value;
        valueSpan.style.fontFamily = 'monospace';
        
        const typeSpan = document.createElement('span');
        typeSpan.textContent = typeof value;
        typeSpan.style.fontSize = '0.8em';
        typeSpan.style.color = '#666';
        
        item.appendChild(nameSpan);
        item.appendChild(valueSpan);
        item.appendChild(typeSpan);
        
        container.appendChild(item);
    });
}

// Configuration management
async function updateConfig() {
    try {
        const config = {
            serverUrl: document.getElementById('server-url').value,
            localOscPort: parseInt(document.getElementById('local-port').value),
            targetOscPort: parseInt(document.getElementById('target-port').value),
            targetOscAddress: document.getElementById('target-address').value
        };
        
        await window.electronAPI.setConfig(config);
        addLog('Configuration updated');
    } catch (error) {
        addLog(`Error updating config: ${error.message}`, 'error');
    }
}

// Authentication
async function authenticate() {
    if (isAuthenticated && isConnected) {
        disconnect();
        return;
    }
    
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    
    if (!username || !password) {
        addLog('Please enter username and password', 'error');
        return;
    }
    
    try {
        addLog('Connecting to server...');
        await window.electronAPI.connectServer();
        
        // Wait a moment for connection, then authenticate
        setTimeout(async () => {
            await window.electronAPI.authenticate({ username, password });
        }, 1000);
        
    } catch (error) {
        addLog(`Authentication error: ${error.message}`, 'error');
    }
}

// Disconnect from server
async function disconnect() {
    try {
        await window.electronAPI.disconnectServer();
        isConnected = false;
        isAuthenticated = false;
        currentUser = null;
        currentAvatar = null;
        parameters = {};
        updateUI();
        updateAvatarDisplay();
        updateParameterList();
        addLog('Disconnected from server');
    } catch (error) {
        addLog(`Disconnect error: ${error.message}`, 'error');
    }
}

// Send OSC message
async function sendOscMessage() {
    if (!isAuthenticated) {
        addLog('Must be authenticated to send OSC messages', 'error');
        return;
    }
    
    const address = document.getElementById('osc-address').value;
    const value = document.getElementById('osc-value').value;
    const type = document.getElementById('osc-type').value;
    
    if (!address || value === '') {
        addLog('Address and value are required', 'error');
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
        
        await window.electronAPI.sendOsc({
            address,
            value: parsedValue,
            type
        });
        
        addLog(`OSC Sent: ${address} = ${parsedValue} (${type})`);
        
        // Clear the form
        document.getElementById('osc-address').value = '';
        document.getElementById('osc-value').value = '';
        
    } catch (error) {
        addLog(`Error sending OSC: ${error.message}`, 'error');
    }
}

// Tab management
function showTab(tabName) {
    // Hide all tab contents
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    
    // Remove active class from all tabs
    document.querySelectorAll('.tab').forEach(tab => {
        tab.classList.remove('active');
    });
    
    // Show selected tab content
    document.getElementById(tabName).classList.add('active');
    
    // Add active class to clicked tab
    event.target.classList.add('active');
}

// Logging functionality
function addLog(message, type = 'info') {
    const container = document.getElementById('log-container');
    const timestamp = new Date().toLocaleTimeString();
    
    let color = '#00ff00'; // Default green
    if (type === 'error') color = '#ff0000';
    else if (type === 'warning') color = '#ffff00';
    
    const logEntry = document.createElement('div');
    logEntry.style.color = color;
    logEntry.innerHTML = `[${timestamp}] ${message}`;
    
    container.appendChild(logEntry);
    container.scrollTop = container.scrollHeight;
    
    // Keep only last 100 log entries
    while (container.children.length > 100) {
        container.removeChild(container.firstChild);
    }
}

function clearLogs() {
    document.getElementById('log-container').innerHTML = '';
    addLog('Logs cleared');
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    // Clean up any listeners
    window.electronAPI.removeAllListeners('server-connection');
    window.electronAPI.removeAllListeners('auth-required');
    window.electronAPI.removeAllListeners('auth-success');
    window.electronAPI.removeAllListeners('auth-failed');
    window.electronAPI.removeAllListeners('user-avatar-info');
    window.electronAPI.removeAllListeners('parameter-update');
    window.electronAPI.removeAllListeners('osc-received');
    window.electronAPI.removeAllListeners('osc-server-status');
    window.electronAPI.removeAllListeners('server-error');
});
