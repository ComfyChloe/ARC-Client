let currentUser = null;
let currentAvatar = null;
let parameters = {};
let isConnected = false;
let isAuthenticated = false;
let oscEnabled = false;
document.addEventListener('DOMContentLoaded', async () => {
    await loadConfig();
    setupEventListeners();
    addLog('Application initialized');
});
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
function setupEventListeners() {
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
    document.getElementById('password').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            authenticate();
        }
    });
    document.getElementById('osc-value').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            sendOscMessage();
        }
    });
}
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
function updateAvatarDisplay() {
    const avatarId = document.getElementById('avatar-id');
    const paramCount = document.getElementById('parameter-count');
    avatarId.textContent = currentAvatar || 'No avatar selected';
    paramCount.textContent = `${Object.keys(parameters).length} parameters`;
}
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
async function updateConfig() {
    try {
        const config = {
            serverUrl: document.getElementById('server-url').value,
            localOscPort: parseInt(document.getElementById('local-port').value),
            targetOscPort: parseInt(document.getElementById('target-port').value),
            targetOscAddress: document.getElementById('target-address').value
        };
        await window.electronAPI.setConfig(config);
        addLog('Configuration updated - OSC services will restart');
    } catch (error) {
        addLog(`Error updating config: ${error.message}`, 'error');
    }
}
async function updateOscPorts() {
    try {
        const config = {
            serverUrl: document.getElementById('server-url').value,
            localOscPort: parseInt(document.getElementById('local-port').value),
            targetOscPort: parseInt(document.getElementById('target-port').value),
            targetOscAddress: document.getElementById('target-address').value
        };
        await window.electronAPI.setConfig(config);
        addLog('OSC ports updated - OSC services will restart');
    } catch (error) {
        addLog(`Error updating OSC ports: ${error.message}`, 'error');
    }
}
async function toggleOscServer() {
    try {
        if (oscEnabled) {
            await window.electronAPI.disableOsc();
            addLog('OSC Server disabled');
        } else {
            await window.electronAPI.enableOsc();
            addLog('OSC Server enabled');
        }
    } catch (error) {
        addLog(`Error toggling OSC server: ${error.message}`, 'error');
    }
}
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
        document.getElementById('osc-address').value = '';
        document.getElementById('osc-value').value = '';
    } catch (error) {
        addLog(`Error sending OSC: ${error.message}`, 'error');
    }
}
function showTab(tabName) {
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    document.querySelectorAll('.tab').forEach(tab => {
        tab.classList.remove('active');
    });
    document.getElementById(tabName).classList.add('active');
    event.target.classList.add('active');
}
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
    while (container.children.length > 100) {
        container.removeChild(container.firstChild);
    }
}
function clearLogs() {
    document.getElementById('log-container').innerHTML = '';
    addLog('Logs cleared');
}
window.addEventListener('beforeunload', () => {
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
