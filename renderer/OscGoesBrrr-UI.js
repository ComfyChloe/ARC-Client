/**
 * OscGoesBrrr UI Module
 * Handles all OscGoesBrrr (haptic device) related UI interactions and display updates
 */

// OGB status tracking
let ogbStatus = {
    enabled: false,
    connected: false,
    connecting: false,
    deviceCount: 0,
    devices: [],
    gameDevices: [],
    serverName: null,
    serverVersion: null,
    intifaceAddress: '127.0.0.1',
    intifacePort: 12345,
    intifaceWss: false,
    audioEnabled: false,
    lastError: null,
    maxLevel: 0
};

let ogbStatusInterval = null;

/**
 * Toggle OscGoesBrrr on/off
 */
async function toggleOgb() {
    try {
        const toggleBtn = document.getElementById('ogb-toggle-btn');
        toggleBtn.disabled = true;
        if (ogbStatus.enabled) {
            // Stop OGB
            const result = await window.electronAPI.ogbStop();
            if (result.success) {
                debugLog('OscGoesBrrr stopped');
                updateOgbUI();
            } else {
                debugLog(`Failed to stop OscGoesBrrr: ${result.error}`, 'error');
            }
        } else {
            // Start OGB - show connecting status immediately
            ogbStatus.enabled = true;
            ogbStatus.connected = false;
            ogbStatus.connecting = true;
            updateOgbUI();
            const result = await window.electronAPI.ogbStart();
            if (result.success) {
                debugLog('OscGoesBrrr started');
                updateOgbUI();
            } else {
                debugLog(`Failed to start OscGoesBrrr: ${result.error}`, 'error');
                alert(`Failed to start OscGoesBrrr: ${result.error}`);
                // Reset status on failure
                ogbStatus.enabled = false;
                ogbStatus.connecting = false;
                updateOgbUI();
            }
        }
    } catch (error) {
        debugLog(`Error toggling OscGoesBrrr: ${error.message}`, 'error');
    } finally {
        const toggleBtn = document.getElementById('ogb-toggle-btn');
        toggleBtn.disabled = false;
    }
}

/**
 * Toggle OscGoesBrrr auto-start setting
 */
async function toggleOgbAutostart() {
    try {
        const toggleSlider = document.getElementById('ogb-autostart-toggle');
        if (toggleSlider) {
            toggleSlider.style.pointerEvents = 'none';
            toggleSlider.style.opacity = '0.6';
        }
        
        // Get current autostart status
        const currentStatus = await window.electronAPI.ogbGetAutostart();
        const newEnabled = !currentStatus.enabled;
        // Update autostart setting
        const result = await window.electronAPI.ogbSetAutostart(newEnabled);
        if (result.success) {
            debugLog(`OscGoesBrrr autostart ${newEnabled ? 'enabled' : 'disabled'}`);
            updateOgbAutostartUI(newEnabled);
        } else {
            debugLog(`Failed to update OscGoesBrrr autostart: ${result.error}`, 'error');
            alert(`Failed to update autostart setting: ${result.error}`);
        }
    } catch (error) {
        debugLog(`Error toggling OscGoesBrrr autostart: ${error.message}`, 'error');
    } finally {
        const toggleSlider = document.getElementById('ogb-autostart-toggle');
        if (toggleSlider) {
            toggleSlider.style.pointerEvents = '';
            toggleSlider.style.opacity = '';
        }
    }
}

/**
 * Update the autostart UI
 */
function updateOgbAutostartUI(enabled) {
    const disabledOption = document.getElementById('ogb-autostart-disabled');
    const enabledOption = document.getElementById('ogb-autostart-enabled');
    
    if (disabledOption && enabledOption) {
        if (enabled) {
            disabledOption.classList.remove('active');
            enabledOption.classList.add('active');
        } else {
            enabledOption.classList.remove('active');
            disabledOption.classList.add('active');
        }
    }
}

/**
 * Refresh OGB status from backend
 */
async function refreshOgbStatus(includeAutostart = false) {
    try {
        const status = await window.electronAPI.ogbGetStatus();
        ogbStatus = { ...status };
        updateOgbUI();
        updateOgbDevicesList();
        updateOgbGameDevicesList();
        
        // Only refresh auto-start status when explicitly requested
        if (includeAutostart) {
            const autostartStatus = await window.electronAPI.ogbGetAutostart();
            updateOgbAutostartUI(autostartStatus.enabled);
        }
    } catch (error) {
        debugLog(`Error refreshing OscGoesBrrr status: ${error.message}`, 'error');
    }
}

/**
 * Update the main OGB UI status display
 */
function updateOgbUI() {
    const statusIndicator = document.getElementById('ogb-status');
    const statusText = document.getElementById('ogb-status-text');
    const toggleBtn = document.getElementById('ogb-toggle-btn');
    const serverInfo = document.getElementById('ogb-server-info');
    
    if (!statusIndicator || !statusText || !toggleBtn) return;

    if (ogbStatus.enabled && ogbStatus.connected) {
        statusIndicator.className = 'status-indicator status-connected';
        let statusMessage = 'Connected to Intiface';
        if (ogbStatus.deviceCount > 0) {
            statusMessage += ` (${ogbStatus.deviceCount} device${ogbStatus.deviceCount !== 1 ? 's' : ''})`;
        }
        statusText.textContent = statusMessage;
        toggleBtn.textContent = 'Stop';
        toggleBtn.disabled = false;
    } else if (ogbStatus.enabled && ogbStatus.connecting) {
        statusIndicator.className = 'status-indicator status-connecting';
        statusText.textContent = 'Connecting to Intiface...';
        toggleBtn.textContent = 'Stop';
        toggleBtn.disabled = false;
    } else if (ogbStatus.enabled && ogbStatus.lastError) {
        statusIndicator.className = 'status-indicator status-error';
        statusText.textContent = `Error: ${ogbStatus.lastError}`;
        toggleBtn.textContent = 'Stop';
        toggleBtn.disabled = false;
    } else if (ogbStatus.enabled) {
        statusIndicator.className = 'status-indicator status-connecting';
        statusText.textContent = 'Starting...';
        toggleBtn.textContent = 'Stop';
        toggleBtn.disabled = false;
    } else {
        statusIndicator.className = 'status-indicator status-disconnected';
        statusText.textContent = 'Stopped';
        toggleBtn.textContent = 'Start';
        toggleBtn.disabled = false;
    }

    // Update server info
    if (serverInfo) {
        if (ogbStatus.connected && ogbStatus.serverName) {
            serverInfo.textContent = `${ogbStatus.serverName} v${ogbStatus.serverVersion}`;
            serverInfo.style.display = 'block';
        } else {
            serverInfo.style.display = 'none';
        }
    }

    // Update max level indicator
    const levelBar = document.getElementById('ogb-level-bar');
    const levelText = document.getElementById('ogb-level-text');
    if (levelBar && levelText) {
        const levelPercent = Math.round((ogbStatus.maxLevel || 0) * 100);
        levelBar.style.width = `${levelPercent}%`;
        levelText.textContent = `${levelPercent}%`;
    }
}

/**
 * Update connected devices list
 */
function updateOgbDevicesList() {
    const container = document.getElementById('ogb-devices-list');
    if (!container) {
        console.warn('[OGB UI] Devices list container not found');
        return;
    }

    const devices = ogbStatus.devices || [];
    
    if (devices.length === 0) {
        container.innerHTML = `
            <div class="ogb-no-devices">
                <p>No haptic devices connected</p>
                <p class="hint">Make sure Intiface Central is running and devices are connected</p>
            </div>
        `;
        return;
    }

    container.innerHTML = devices.map(device => {
        const featuresHtml = device.features.map(f => {
            const levelPercent = Math.round((f.lastLevel || 0) * 100);
            return `
                <div class="ogb-feature">
                    <span class="feature-type">${f.type}</span>
                    <div class="feature-level">
                        <div class="feature-level-bar-container">
                            <div class="feature-level-bar" style="width: ${levelPercent}%"></div>
                        </div>
                        <span class="ogb-feature-value">${levelPercent}%</span>
                    </div>
                </div>
            `;
        }).join('');

        return `
            <div class="ogb-device-card">
                <div class="ogb-device-header">
                    <div>
                        <div class="ogb-device-name">${device.name}</div>
                        <div class="ogb-device-battery" style="font-size: 11px; color: #888; margin-top: 2px;">${device.id}</div>
                    </div>
                </div>
                <div class="ogb-features-list">
                    ${featuresHtml}
                </div>
                <button class="btn btn-secondary btn-small" onclick="openOgbDeviceConfig('${device.id}')" style="width: 100%; margin-top: 10px;">
                    Configure Bindings
                </button>
            </div>
        `;
    }).join('');
}

/**
 * Update game devices (avatar contacts) list
 */
function updateOgbGameDevicesList() {
    const container = document.getElementById('ogb-game-devices-list');
    if (!container) {
        console.warn('[OGB UI] Game devices container not found');
        return;
    }

    const gameDevices = ogbStatus.gameDevices || [];
    
    if (gameDevices.length === 0) {
        container.innerHTML = `
            <div class="ogb-no-devices">
                <p>No avatar contacts detected</p>
                <p class="hint">Contacts will appear when your avatar has VRCFury Haptics or similar setup</p>
            </div>
        `;
        return;
    }

    container.innerHTML = gameDevices.map(status => `
        <div class="ogb-game-device">
            <span class="game-device-status">${status}</span>
        </div>
    `).join('');
}

/**
 * Open device configuration (embedded section)
 */
async function openOgbDeviceConfig(deviceId) {
    const section = document.getElementById('ogb-device-config-section');
    const deviceNameEl = document.getElementById('ogb-config-device-name');
    
    if (!section || !deviceNameEl) {
        console.error('[OGB UI] Missing config section elements');
        return;
    }

    // Find device
    const device = ogbStatus.devices.find(d => d.id === deviceId);
    if (!device) {
        console.error('[OGB UI] Device not found:', deviceId);
        return;
    }

    deviceNameEl.textContent = device.name;
    section.dataset.deviceId = deviceId;

    // Get current config
    const config = await window.electronAPI.ogbGetConfig();
    const deviceBinding = config.devices?.find(d => d.id === deviceId) || {
        type: 'all',
        sources: ['touchOthers', 'penOthers', 'frotOthers'],
        multiplier: 1.0
    };

    // Populate form
    document.getElementById('ogb-config-type').value = deviceBinding.type || 'all';
    document.getElementById('ogb-config-multiplier').value = deviceBinding.multiplier || 1.0;
    document.getElementById('ogb-config-multiplier-value').textContent = `${deviceBinding.multiplier || 1.0}x`;

    // Populate source checkboxes
    const sources = deviceBinding.sources || [];
    ['touchSelf', 'touchOthers', 'penSelf', 'penOthers', 'frotOthers'].forEach(source => {
        const checkbox = document.getElementById(`ogb-source-${source}`);
        if (checkbox) {
            checkbox.checked = sources.includes(source);
        }
    });

    // Show section and scroll to it
    section.style.display = 'block';
    setTimeout(() => {
        section.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 100);
}

/**
 * Close device configuration section
 */
function closeOgbDeviceConfig() {
    const section = document.getElementById('ogb-device-config-section');
    if (section) {
        section.style.display = 'none';
    }
}

/**
 * Save device configuration
 */
async function saveOgbDeviceConfig() {
    const section = document.getElementById('ogb-device-config-section');
    if (!section) return;

    const deviceId = section.dataset.deviceId;
    if (!deviceId) return;

    // Gather form data
    const type = document.getElementById('ogb-config-type').value;
    const multiplier = parseFloat(document.getElementById('ogb-config-multiplier').value) || 1.0;
    
    const sources = [];
    ['touchSelf', 'touchOthers', 'penSelf', 'penOthers', 'frotOthers'].forEach(source => {
        const checkbox = document.getElementById(`ogb-source-${source}`);
        if (checkbox && checkbox.checked) {
            sources.push(source);
        }
    });

    try {
        const result = await window.electronAPI.ogbUpdateDeviceBinding(deviceId, {
            type,
            sources,
            multiplier
        });

        if (result.success) {
            debugLog(`Updated binding for device ${deviceId}`);
            closeOgbDeviceConfig();
        } else {
            alert(`Failed to save binding: ${result.error}`);
        }
    } catch (error) {
        debugLog(`Error saving device config: ${error.message}`, 'error');
        alert(`Error: ${error.message}`);
    }
}

/**
 * Update Intiface connection settings
 */
async function updateIntifaceSettings() {
    try {
        const address = document.getElementById('ogb-intiface-address').value.trim() || '127.0.0.1';
        const port = parseInt(document.getElementById('ogb-intiface-port').value) || 12345;
        const useWss = document.getElementById('ogb-intiface-wss').checked;

        const result = await window.electronAPI.ogbUpdateIntifaceConfig({
            address,
            port,
            useWss
        });

        if (result.success) {
            debugLog('Intiface settings updated');
            ogbStatus.intifaceAddress = address;
            ogbStatus.intifacePort = port;
            ogbStatus.intifaceWss = useWss;
        } else {
            alert(`Failed to update settings: ${result.error}`);
        }
    } catch (error) {
        debugLog(`Error updating Intiface settings: ${error.message}`, 'error');
    }
}

/**
 * Populate Intiface settings form with current values
 */
function populateIntifaceSettings() {
    const addressInput = document.getElementById('ogb-intiface-address');
    const portInput = document.getElementById('ogb-intiface-port');
    const wssCheckbox = document.getElementById('ogb-intiface-wss');

    if (addressInput) addressInput.value = ogbStatus.intifaceAddress || '127.0.0.1';
    if (portInput) portInput.value = ogbStatus.intifacePort || 12345;
    if (wssCheckbox) wssCheckbox.checked = ogbStatus.intifaceWss || false;
}

/**
 * Start periodic status updates for OGB view
 */
function startOgbStatusUpdates() {
    if (ogbStatusInterval) {
        clearInterval(ogbStatusInterval);
    }
    ogbStatusInterval = setInterval(async () => {
        const view = document.getElementById('oscgoesbrrr-view');
        if (view && view.style.display !== 'none') {
            await refreshOgbStatus();
        }
    }, 1000); // Update every second for responsive level display
}

/**
 * Stop periodic status updates
 */
function stopOgbStatusUpdates() {
    if (ogbStatusInterval) {
        clearInterval(ogbStatusInterval);
        ogbStatusInterval = null;
    }
}

/**
 * Initialize OGB view
 */
async function initOgbView() {
    // Setup event listeners
    const multiplierSlider = document.getElementById('ogb-config-multiplier');
    if (multiplierSlider) {
        multiplierSlider.addEventListener('input', (e) => {
            const valueDisplay = document.getElementById('ogb-config-multiplier-value');
            if (valueDisplay) {
                valueDisplay.textContent = `${e.target.value}x`;
            }
        });
    }

    // Setup real-time status updates via IPC
    if (window.electronAPI.onOgbStatusUpdate) {
        window.electronAPI.onOgbStatusUpdate((status) => {
            ogbStatus = { ...status };
            // Only update UI if the OGB view is active
            const ogbView = document.getElementById('oscgoesbrrr-view');
            if (ogbView && ogbView.style.display !== 'none') {
                updateOgbUI();
                updateOgbDevicesList();
                updateOgbGameDevicesList();
            }
        });
    }

    // Initial status refresh
    await refreshOgbStatus(true);
    populateIntifaceSettings();
}

/**
 * Called when OGB view becomes visible
 */
async function showOgbView() {
    await refreshOgbStatus(true);
    populateIntifaceSettings();
    startOgbStatusUpdates();
}

/**
 * Called when leaving OGB view
 */
function hideOgbView() {
    stopOgbStatusUpdates();
}

// Export functions for use in app.js
if (typeof window !== 'undefined') {
    window.toggleOgb = toggleOgb;
    window.toggleOgbAutostart = toggleOgbAutostart;
    window.refreshOgbStatus = refreshOgbStatus;
    window.openOgbDeviceConfig = openOgbDeviceConfig;
    window.closeOgbDeviceConfig = closeOgbDeviceConfig;
    window.saveOgbDeviceConfig = saveOgbDeviceConfig;
    window.updateIntifaceSettings = updateIntifaceSettings;
    window.initOgbView = initOgbView;
    window.showOgbView = showOgbView;
    window.hideOgbView = hideOgbView;
}
