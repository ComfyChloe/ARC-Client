let currentUser = null;
let currentAvatar = null;
let parameters = {};
let isConnected = false;
let isAuthenticated = false;
let oscEnabled = false;
let additionalOscConnections = [];
let maxAdditionalConnections = 20;
document.addEventListener('DOMContentLoaded', async () => {
    await loadConfig();
    loadAppSettings();
    setupEventListeners();
    const navMain = document.getElementById('nav-main');
    const navOsc = document.getElementById('nav-osc');
    const navSettings = document.getElementById('nav-settings');
    navMain.classList.add('active');
    navMain.disabled = true;
    navOsc.classList.remove('active');
    navOsc.disabled = false;
    navSettings.classList.remove('active');
    navSettings.disabled = false;
    addLog('Application initialized');
});
async function loadConfig() {
    try {
        const config = await window.electronAPI.getConfig();
        document.getElementById('server-url-settings').value = config.serverUrl;
        document.getElementById('local-port-settings').value = config.localOscPort;
        document.getElementById('target-port-settings').value = config.targetOscPort;
        document.getElementById('target-address-settings').value = config.targetOscAddress;
        if (config.additionalOscConnections) {
            additionalOscConnections = config.additionalOscConnections;
            renderAdditionalOscConnections();
        }
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
            serverUrl: document.getElementById('server-url-settings').value,
            localOscPort: parseInt(document.getElementById('local-port-settings').value),
            targetOscPort: parseInt(document.getElementById('target-port-settings').value),
            targetOscAddress: document.getElementById('target-address-settings').value
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
            serverUrl: document.getElementById('server-url-settings').value,
            localOscPort: parseInt(document.getElementById('local-port-settings').value),
            targetOscPort: parseInt(document.getElementById('target-port-settings').value),
            targetOscAddress: document.getElementById('target-address-settings').value
        };
        await window.electronAPI.setConfig(config);
        addLog('Primary OSC configuration updated - OSC services will restart');
    } catch (error) {
        addLog(`Error updating primary OSC configuration: ${error.message}`, 'error');
    }
}
async function updateAdditionalOscConnections() {
    try {
        const currentConfig = await window.electronAPI.getConfig();
        const updatedConfig = {
            ...currentConfig,
            additionalOscConnections: additionalOscConnections
        };
        await window.electronAPI.setConfig(updatedConfig);
        addLog(`Additional OSC connections updated - ${additionalOscConnections.length} connections configured`);
    } catch (error) {
        addLog(`Error updating additional OSC connections: ${error.message}`, 'error');
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
        content.style.display = tabName === content.id ? 'block' : 'none';
    });
    document.querySelectorAll('.tab').forEach(tab => {
        tab.classList.remove('active');
    });
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
function updateConfigFromSettings() {
    return updateConfig();
}
function updateOscPortsFromSettings() {
    return updateOscPorts();
}
function showMainView() {
    const mainView = document.getElementById('main-view');
    const oscView = document.getElementById('osc-view');
    const settingsView = document.getElementById('settings-view');
    const navMain = document.getElementById('nav-main');
    const navOsc = document.getElementById('nav-osc');
    const navSettings = document.getElementById('nav-settings');
    oscView.style.opacity = '0';
    settingsView.style.opacity = '0';
    setTimeout(() => {
        oscView.style.display = 'none';
        settingsView.style.display = 'none';
        mainView.style.display = 'block';
        mainView.style.opacity = '0';
        requestAnimationFrame(() => {
            mainView.style.opacity = '1';
        });
    }, 300);
    navMain.classList.add('active');
    navMain.disabled = true;
    navOsc.classList.remove('active');
    navOsc.disabled = false;
    navSettings.classList.remove('active');
    navSettings.disabled = false;
    addLog('Switched to main view');
}
function showOscView() {
    const mainView = document.getElementById('main-view');
    const oscView = document.getElementById('osc-view');
    const settingsView = document.getElementById('settings-view');
    const navMain = document.getElementById('nav-main');
    const navOsc = document.getElementById('nav-osc');
    const navSettings = document.getElementById('nav-settings');
    mainView.style.opacity = '0';
    settingsView.style.opacity = '0';
    setTimeout(() => {
        mainView.style.display = 'none';
        settingsView.style.display = 'none';
        oscView.style.display = 'block';
        oscView.style.opacity = '0';
        requestAnimationFrame(() => {
            oscView.style.opacity = '1';
        });
        renderAdditionalOscConnections();
    }, 300);
    navMain.classList.remove('active');
    navMain.disabled = false;
    navOsc.classList.add('active');
    navOsc.disabled = true;
    navSettings.classList.remove('active');
    navSettings.disabled = false;
    addLog('Switched to OSC settings view');
}
function showSettingsView() {
    const mainView = document.getElementById('main-view');
    const oscView = document.getElementById('osc-view');
    const settingsView = document.getElementById('settings-view');
    const navMain = document.getElementById('nav-main');
    const navOsc = document.getElementById('nav-osc');
    const navSettings = document.getElementById('nav-settings');
    mainView.style.opacity = '0';
    oscView.style.opacity = '0';
    setTimeout(() => {
        mainView.style.display = 'none';
        oscView.style.display = 'none';
        settingsView.style.display = 'block';
        settingsView.style.opacity = '0';
        requestAnimationFrame(() => {
            settingsView.style.opacity = '1';
        });
    }, 300);
    navMain.classList.remove('active');
    navMain.disabled = false;
    navOsc.classList.remove('active');
    navOsc.disabled = false;
    navSettings.classList.add('active');
    navSettings.disabled = true;
    addLog('Switched to settings view');
}
function updateAppSettings() {
    const autoConnect = document.getElementById('auto-connect').value;
    const logLevel = document.getElementById('log-level').value;
    localStorage.setItem('autoConnect', autoConnect);
    localStorage.setItem('logLevel', logLevel);
    addLog(`Application settings updated - Auto-connect: ${autoConnect}, Log level: ${logLevel}`);
}
function loadAppSettings() {
    const autoConnect = localStorage.getItem('autoConnect') || 'false';
    const logLevel = localStorage.getItem('logLevel') || 'info';
    const autoConnectSelect = document.getElementById('auto-connect');
    const logLevelSelect = document.getElementById('log-level');
    if (autoConnectSelect) autoConnectSelect.value = autoConnect;
    if (logLevelSelect) logLevelSelect.value = logLevel;
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
function addOscConnection(type) {
    if (additionalOscConnections.length >= maxAdditionalConnections) {
        addLog(`Maximum ${maxAdditionalConnections} additional connections allowed`, 'error');
        return;
    }
    const newConnection = {
        id: Date.now().toString(),
        type: type,
        port: null,
        address: '127.0.0.1',
        enabled: true,
        name: ''
    };
    additionalOscConnections.push(newConnection);
    renderAdditionalOscConnections();
    addLog(`Added new ${type} OSC connection slot (${additionalOscConnections.length}/${maxAdditionalConnections})`);
}
function removeOscConnection(id) {
    additionalOscConnections = additionalOscConnections.filter(conn => conn.id !== id);
    renderAdditionalOscConnections();
    addLog(`Removed OSC connection`);
}
function updateOscConnection(id, field, value) {
    const connection = additionalOscConnections.find(conn => conn.id === id);
    if (connection) {
        if (field === 'port') {
            connection[field] = value ? parseInt(value) : null;
        } else {
            connection[field] = value;
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
    const incomingHeader = document.createElement('h5');
    incomingHeader.style.cssText = 'margin: 0 0 15px 0; color: #27ae60; font-size: 1.1em; display: flex; align-items: center; padding-bottom: 8px; border-bottom: 2px solid #27ae60;';
    incomingHeader.innerHTML = '📥 Incoming <span style="font-size: 0.8em; margin-left: 10px; color: #666;">(' + incomingConnections.length + ')</span>';
    incomingColumn.appendChild(incomingHeader);
    const outgoingHeader = document.createElement('h5');
    outgoingHeader.style.cssText = 'margin: 0 0 15px 0; color: #e74c3c; font-size: 1.1em; display: flex; align-items: center; padding-bottom: 8px; border-bottom: 2px solid #e74c3c;';
    outgoingHeader.innerHTML = '📤 Outgoing <span style="font-size: 0.8em; margin-left: 10px; color: #666;">(' + outgoingConnections.length + ')</span>';
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
    connectionDiv.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 15px;">
            <div style="flex: 1;">
                <h6 style="margin: 0 0 5px 0; color: #2c3e50; font-size: 0.95em;">
                    ${connection.name || `Connection ${index}`}
                </h6>
                <div style="margin-bottom: 8px;">${statusBadge}</div>
                <small style="color: #666; font-size: 0.8em; line-height: 1.3;">
                    ${connection.type === 'incoming' ? '🔽 Receives OSC data' : '🔼 Sends OSC data'}
                </small>
            </div>
            <button class="btn btn-danger" onclick="removeOscConnection('${connection.id}')" style="padding: 4px 12px; font-size: 12px;">Remove</button>
        </div>
        
        <div style="display: flex; flex-direction: column; gap: 10px;">
            <div class="form-group" style="margin-bottom: 0;">
                <label style="font-size: 0.85em; font-weight: 600; color: #555;">Connection Name</label>
                <input type="text" placeholder="e.g. TouchOSC, SteamVR.." value="${connection.name || ''}" 
                       onchange="updateOscConnection('${connection.id}', 'name', this.value)"
                       style="width: 100%; padding: 6px 8px; font-size: 13px; border: 1px solid #ddd; border-radius: 3px;">
            </div>
            
            <div class="form-group" style="margin-bottom: 0;">
                <label style="font-size: 0.85em; font-weight: 600; color: #555;">${portLabel}</label>
                <input type="number" placeholder="9040" value="${connection.port || ''}" 
                       onchange="updateOscConnection('${connection.id}', 'port', this.value)"
                       style="width: 100%; padding: 6px 8px; font-size: 13px; border: 1px solid #ddd; border-radius: 3px;"
                       min="1" max="65535">
            </div>
            
            <div class="form-group" style="margin-bottom: 0;">
                <label style="font-size: 0.85em; font-weight: 600; color: #555;">${addressLabel}</label>
                <input type="text" value="${connection.address}" 
                       onchange="updateOscConnection('${connection.id}', 'address', this.value)"
                       style="width: 100%; padding: 6px 8px; font-size: 13px; border: 1px solid #ddd; border-radius: 3px;"
                       placeholder="${defaultAddress}">
            </div>
            
            <div style="display: flex; align-items: center; margin-top: 5px;">
                <input type="checkbox" ${connection.enabled ? 'checked' : ''} 
                       onchange="updateOscConnection('${connection.id}', 'enabled', this.checked)"
                       style="margin-right: 8px; transform: scale(1.1);">
                <label style="font-size: 0.85em; font-weight: 600; color: #555; margin: 0;">Connection Active</label>
            </div>
        </div>
    `;
    return connectionDiv;
}
