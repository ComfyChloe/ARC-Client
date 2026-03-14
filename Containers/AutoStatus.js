/**
 * Auto-Status Container
 * Automatic VRChat status management via OSC parameters and time-based scheduling.
 *
 * Always active — listens for two OSC parameters:
 *   /avatar/parameters/ARCOSC/vrc-status/statuspreset (int 0-8) — triggers saved presets
 *   /avatar/parameters/ARCOSC/vrc-status (int 0-4) — sets status color directly
 * Supports a timetable schedule for time-of-day automation.
 *
 * Guards against avatar-change parameter resets with a 30-second cooldown.
 */
const debug = require('../utils/debugger');
const configManager = require('../utils/configManager');

const OSC_ADDRESS_PRESET = '/avatar/parameters/ARCOSC/vrc-status/statuspreset';
const OSC_ADDRESS_STATUS = '/avatar/parameters/ARCOSC/vrc-status';
const AVATAR_CHANGE_GUARD_MS = 30000;
const SCHEDULE_CHECK_INTERVAL_MS = 60000;
const VALID_STATUSES = [null, 'active', 'join me', 'ask me', 'busy'];
const DIRECT_STATUS_MAP = { 1: 'join me', 2: 'active', 3: 'ask me', 4: 'busy' };

class AutoStatus {
    constructor() {
        this.config = this.loadConfig();
        this.vrchatApi = null;
        this.lastAvatarChangeTime = 0;
        this.lastStatusChangeTime = 0;
        this.lastAppliedPresetId = null;
        this.lastSchedulePresetId = null;
        this.scheduleInterval = null;
        this.onStatusChange = null;
        this.lastOscValue = 0;
        debug.info('[AutoStatus] Container initialized');
    }

    loadConfig() {
        return configManager.getAutoStatusConfig();
    }

    saveConfig() {
        configManager.updateAutoStatusConfig(this.config);
    }

    /**
     * Start the AutoStatus service.
     * @param {Object} vrchatApiContainer - VRC-API container with setStatus method
     */
    start(vrchatApiContainer) {
        this.vrchatApi = vrchatApiContainer;
        this.startScheduleEngine();
        debug.info('[AutoStatus] Service started');
        return { success: true };
    }

    /**
     * Stop the AutoStatus service.
     */
    stop() {
        this.stopScheduleEngine();
        this.vrchatApi = null;
        debug.info('[AutoStatus] Service stopped');
        return { success: true };
    }

    /**
     * Notify the UI of a status change.
     */
    notifyStatusChange() {
        if (typeof this.onStatusChange === 'function') {
            this.onStatusChange(this.getStatus());
        }
    }

    /**
     * Set the callback for status change notifications.
     */
    setStatusChangeCallback(callback) {
        this.onStatusChange = callback;
    }

    /**
     * Record an avatar change to activate the 30s guard window.
     */
    recordAvatarChange() {
        this.lastAvatarChangeTime = Date.now();
        this.lastOscValue = 0;
        debug.info('[AutoStatus] Avatar change detected, status changes blocked for 30s');
    }

    /**
     * Handle an incoming OSC message.
     * Processes two addresses:
     *   /avatar/parameters/ARCOSC/vrc-status/statuspreset (int 0-8) — preset trigger
     *   /avatar/parameters/ARCOSC/vrc-status (int 0-4) — direct status color
     * @param {Object} oscData - { address, value, type }
     * @returns {boolean} true if the message was consumed by AutoStatus
     */
    handleOscMessage(oscData) {
        if (oscData.address === OSC_ADDRESS_PRESET) {
            const value = parseInt(oscData.value, 10);
            if (isNaN(value) || value < 0 || value > 8) return true;
            this.lastOscValue = value;
            if (value === 0) return true;
            if (Date.now() - this.lastAvatarChangeTime < AVATAR_CHANGE_GUARD_MS) {
                debug.info(`[AutoStatus] Ignoring OSC preset ${value} — avatar changed within 30s`);
                return true;
            }
            this.applyPreset(value, 'osc');
            return true;
        }
        if (oscData.address === OSC_ADDRESS_STATUS) {
            const value = parseInt(oscData.value, 10);
            if (isNaN(value) || value < 0 || value > 4) return true;
            if (value === 0) return true;
            if (Date.now() - this.lastAvatarChangeTime < AVATAR_CHANGE_GUARD_MS) {
                debug.info(`[AutoStatus] Ignoring OSC direct status ${value} — avatar changed within 30s`);
                return true;
            }
            this.applyDirectStatus(value);
            return true;
        }
        return false;
    }

    /**
     * Apply a direct status color change (no preset).
     * @param {number} colorIndex - 1=join me, 2=active, 3=ask me, 4=busy
     */
    async applyDirectStatus(colorIndex) {
        const statusType = DIRECT_STATUS_MAP[colorIndex];
        if (!statusType) return { success: false, error: `Invalid color index: ${colorIndex}` };
        if (!this.vrchatApi || !this.vrchatApi.isAuthenticated()) {
            debug.warn('[AutoStatus] VRChat API not available for direct status');
            return { success: false, error: 'VRChat API not available' };
        }
        const cooldown = (this.config.settings?.cooldownSeconds || 10) * 1000;
        const now = Date.now();
        if (now - this.lastStatusChangeTime < cooldown) {
            debug.info(`[AutoStatus] Cooldown active, skipping direct status ${colorIndex}`);
            return { success: false, error: 'Cooldown active' };
        }
        const result = await this.vrchatApi.setStatus(statusType, null);
        if (result.success) {
            this.lastStatusChangeTime = now;
            this.lastAppliedPresetId = null;
            debug.info(`[AutoStatus] Applied direct status: ${statusType} (color ${colorIndex})`);
            this.notifyStatusChange();
        } else {
            debug.error(`[AutoStatus] Failed to apply direct status: ${result.error}`);
        }
        return result;
    }

    /**
     * Apply a preset by its ID (1-8).
     * @param {number} presetId
     * @param {string} source - 'osc', 'schedule', or 'manual'
     * @returns {Promise<Object>}
     */
    async applyPreset(presetId, source = 'manual') {
        const preset = this.config.presets.find(p => p.id === presetId);
        if (!preset) {
            debug.warn(`[AutoStatus] Preset ${presetId} not found`);
            return { success: false, error: `Preset ${presetId} not found` };
        }
        if (!this.vrchatApi) {
            debug.warn('[AutoStatus] VRChat API not available');
            return { success: false, error: 'VRChat API not available' };
        }
        if (!this.vrchatApi.isAuthenticated()) {
            debug.warn('[AutoStatus] VRChat API not authenticated');
            return { success: false, error: 'VRChat API not authenticated' };
        }
        // Cooldown check
        const cooldown = (this.config.settings?.cooldownSeconds || 10) * 1000;
        const now = Date.now();
        if (now - this.lastStatusChangeTime < cooldown) {
            debug.info(`[AutoStatus] Cooldown active, skipping preset ${presetId}`);
            return { success: false, error: 'Cooldown active' };
        }

        const result = await this.vrchatApi.setStatus(preset.statusType || null, preset.statusMessage || null);
        if (result.success) {
            this.lastStatusChangeTime = now;
            this.lastAppliedPresetId = presetId;
            debug.info(`[AutoStatus] Applied preset ${presetId} (${preset.name}): ${preset.statusType} — source: ${source}`);
            this.notifyStatusChange();
        } else {
            debug.error(`[AutoStatus] Failed to apply preset ${presetId}: ${result.error}`);
        }
        return result;
    }

    // --- Preset Management ---

    getPresets() {
        return JSON.parse(JSON.stringify(this.config.presets));
    }

    setPreset(presetData) {
        const id = presetData.id;
        if (id < 1 || id > 8) return { success: false, error: 'Preset ID must be 1-8' };
        const statusType = presetData.statusType === '' ? null : presetData.statusType;
        if (!VALID_STATUSES.includes(statusType)) {
            return { success: false, error: `Invalid status type: ${statusType}` };
        }
        if (presetData.statusMessage && presetData.statusMessage.length > 32) {
            presetData.statusMessage = presetData.statusMessage.slice(0, 32);
        }
        const idx = this.config.presets.findIndex(p => p.id === id);
        const preset = {
            id,
            name: presetData.name || `Preset ${id}`,
            statusType,
            statusMessage: presetData.statusMessage || ''
        };
        if (idx >= 0) {
            this.config.presets[idx] = preset;
        } else {
            this.config.presets.push(preset);
        }
        this.saveConfig();
        return { success: true, preset };
    }

    deletePreset(presetId) {
        const idx = this.config.presets.findIndex(p => p.id === presetId);
        if (idx < 0) return { success: false, error: 'Preset not found' };
        this.config.presets.splice(idx, 1);
        // Remove schedule entries referencing this preset
        this.config.schedule = this.config.schedule.filter(s => s.presetId !== presetId);
        this.saveConfig();
        return { success: true };
    }

    // --- Schedule Management ---

    getSchedule() {
        return JSON.parse(JSON.stringify(this.config.schedule));
    }

    addScheduleEntry(entry) {
        if (!Array.isArray(entry.daysOfWeek) || entry.daysOfWeek.length === 0) {
            return { success: false, error: 'daysOfWeek must be a non-empty array' };
        }
        if (!entry.startTime || !entry.endTime) {
            return { success: false, error: 'startTime and endTime are required (HH:mm)' };
        }
        if (!this.config.presets.find(p => p.id === entry.presetId)) {
            return { success: false, error: `Preset ${entry.presetId} not found` };
        }
        const scheduleEntry = {
            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            daysOfWeek: entry.daysOfWeek,
            startTime: entry.startTime,
            endTime: entry.endTime,
            presetId: entry.presetId,
            enabled: entry.enabled !== false
        };
        this.config.schedule.push(scheduleEntry);
        this.saveConfig();
        return { success: true, entry: scheduleEntry };
    }

    updateScheduleEntry(entryId, updates) {
        const idx = this.config.schedule.findIndex(s => s.id === entryId);
        if (idx < 0) return { success: false, error: 'Schedule entry not found' };
        this.config.schedule[idx] = { ...this.config.schedule[idx], ...updates };
        this.saveConfig();
        return { success: true, entry: this.config.schedule[idx] };
    }

    deleteScheduleEntry(entryId) {
        const idx = this.config.schedule.findIndex(s => s.id === entryId);
        if (idx < 0) return { success: false, error: 'Schedule entry not found' };
        this.config.schedule.splice(idx, 1);
        this.saveConfig();
        return { success: true };
    }

    // --- Schedule Engine ---

    startScheduleEngine() {
        this.stopScheduleEngine();
        this.scheduleInterval = setInterval(() => this.evaluateSchedule(), SCHEDULE_CHECK_INTERVAL_MS);
        // Run an initial check shortly after starting
        setTimeout(() => this.evaluateSchedule(), 2000);
        debug.info('[AutoStatus] Schedule engine started');
    }

    stopScheduleEngine() {
        if (this.scheduleInterval) {
            clearInterval(this.scheduleInterval);
            this.scheduleInterval = null;
        }
    }

    evaluateSchedule() {
        if (!this.vrchatApi || !this.vrchatApi.isAuthenticated()) return;
        // Don't override active OSC-triggered presets
        if (this.lastOscValue > 0) return;

        const now = new Date();
        const currentDay = now.getDay(); // 0=Sun
        const currentMinutes = now.getHours() * 60 + now.getMinutes();

        for (const entry of this.config.schedule) {
            if (!entry.enabled) continue;
            if (!entry.daysOfWeek.includes(currentDay)) continue;

            const [startH, startM] = entry.startTime.split(':').map(Number);
            const [endH, endM] = entry.endTime.split(':').map(Number);
            const startMinutes = startH * 60 + startM;
            const endMinutes = endH * 60 + endM;

            let inRange;
            if (endMinutes > startMinutes) {
                // Normal range (e.g., 09:00-17:00)
                inRange = currentMinutes >= startMinutes && currentMinutes < endMinutes;
            } else {
                // Overnight range (e.g., 23:00-07:00)
                inRange = currentMinutes >= startMinutes || currentMinutes < endMinutes;
            }

            if (inRange) {
                // Don't re-apply the same schedule preset
                if (this.lastSchedulePresetId === entry.presetId) return;
                this.lastSchedulePresetId = entry.presetId;
                this.applyPreset(entry.presetId, 'schedule');
                return;
            }
        }
        // No schedule matched — clear last schedule preset so it can re-trigger
        this.lastSchedulePresetId = null;
    }

    // --- Settings ---

    getSettings() {
        return { ...this.config.settings };
    }

    updateSettings(settings) {
        this.config.settings = { ...this.config.settings, ...settings };
        this.saveConfig();
        return { success: true, settings: this.config.settings };
    }

    // --- Status ---

    getStatus() {
        return {
            lastAppliedPresetId: this.lastAppliedPresetId,
            lastStatusChangeTime: this.lastStatusChangeTime,
            lastOscValue: this.lastOscValue,
            scheduleRunning: !!this.scheduleInterval,
            presetCount: this.config.presets.length,
            scheduleCount: this.config.schedule.length,
            avatarGuardActive: Date.now() - this.lastAvatarChangeTime < AVATAR_CHANGE_GUARD_MS,
            vrchatApiAvailable: !!(this.vrchatApi && this.vrchatApi.isAuthenticated())
        };
    }

    /**
     * Full cleanup.
     */
    close() {
        this.stop();
        debug.info('[AutoStatus] Container closed');
    }
}

module.exports = AutoStatus;
