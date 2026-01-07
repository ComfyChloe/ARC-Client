/**
 * HypeRate UI Module
 * Handles all HypeRate-related UI interactions and display updates
 */

// HypeRate status tracking
let hyperateStatus = {
    enabled: false,
    connected: false,
    stopping: false,
    hasApiKey: false,
    lastError: null,
    reconnecting: false,
    reconnectAttempts: 0,
    maxReconnectAttempts: 5
};

let hyperateStatusInterval = null;
let currentEditingTrackerId = null;

/**
 * Toggle HypeRate on/off
 */
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

/**
 * Toggle HypeRate auto-start setting
 */
async function toggleHyperateAutostart() {
    try {
        const toggleSlider = document.getElementById('hyperate-autostart-toggle');
        if (toggleSlider) {
            toggleSlider.style.pointerEvents = 'none';
            toggleSlider.style.opacity = '0.6';
        }
        
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
        const toggleSlider = document.getElementById('hyperate-autostart-toggle');
        if (toggleSlider) {
            toggleSlider.style.pointerEvents = '';
            toggleSlider.style.opacity = '';
        }
    }
}

/**
 * Update the autostart button UI
 */
function updateHyperateAutostartUI(enabled) {
    const disabledOption = document.getElementById('hyperate-autostart-disabled');
    const enabledOption = document.getElementById('hyperate-autostart-enabled');
    
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
 * Refresh HypeRate status from backend
 */
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

/**
 * Add a new HypeRate tracker
 */
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

/**
 * Remove a HypeRate tracker
 */
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

/**
 * Set a tracker as primary
 */
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

/**
 * Refresh the trackers list display
 */
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
            const primaryAction = isPrimary ? '' : `<button class="btn btn-secondary btn-small" onclick="HyperateUI.setPrimaryHyperateTracker('${tracker.deviceId}')" style="margin-right: 5px;">Set Primary</button>`;
            trackersHtml += `
                <div class="tracker-item" style="border: 1px solid ${isPrimary ? '#2ecc71' : '#ddd'}; border-radius: 4px; padding: 10px; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center; background: ${isPrimary ? '#f8fff8' : 'white'};">
                    <div>
                        <strong>${displayName}</strong>${primaryBadge}<br>
                        <small style="color: #666;">ID: ${tracker.deviceId}</small><br>
                        <small>Status: <span style="color: ${statusColor};">${status}</span> | HR: ${heartRate} BPM | Last Update: ${lastUpdate}</small>
                    </div>
                    <div>
                        <button class="btn btn-secondary btn-small" onclick="HyperateUI.editTrackerName('${tracker.deviceId}', '${tracker.name || ''}')" style="margin-right: 5px;">Edit</button>
                        ${primaryAction}
                        <button class="btn btn-danger btn-small" onclick="HyperateUI.removeHyperateTracker('${tracker.deviceId}')">Remove</button>
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

/**
 * Update the main HypeRate UI status display
 */
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
    } else if (hyperateStatus.enabled && hyperateStatus.reconnecting) {
        // Show reconnecting status with attempt count and error
        statusIndicator.className = 'status-indicator status-error';
        let statusMessage = `Reconnecting (${hyperateStatus.reconnectAttempts}/${hyperateStatus.maxReconnectAttempts})...`;
        if (hyperateStatus.lastError) {
            statusMessage += ` - ${hyperateStatus.lastError}`;
        }
        statusText.textContent = statusMessage;
        toggleBtn.textContent = 'Stop HypeRate';
        toggleBtn.disabled = false;
    } else if (hyperateStatus.enabled && hyperateStatus.lastError) {
        // Show error state
        statusIndicator.className = 'status-indicator status-error';
        statusText.textContent = `Error: ${hyperateStatus.lastError}`;
        toggleBtn.textContent = 'Stop HypeRate';
        toggleBtn.disabled = false;
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

/**
 * Start periodic status updates for HypeRate view
 */
function startHyperateStatusUpdates() {
    if (hyperateStatusInterval) {
        clearInterval(hyperateStatusInterval);
    }
    hyperateStatusInterval = setInterval(async () => {
        if (document.getElementById('Hyperate-view').style.display !== 'none') {
            await refreshHyperateStatus();
            // Periodic cleanup during HypeRate updates
            if (Math.random() < 0.1) { // 10% chance per update
                if (typeof clearFloatRateLimitingData === 'function') {
                    clearFloatRateLimitingData();
                }
            }
        }
    }, 2000); // Update every 2 seconds
}

/**
 * Stop periodic status updates
 */
function stopHyperateStatusUpdates() {
    if (hyperateStatusInterval) {
        clearInterval(hyperateStatusInterval);
        hyperateStatusInterval = null;
    }
}

/**
 * Update heart rate display
 */
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

/**
 * Open tracker edit modal
 */
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

/**
 * Setup event handlers for tracker edit modal
 */
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

/**
 * Edit tracker name (convenience function)
 */
async function editTrackerName(deviceId, currentName) {
    openTrackerEditModal(deviceId, currentName);
}

/**
 * Handle updates from main process (heart rate and status changes)
 */
function handleHyperateUpdate(data) {
    // Handle status change updates
    if (data.type === 'status') {
        hyperateStatus = {
            enabled: data.enabled,
            connected: data.connected,
            hasApiKey: data.hasApiKey,
            lastHeartRate: data.lastHeartRate || hyperateStatus.lastHeartRate,
            lastError: data.lastError || null,
            reconnecting: data.reconnecting || false,
            reconnectAttempts: data.reconnectAttempts || 0,
            maxReconnectAttempts: data.maxReconnectAttempts || 5,
            stopping: false
        };
        updateHyperateUI();
        // Refresh trackers list on connection state change
        if (document.getElementById('Hyperate-view').style.display !== 'none') {
            refreshHyperateTrackers();
        }
    }
    // Handle heart rate updates
    if (data.heartRate) {
        updateHeartRateDisplay(data.heartRate);
        hyperateStatus.lastHeartRate = data.heartRate;
    }
}

/**
 * Initialize HypeRate event listeners
 */
function initializeHyperateListeners() {
    window.electronAPI.onHyperateUpdate?.((data) => {
        handleHyperateUpdate(data);
    });
}

// Initialize listeners when module loads
if (typeof window !== 'undefined') {
    initializeHyperateListeners();
}

// Export functions to global scope for onclick handlers
window.HyperateUI = {
    toggleHyperate,
    toggleHyperateAutostart,
    refreshHyperateStatus,
    addHyperateTracker,
    removeHyperateTracker,
    setPrimaryHyperateTracker,
    editTrackerName,
    startHyperateStatusUpdates,
    stopHyperateStatusUpdates,
    updateHyperateUI,
    refreshHyperateTrackers
};
