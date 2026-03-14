/**
 * Auto-Status UI Module
 * Handles VRChat auto-status preset management, schedule timetable, and status display.
 */

const STATUS_TYPES = [
    { value: null, label: 'None (message only)', color: '#888888', icon: '⚫' },
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

// --- Custom Confirm Modal ---

function showConfirmModal(title, message) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal-content">
                <div class="modal-header"><h3>${title}</h3></div>
                <div class="modal-body"><p>${message}</p></div>
                <div class="modal-footer" style="display:flex;gap:10px;justify-content:flex-end;">
                    <button class="btn btn-secondary" id="autostatus-modal-cancel">Cancel</button>
                    <button class="btn btn-primary" id="autostatus-modal-confirm" style="background:#e74c3c;border-color:#e74c3c;">Delete</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.querySelector('#autostatus-modal-confirm').addEventListener('click', () => {
            overlay.remove();
            resolve(true);
        });
        overlay.querySelector('#autostatus-modal-cancel').addEventListener('click', () => {
            overlay.remove();
            resolve(false);
        });
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                overlay.remove();
                resolve(false);
            }
        });
    });
}

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
                ${s.externallySet ? '<span class="autostatus-badge autostatus-badge-warn">External Status</span>' : ''}
                ${guardActive ? '<span class="autostatus-badge autostatus-badge-warn">Avatar Guard</span>' : ''}
                <span class="autostatus-badge ${apiAvailable ? 'autostatus-badge-ok' : 'autostatus-badge-err'}">${apiAvailable ? 'API Ready' : 'API Offline'}</span>
                <span class="autostatus-badge autostatus-badge-info">OSC: ${s.lastOscValue || 0}</span>
            </div>
        </div>
    `;
}

// --- Presets Section ---

function renderPresetsSection() {
    const presets = autoStatusState.presets;
    const count = presets.length;
    let content;
    if (count === 0) {
        content = `
            <div class="autostatus-presets-empty">
                <div class="autostatus-presets-empty-icon">⚙️</div>
                <p>No status presets configured yet.</p>
                <p><small>Add a preset to get started with automatic status changes.</small></p>
                <button class="btn btn-primary" onclick="AutoStatusUI.createPreset()">+ Add Preset</button>
            </div>
        `;
    } else {
        const cards = presets.map(p => renderPresetCard(p.id, p)).join('');
        const addBtn = count < 8
            ? `<div class="autostatus-preset-add-card" onclick="AutoStatusUI.createPreset()"><span>+ Add Preset</span></div>`
            : '';
        content = `<div class="autostatus-presets-grid">${cards}${addBtn}</div>`;
    }
    return `
        <div class="autostatus-section">
            <div class="autostatus-section-header">
                <h3>Status Presets</h3>
                <span class="autostatus-section-hint">Configure up to 8 presets triggered by OSC parameter (int 1–8)</span>
            </div>
            ${content}
        </div>
    `;
}

function renderPresetCard(id, preset) {
    const isActive = autoStatusState.status.lastAppliedPresetId === id;
    const statusType = preset ? STATUS_TYPES.find(t => t.value === preset.statusType) : null;
    const statusOptions = STATUS_TYPES.map(t => {
        const optValue = t.value === null ? '' : t.value;
        const isSelected = preset && ((t.value === null && (preset.statusType === null || preset.statusType === '')) || t.value === preset.statusType);
        return `<option value="${optValue}" ${isSelected ? 'selected' : ''}>${t.icon} ${t.label}</option>`;
    }).join('');

    return `
        <div class="autostatus-preset-card ${isActive ? 'autostatus-preset-active' : ''}" data-preset-id="${id}" style="--preset-accent: ${statusType?.color || '#888888'}">
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
                    <div class="autostatus-field">
                        <label>Name</label>
                        <input type="text" id="new-schedule-name" placeholder="Schedule name (optional)" maxlength="32">
                    </div>
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
                    <div class="autostatus-field">
                        <label>Fallback</label>
                        <select id="new-schedule-fallback">
                            <option value="">None</option>
                            ${STATUS_TYPES.filter(t => t.value !== null).map(t => `<option value="${t.value}">${t.icon} ${t.label}</option>`).join('')}
                        </select>
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
    const displayName = entry.name || 'Untitled';

    return `
        <div class="autostatus-schedule-row ${!entry.enabled ? 'autostatus-schedule-disabled' : ''}" data-entry-id="${entry.id}">
            <div class="autostatus-schedule-color" style="background: ${statusType?.color || '#95a5a6'}"></div>
            <div class="autostatus-schedule-details">
                <div class="autostatus-schedule-name" onclick="AutoStatusUI.editScheduleName('${entry.id}', this)" title="Click to rename">${displayName}</div>
                <div class="autostatus-schedule-time">${entry.startTime} — ${entry.endTime} ${isOvernight ? '<small>(overnight)</small>' : ''}</div>
                <div class="autostatus-schedule-days">${days}</div>
                <div class="autostatus-schedule-fallback">
                    <label>Fallback:</label>
                    <select class="autostatus-fallback-select" onchange="AutoStatusUI.updateScheduleFallback('${entry.id}', this.value)">
                        <option value="">None</option>
                        ${STATUS_TYPES.filter(t => t.value !== null).map(t => `<option value="${t.value}" ${entry.fallbackStatusType === t.value ? 'selected' : ''}>${t.icon} ${t.label}</option>`).join('')}
                    </select>
                </div>
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
                    <div class="autostatus-field">
                        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
                            <input type="checkbox" ${settings.alwaysAllowOverride ? 'checked' : ''} onchange="AutoStatusUI.updateSetting('alwaysAllowOverride', this.checked)" style="width:auto;margin:0;">
                            Always allow status override
                        </label>
                        <small>When enabled, ARC will change your status even if it was set externally (via VRChat website or in-game). When disabled, ARC pauses automatic status changes until the next manual or OSC trigger.</small>
                    </div>
                </div>
                <div class="autostatus-info-box">
                    <strong>OSC Parameters:</strong><br>
                    <div class="autostatus-osc-params">
                        <div class="autostatus-osc-param">
                            <code>/avatar/parameters/ARCOSC/vrc-status/statuspreset</code> <small>(Int, 0–8)</small><br>
                            <small>Value 0 = no action. Values 1–8 trigger the corresponding preset.</small>
                        </div>
                        <div class="autostatus-osc-param">
                            <code>/avatar/parameters/ARCOSC/vrc-status</code> <small>(Int, 0–4)</small><br>
                            <small>0 = off, 1 = 🔵 Join Me, 2 = 🟢 Online, 3 = 🟠 Ask Me, 4 = 🔴 Do Not Disturb</small>
                        </div>
                    </div>
                    <small>Status changes are blocked for 30 seconds after avatar changes.</small>
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
    async createPreset() {
        // Find next unused ID in 1-8
        const usedIds = autoStatusState.presets.map(p => p.id);
        let nextId = null;
        for (let i = 1; i <= 8; i++) {
            if (!usedIds.includes(i)) { nextId = i; break; }
        }
        if (nextId === null) return;
        const result = await window.electronAPI.autoStatusSetPreset({
            id: nextId,
            name: `Preset ${nextId}`,
            statusType: 'active',
            statusMessage: ''
        });
        if (result.success) await refreshAutoStatusData();
    },

    async updatePresetField(id, field, value) {
        const preset = autoStatusState.presets.find(p => p.id === id);
        if (!preset) return;
        if (field === 'statusType') {
            preset[field] = value === '' ? null : value;
        } else {
            preset[field] = value;
        }
        const result = await window.electronAPI.autoStatusSetPreset(preset);
        if (result.success) {
            autoStatusState.presets = (await window.electronAPI.autoStatusGetConfig()).presets || [];
            renderAutoStatusUI();
        }
    },

    async deletePreset(id) {
        const preset = autoStatusState.presets.find(p => p.id === id);
        if (!preset) return;
        const confirmed = await showConfirmModal('Delete Preset', `Delete preset "${preset.name}"? Schedule entries using it will also be removed.`);
        if (!confirmed) return;
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
        const name = document.getElementById('new-schedule-name')?.value || '';
        const fallbackStatusType = document.getElementById('new-schedule-fallback')?.value || null;

        if (daysOfWeek.length === 0) { alert('Select at least one day'); return; }
        if (!startTime || !endTime) { alert('Start and end times are required'); return; }
        if (isNaN(presetId)) { alert('Select a preset'); return; }

        const result = await window.electronAPI.autoStatusAddSchedule({ daysOfWeek, startTime, endTime, presetId, name, fallbackStatusType });
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

    editScheduleName(entryId, el) {
        const entry = autoStatusState.schedule.find(s => s.id === entryId);
        if (!entry) return;
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'autostatus-schedule-name-input';
        input.value = entry.name || '';
        input.placeholder = 'Schedule name';
        input.maxLength = 32;
        const save = async () => {
            const newName = input.value.trim();
            await window.electronAPI.autoStatusUpdateSchedule(entryId, { name: newName });
            await refreshAutoStatusData();
        };
        input.addEventListener('blur', save);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
            if (e.key === 'Escape') { input.removeEventListener('blur', save); el.textContent = entry.name || 'Untitled'; }
        });
        el.textContent = '';
        el.appendChild(input);
        input.focus();
        input.select();
    },

    async updateScheduleFallback(entryId, value) {
        const fallbackStatusType = value || null;
        await window.electronAPI.autoStatusUpdateSchedule(entryId, { fallbackStatusType });
        const entry = autoStatusState.schedule.find(s => s.id === entryId);
        if (entry) entry.fallbackStatusType = fallbackStatusType;
    },

    async updateSetting(key, value) {
        await window.electronAPI.autoStatusUpdateSettings({ [key]: value });
        autoStatusState.settings[key] = value;
    }
};
