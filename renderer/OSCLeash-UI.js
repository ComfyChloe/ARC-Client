/**
 * OSCLeash UI Module
 * Handles all OSCLeash-related UI interactions and display updates
 */

// OSC Leash status tracking
let oscLeashStatus = {
    enabled: false,
    leashCount: 0,
    activeLeashes: [],
    discoveredLeashes: []
};

// Real-time movement data
let movementData = {
    vertical: 0,
    horizontal: 0,
    run: 0
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

let oscLeashStatusInterval = null;
let currentOSCLeashConfig = null;

/**
 * Toggle OSC Leash on/off
 */
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

/**
 * Refresh OSC Leash status from backend
 */
async function refreshOSCLeashStatus(includeConfig = false) {
    try {
        const status = await window.electronAPI.oscleashGetStatus();
        oscLeashStatus = status;
        updateOSCLeashUI();
        updateLeashesDisplay();
        
        // Update movement displays with real OSC data
        if (status.enabled && status.activeLeashes && status.activeLeashes.length > 0) {
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

/**
 * Refresh OSC Leash configuration
 */
async function refreshOSCLeashConfig() {
    try {
        const config = await window.electronAPI.oscleashGetConfig();
        updateConfigDisplay(config);
    } catch (error) {
        debugLog(`Error refreshing OSC Leash config: ${error.message}`, 'error');
    }
}

/**
 * Update the main OSC Leash UI status display
 */
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

/**
 * Update leashes display
 */
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

/**
 * Update configuration display
 */
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

/**
 * Update movement display
 */
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

/**
 * Update physbone inputs display
 */
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

/**
 * Clear movement data display
 */
function clearMovementData() {
    updateMovementDisplay(0, 0, 0);
}

/**
 * Clear physbone inputs display
 */
function clearPhysboneInputs() {
    const container = document.getElementById('physbone-inputs');
    if (container) {
        container.innerHTML = '<div style="text-align: center; padding: 20px; color: #666;">No physbone data available</div>';
    }
}

/**
 * Start periodic status updates for OSC Leash view
 */
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

/**
 * Stop periodic status updates
 */
function stopOSCLeashStatusUpdates() {
    if (oscLeashStatusInterval) {
        clearInterval(oscLeashStatusInterval);
        oscLeashStatusInterval = null;
    }
}

// Configuration Management Functions

/**
 * Switch between configuration tabs
 */
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

/**
 * Load current configuration from backend
 */
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

/**
 * Populate form fields with config values
 */
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

/**
 * Update slider value displays
 */
function updateSliderDisplays() {
    const sliders = [
        { id: 'config-run-deadzone', suffix: '%' },
        { id: 'config-walk-deadzone', suffix: '%' },
        { id: 'config-strength-multiplier', suffix: '' },
        { id: 'config-updown-compensation', suffix: '' },
        { id: 'config-updown-deadzone', suffix: '%' },
        { id: 'config-active-delay', suffix: 'ms' },
        { id: 'config-inactive-delay', suffix: 'ms' }
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

/**
 * Collect configuration from form
 */
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

/**
 * Save configuration to backend
 */
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

/**
 * Reset configuration to defaults
 */
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

/**
 * Toggle OSC Leash auto-start setting
 */
async function toggleOSCLeashAutostart() {
    try {
        const toggleSlider = document.getElementById('oscleash-autostart-toggle');
        if (toggleSlider) {
            toggleSlider.style.pointerEvents = 'none';
            toggleSlider.style.opacity = '0.6';
        }

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
        const toggleSlider = document.getElementById('oscleash-autostart-toggle');
        if (toggleSlider) {
            toggleSlider.style.pointerEvents = '';
            toggleSlider.style.opacity = '';
        }
    }
}

/**
 * Update autostart button UI
 */
function updateOSCLeashAutostartButton(enabled) {
    const disabledOption = document.getElementById('oscleash-autostart-disabled');
    const enabledOption = document.getElementById('oscleash-autostart-enabled');
    
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
 * Load autostart status
 */
async function loadOSCLeashAutostartStatus() {
    try {
        const status = await window.electronAPI.oscleashGetAutostart();
        updateOSCLeashAutostartButton(status.enabled);
    } catch (error) {
        debugLog(`Error loading OSCLeash autostart status: ${error.message}`, 'error');
    }
}

/**
 * Handle OSCLeash movement data updates from main process
 */
function handleOSCLeashMovement(data) {
    // Only update displays if OSCLeash view is visible
    if (document.getElementById('osc-leash-view').style.display !== 'none') {
        // Update movement display with real-time data
        updateMovementDisplay(data.vertical, data.horizontal, data.run);
        
        // Update physbone inputs display with real-time data
        updatePhysboneInputsDisplay(data.physboneData);
    }
}

/**
 * Handle OSCLeash status updates from main process
 */
function handleOSCLeashStatusUpdate(status) {
    oscLeashStatus = status;
    updateOSCLeashUI();
    updateLeashesDisplay();
}

/**
 * Initialize OSCLeash event listeners
 */
function initializeOSCLeashListeners() {
    window.electronAPI.onOSCLeashMovement?.((data) => {
        handleOSCLeashMovement(data);
    });
    window.electronAPI.onOSCLeashStatusUpdate?.((status) => {
        handleOSCLeashStatusUpdate(status);
    });
}

// Initialize listeners when module loads
if (typeof window !== 'undefined') {
    initializeOSCLeashListeners();
}

// Export functions to global scope for onclick handlers
window.OSCLeashUI = {
    toggleOSCLeash,
    refreshOSCLeashStatus,
    startOSCLeashStatusUpdates,
    stopOSCLeashStatusUpdates,
    showConfigTab,
    loadOSCLeashConfig,
    saveOSCLeashConfig,
    resetOSCLeashConfig,
    toggleOSCLeashAutostart,
    loadOSCLeashAutostartStatus,
    updateSliderDisplays,
    updateMovementDisplay,
    updatePhysboneInputsDisplay
};
