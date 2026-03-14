/**
 * Auto-Status UI Module
 * Handles VRChat auto-status preset management, schedule timetable, and status display.
 */

const STATUS_TYPES = [
    { value: 'join me', label: 'Join Me', color: '#3498db', icon: '🔵' },
    { value: 'active', label: 'Online', color: '#2ecc71', icon: '🟢' },
    { value: 'ask me', label: 'Ask Me', color: '#f39c12', icon: '🟠' },
    { value: 'busy', label: 'Do Not Disturb', color: '#e74c3c', icon: '🔴' }
];
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

let autoStatusState = {
    presets: [],
    schedule: [],
    settings: {},
    status: {}
};

// --- Initialization ---

async function initAutoStatusUI() {
    await refreshAutoStatusData();
    debugLog('[AutoStatus] UI initialized');
}

async function refreshAutoStatusData() {
    try {
        const [config, status] = await Promise.all([
            window.electronAPI.autoStatusGetConfig(),
            window.electronAPI.autoStatusGetStatus()
        ]);
        autoStatusState.presets = config.presets || [];
        autoStatusState.schedule = config.schedule || [];
        autoStatusState.settings = config.settings || {};
        autoStatusState.status = status || {};
        renderAutoStatusUI();
    } catch (error) {
        debugLog(`[AutoStatus] Error refreshing data: ${error.message}`, 'error');
    }
}

// --- Main Render ---

function renderAutoStatusUI() {
    const container = document.getElementById('autostatus-content');
    if (!container) return;

    container.innerHTML = `
        ${renderStatusBanner()}
        ${renderPresetsSection()}
        ${renderScheduleSection()}
        ${renderSettingsSection()}
    `;
    attachAutoStatusListeners();
}

// --- Status Banner ---

function renderStatusBanner() {
    const s = autoStatusState.status;
    const activePreset = s.lastAppliedPresetId
        ? autoStatusState.presets.find(p => p.id === s.lastAppliedPresetId)
        : null;
    const statusType = activePreset ? STATUS_TYPES.find(t => t.value === activePreset.statusType) : null;
    const guardActive = s.avatarGuardActive;
    const apiAvailable = s.vrchatApiAvailable;

    return `
        <div class="autostatus-banner">
            <div class="autostatus-banner-left">
                <div class="autostatus-banner-icon">${statusType ? statusType.icon : '⚪'}</div>
                <div class="autostatus-banner-info">
                    <div class="autostatus-banner-title">${activePreset ? activePreset.name : 'No Active Preset'}</div>
                    <div class="autostatus-banner-subtitle">
                        ${activePreset ? `${statusType?.label || activePreset.statusType}${activePreset.statusMessage ? ' — "' + activePreset.statusMessage + '"' : ''}` : 'Waiting for trigger...'}
                    </div>
                </div>
            </div>
            <div class="autostatus-banner-right">
                ${guardActive ? '<span class="autostatus-badge autostatus-badge-warn">Avatar Guard</span>' : ''}
                <span class="autostatus-badge ${apiAvailable ? 'autostatus-badge-ok' : 'autostatus-badge-err'}">${apiAvailable ? 'API Ready' : 'API Offline'}</span>
                <span class="autostatus-badge autostatus-badge-info">OSC: ${s.lastOscValue || 0}</span>
            </div>
        </div>
    `;
}

// --- Presets Section ---

function renderPresetsSection() {
    let cards = '';
    for (let i = 1; i <= 6; i++) {
        const preset = autoStatusState.presets.find(p => p.id === i);
        cards += renderPresetCard(i, preset);
    }
    return `
        <div class="autostatus-section">
            <div class="autostatus-section-header">
                <h3>Status Presets</h3>
                <span class="autostatus-section-hint">Configure up to 6 presets triggered by OSC parameter (int 1–6)</span>
            </div>
            <div class="autostatus-presets-grid">${cards}</div>
        </div>
    `;
}

function renderPresetCard(id, preset) {
    const isActive = autoStatusState.status.lastAppliedPresetId === id;
    const statusType = preset ? STATUS_TYPES.find(t => t.value === preset.statusType) : null;
    const statusOptions = STATUS_TYPES.map(t =>
        `<option value="${t.value}" ${preset && preset.statusType === t.value ? 'selected' : ''}>${t.icon} ${t.label}</option>`
    ).join('');

    if (!preset) {
        return `
            <div class="autostatus-preset-card autostatus-preset-empty" data-preset-id="${id}">
                <div class="autostatus-preset-header">
                    <span class="autostatus-preset-number">${id}</span>
                    <span class="autostatus-preset-label">Empty Slot</span>
                </div>
                <div class="autostatus-preset-body-empty">
                    <button class="btn btn-primary btn-small" onclick="AutoStatusUI.createPreset(${id})">+ Add Preset</button>
                </div>
            </div>
        `;
    }

    return `
        <div class="autostatus-preset-card ${isActive ? 'autostatus-preset-active' : ''} ${!preset.enabled ? 'autostatus-preset-disabled' : ''}" data-preset-id="${id}" style="--preset-accent: ${statusType?.color || '#95a5a6'}">
            <div class="autostatus-preset-header">
                <span class="autostatus-preset-number">${id}</span>
                <span class="autostatus-preset-name-display">${preset.name}</span>
                <div class="autostatus-preset-actions">
                    <button class="autostatus-icon-btn" onclick="AutoStatusUI.testPreset(${id})" title="Test">▶</button>
                    <button class="autostatus-icon-btn autostatus-icon-btn-danger" onclick="AutoStatusUI.deletePreset(${id})" title="Delete">✕</button>
                </div>
            </div>
            <div class="autostatus-preset-body">
                <div class="autostatus-field">
                    <label>Name</label>
                    <input type="text" value="${preset.name}" maxlength="24" data-field="name" data-preset-id="${id}" onchange="AutoStatusUI.updatePresetField(${id}, 'name', this.value)">
                </div>
                <div class="autostatus-field">
                    <label>Status Type</label>
                    <select data-field="statusType" data-preset-id="${id}" onchange="AutoStatusUI.updatePresetField(${id}, 'statusType', this.value)">
                        ${statusOptions}
                    </select>
                </div>
                <div class="autostatus-field">
                    <label>Message <small class="autostatus-char-count">${(preset.statusMessage || '').length}/32</small></label>
                    <input type="text" value="${preset.statusMessage || ''}" maxlength="32" placeholder="Optional status message" data-field="statusMessage" data-preset-id="${id}" oninput="AutoStatusUI.onMessageInput(this)" onchange="AutoStatusUI.updatePresetField(${id}, 'statusMessage', this.value)">
                </div>
                <div class="autostatus-field-row">
                    <label class="autostatus-toggle-label">
                        <span>Enabled</span>
                        <div class="autostatus-toggle ${preset.enabled ? 'autostatus-toggle-on' : ''}" onclick="AutoStatusUI.togglePresetEnabled(${id})">
                            <div class="autostatus-toggle-knob"></div>
                        </div>
                    </label>
                </div>
            </div>
        </div>
    `;
}

// --- Schedule Section ---

function renderScheduleSection() {
    const entries = autoStatusState.schedule;
    const presetOptions = autoStatusState.presets
        .filter(p => p)
        .map(p => `<option value="${p.id}">${p.name} (${STATUS_TYPES.find(t => t.value === p.statusType)?.icon || ''} ${p.id})</option>`)
        .join('');

    let rows = '';
    if (entries.length === 0) {
        rows = '<div class="autostatus-schedule-empty">No schedule entries yet. Add one below to automate status changes by time of day.</div>';
    } else {
        rows = entries.map(entry => renderScheduleRow(entry)).join('');
    }

    return `
        <div class="autostatus-section">
            <div class="autostatus-section-header">
                <h3>Schedule Timetable</h3>
                <span class="autostatus-section-hint">Automatically set status based on day and time</span>
            </div>
            <div class="autostatus-schedule-list">${rows}</div>
            <div class="autostatus-schedule-add card">
                <div class="autostatus-schedule-add-row">
                    <div class="autostatus-field autostatus-field-days">
                        <label>Days</label>
                        <div class="autostatus-day-picker" id="new-schedule-days">
                            ${DAY_LABELS.map((d, i) => `<button class="autostatus-day-btn" data-day="${i}" onclick="this.classList.toggle('autostatus-day-active')">${d}</button>`).join('')}
                        </div>
                    </div>
                    <div class="autostatus-field">
                        <label>Start</label>
                        <input type="time" id="new-schedule-start" value="09:00">
                    </div>
                    <div class="autostatus-field">
                        <label>End</label>
                        <input type="time" id="new-schedule-end" value="17:00">
                    </div>
                    <div class="autostatus-field">
                        <label>Preset</label>
                        <select id="new-schedule-preset">${presetOptions || '<option disabled>No presets configured</option>'}</select>
                    </div>
                    <div class="autostatus-field autostatus-field-action">
                        <button class="btn btn-primary btn-small" onclick="AutoStatusUI.addScheduleEntry()" ${!presetOptions ? 'disabled' : ''}>Add</button>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function renderScheduleRow(entry) {
    const preset = autoStatusState.presets.find(p => p.id === entry.presetId);
    const statusType = preset ? STATUS_TYPES.find(t => t.value === preset.statusType) : null;
    const days = entry.daysOfWeek.map(d => DAY_LABELS[d]).join(', ');
    const isOvernight = entry.endTime <= entry.startTime;

    return `
        <div class="autostatus-schedule-row ${!entry.enabled ? 'autostatus-schedule-disabled' : ''}" data-entry-id="${entry.id}">
            <div class="autostatus-schedule-color" style="background: ${statusType?.color || '#95a5a6'}"></div>
            <div class="autostatus-schedule-details">
                <div class="autostatus-schedule-time">${entry.startTime} — ${entry.endTime} ${isOvernight ? '<small>(overnight)</small>' : ''}</div>
                <div class="autostatus-schedule-days">${days}</div>
            </div>
            <div class="autostatus-schedule-preset">
                ${statusType?.icon || '⚪'} ${preset?.name || 'Unknown'}
            </div>
            <div class="autostatus-schedule-actions">
                <div class="autostatus-toggle ${entry.enabled ? 'autostatus-toggle-on' : ''}" onclick="AutoStatusUI.toggleScheduleEnabled('${entry.id}')">
                    <div class="autostatus-toggle-knob"></div>
                </div>
                <button class="autostatus-icon-btn autostatus-icon-btn-danger" onclick="AutoStatusUI.deleteScheduleEntry('${entry.id}')" title="Remove">✕</button>
            </div>
        </div>
    `;
}

// --- Settings Section ---

function renderSettingsSection() {
    const settings = autoStatusState.settings;
    return `
        <div class="autostatus-section">
            <div class="autostatus-section-header">
                <h3>Settings</h3>
            </div>
            <div class="card">
                <div class="autostatus-settings-grid">
                    <div class="autostatus-field">
                        <label>Cooldown (seconds)</label>
                        <input type="number" min="5" max="120" value="${settings.cooldownSeconds || 10}" onchange="AutoStatusUI.updateSetting('cooldownSeconds', parseInt(this.value))">
                        <small>Minimum time between status changes</small>
                    </div>
                    <div class="autostatus-field">
                        <label>Time Format</label>
                        <select onchange="AutoStatusUI.updateSetting('timeFormat', this.value)">
                            <option value="24h" ${settings.timeFormat === '24h' ? 'selected' : ''}>24-hour</option>
                            <option value="12h" ${settings.timeFormat === '12h' ? 'selected' : ''}>12-hour</option>
                        </select>
                    </div>
                </div>
                <div class="autostatus-info-box">
                    <strong>OSC Parameter:</strong> <code>/avatar/parameters/ARCOSC/vrc-status</code> (Int, 0–6)<br>
                    <small>Value 0 = no action. Values 1–6 trigger the corresponding preset. Status changes are blocked for 30 seconds after avatar changes.</small>
                </div>
            </div>
        </div>
    `;
}

// --- Event Handlers ---

function attachAutoStatusListeners() {
    // Listen for live status updates from main process
    if (!window._autoStatusListenerAttached) {
        window.electronAPI.onAutoStatusUpdate((data) => {
            autoStatusState.status = data;
            const banner = document.querySelector('.autostatus-banner');
            if (banner) {
                banner.outerHTML = renderStatusBanner();
            }
        });
        window._autoStatusListenerAttached = true;
    }
}

// --- Actions (exposed as AutoStatusUI) ---

const AutoStatusUI = {
    async createPreset(id) {
        const result = await window.electronAPI.autoStatusSetPreset({
            id,
            name: `Preset ${id}`,
            statusType: 'active',
            statusMessage: '',
            enabled: true
        });
        if (result.success) await refreshAutoStatusData();
    },

    async updatePresetField(id, field, value) {
        const preset = autoStatusState.presets.find(p => p.id === id);
        if (!preset) return;
        preset[field] = value;
        const result = await window.electronAPI.autoStatusSetPreset(preset);
        if (result.success) {
            // Lightweight update without full re-render
            autoStatusState.presets = (await window.electronAPI.autoStatusGetConfig()).presets || [];
        }
    },

    async togglePresetEnabled(id) {
        const preset = autoStatusState.presets.find(p => p.id === id);
        if (!preset) return;
        preset.enabled = !preset.enabled;
        await window.electronAPI.autoStatusSetPreset(preset);
        await refreshAutoStatusData();
    },

    async deletePreset(id) {
        const preset = autoStatusState.presets.find(p => p.id === id);
        if (!preset) return;
        if (!confirm(`Delete preset "${preset.name}"? Schedule entries using it will also be removed.`)) return;
        await window.electronAPI.autoStatusDeletePreset(id);
        await refreshAutoStatusData();
    },

    async testPreset(id) {
        const result = await window.electronAPI.autoStatusTestPreset(id);
        if (!result.success) {
            alert(`Test failed: ${result.error}`);
        }
        await refreshAutoStatusData();
    },

    onMessageInput(input) {
        const counter = input.parentElement.querySelector('.autostatus-char-count');
        if (counter) counter.textContent = `${input.value.length}/32`;
    },

    async addScheduleEntry() {
        const dayBtns = document.querySelectorAll('#new-schedule-days .autostatus-day-active');
        const daysOfWeek = Array.from(dayBtns).map(b => parseInt(b.dataset.day));
        const startTime = document.getElementById('new-schedule-start')?.value;
        const endTime = document.getElementById('new-schedule-end')?.value;
        const presetId = parseInt(document.getElementById('new-schedule-preset')?.value);

        if (daysOfWeek.length === 0) { alert('Select at least one day'); return; }
        if (!startTime || !endTime) { alert('Start and end times are required'); return; }
        if (isNaN(presetId)) { alert('Select a preset'); return; }

        const result = await window.electronAPI.autoStatusAddSchedule({ daysOfWeek, startTime, endTime, presetId });
        if (result.success) {
            await refreshAutoStatusData();
        } else {
            alert(`Failed to add schedule: ${result.error}`);
        }
    },

    async toggleScheduleEnabled(entryId) {
        const entry = autoStatusState.schedule.find(s => s.id === entryId);
        if (!entry) return;
        await window.electronAPI.autoStatusUpdateSchedule(entryId, { enabled: !entry.enabled });
        await refreshAutoStatusData();
    },

    async deleteScheduleEntry(entryId) {
        await window.electronAPI.autoStatusDeleteSchedule(entryId);
        await refreshAutoStatusData();
    },

    async updateSetting(key, value) {
        await window.electronAPI.autoStatusUpdateSettings({ [key]: value });
        autoStatusState.settings[key] = value;
    }
};
