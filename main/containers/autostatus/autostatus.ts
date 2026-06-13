/**
 * Auto-Status Container
 * Automatic VRChat status management via OSC parameters, time-based scheduling,
 * and location-based rules (via VRChat log-watcher or VRCX fallback).
 *
 * Always active — listens for two OSC parameters:
 *   /avatar/parameters/ARCOSC/vrc-status/statuspreset (int 0-8) — triggers saved presets
 *   /avatar/parameters/ARCOSC/vrc-status (int 0-4) — sets status color directly
 * Supports a timetable schedule for time-of-day automation.
 * Supports location rules matched against world/group/instance type.
 *
 * Guards against avatar-change parameter resets with a 30-second cooldown.
 */
import debug from '../../services/debugger'
import configManager from '../../services/configManager'
import LocationTracker, { type LocationState } from './locationTracker'

interface AutoStatusPreset {
    id: number
    name: string
    statusType: string | null
    statusMessage: string
}

interface AutoStatusScheduleEntry {
    id: string
    name: string
    daysOfWeek: number[]
    startTime: string
    endTime: string
    presetId: number
    fallbackStatusType: string | null
    enabled: boolean
}

interface AutoStatusSettings {
    cooldownSeconds?: number
    alwaysAllowOverride?: boolean
    returnToInitial?: boolean
    prioritySource?: 'schedule' | 'location'
}

interface LocationRule {
    id: string
    name: string
    enabled: boolean
    presetId: number
    matchWorld: string
    matchWorldMode: 'contains' | 'exact'
    matchGroup: string
    matchGroupMode: 'contains' | 'exact'
    matchAccessTypes: string[]
    fallbackStatusType: string | null
}

interface AutoStatusConfig {
    presets: AutoStatusPreset[]
    schedule: AutoStatusScheduleEntry[]
    locationRules: LocationRule[]
    settings: AutoStatusSettings
}

interface OscData {
    address: string
    value: unknown
    type?: string
}

interface VRChatApiContainer {
    isAuthenticated(): boolean
    getCurrentUserStatus(): { status: string | null, statusDescription: string | null }
    setStatus(statusType: string | null, message: string | null): Promise<{ success: boolean, error?: string }>
}

const OSC_ADDRESS_PRESET = '/avatar/parameters/ARCOSC/vrc-status/statuspreset'
const OSC_ADDRESS_STATUS = '/avatar/parameters/ARCOSC/vrc-status'
const AVATAR_CHANGE_GUARD_MS = 30000
const ARC_STATUS_ECHO_IGNORE_MS = 10000
const SCHEDULE_CHECK_INTERVAL_MS = 60000
const VALID_STATUSES: (string | null)[] = [null, 'active', 'join me', 'ask me', 'busy']
const DIRECT_STATUS_MAP: Record<number, string> = { 1: 'join me', 2: 'active', 3: 'ask me', 4: 'busy' }

class AutoStatus {
    config: AutoStatusConfig
    vrchatApi: VRChatApiContainer | null
    lastAvatarChangeTime: number
    lastStatusChangeTime: number
    lastAppliedPresetId: number | null
    lastSchedulePresetId: number | null
    scheduleInterval: ReturnType<typeof setInterval> | null
    guardExpiryTimeout: ReturnType<typeof setTimeout> | null
    onStatusChange: ((status: unknown) => void) | null
    lastOscValue: number
    externallySet: boolean
    hasLastSetStatus: boolean
    lastSetStatus: string | null
    lastSetStatusDescription: string | null
    lastArcStatusSetAt: number
    currentStatus: string | null
    currentStatusDescription: string | null
    lastActiveScheduleEntryId: string | null
    initialStatus: string | null
    initialStatusDescription: string | null
    locationTracker: LocationTracker
    lastLocationMatchedRuleId: string | null

    constructor() {
        this.config = this.loadConfig()
        this.vrchatApi = null
        this.lastAvatarChangeTime = 0
        this.lastStatusChangeTime = 0
        this.lastAppliedPresetId = null
        this.lastSchedulePresetId = null
        this.scheduleInterval = null
        this.guardExpiryTimeout = null
        this.onStatusChange = null
        this.lastOscValue = 0
        // External status tracking
        this.externallySet = false
        this.hasLastSetStatus = false
        this.lastSetStatus = null
        this.lastSetStatusDescription = null
        this.lastArcStatusSetAt = 0
        this.currentStatus = null
        this.currentStatusDescription = null
        this.lastActiveScheduleEntryId = null
        // Initial status tracking
        this.initialStatus = null
        this.initialStatusDescription = null
        // Location tracking
        this.locationTracker = new LocationTracker()
        this.lastLocationMatchedRuleId = null
        debug.info('[AutoStatus] Container initialized')
    }

    recordArcStatusSet(status: string | null, statusDescription: string | null, timestamp: number): void {
        this.hasLastSetStatus = true
        this.lastSetStatus = status
        this.lastSetStatusDescription = statusDescription
        this.lastArcStatusSetAt = timestamp
        this.currentStatus = status
        this.currentStatusDescription = statusDescription
    }

    getResultStatusValues(result: Record<string, unknown>, fallbackStatus: string | null, fallbackDescription: string | null): { status: string | null, statusDescription: string | null } {
        const nextStatus = typeof result.newStatus === 'string'
            ? result.newStatus
            : result.newStatus === null
                ? null
                : fallbackStatus
        const nextDescription = typeof result.newStatusDescription === 'string'
            ? result.newStatusDescription
            : result.newStatusDescription === null
                ? null
                : fallbackDescription
        return {
            status: nextStatus,
            statusDescription: nextDescription
        }
    }

    normalizeConfig(config: AutoStatusConfig): AutoStatusConfig {
        return {
            presets: Array.isArray(config.presets)
                ? config.presets
                    .map((preset) => ({
                        ...preset,
                        id: Number(preset.id)
                    }))
                    .filter((preset) => Number.isInteger(preset.id) && preset.id >= 1 && preset.id <= 8)
                : [],
            schedule: Array.isArray(config.schedule)
                ? config.schedule.map((entry) => ({
                    ...entry,
                    presetId: Number(entry.presetId),
                    daysOfWeek: Array.isArray(entry.daysOfWeek)
                        ? entry.daysOfWeek.map((day) => Number(day)).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
                        : []
                }))
                : [],
            locationRules: Array.isArray(config.locationRules)
                ? config.locationRules.map((rule) => ({
                    ...rule,
                    presetId: Number(rule.presetId),
                    matchWorldMode: rule.matchWorldMode || 'contains',
                    matchGroupMode: rule.matchGroupMode || 'contains'
                }))
                : [],
            settings: config.settings || {}
        }
    }

    loadConfig(): AutoStatusConfig {
        return this.normalizeConfig(configManager.getAutoStatusConfig() as unknown as AutoStatusConfig)
    }

    saveConfig(): void {
        this.config = this.normalizeConfig(this.config)
        configManager.updateAutoStatusConfig(this.config as unknown as Record<string, unknown>)
    }

    /**
     * Start the AutoStatus service.
     * @param {Object} vrchatApiContainer - VRC-API container with setStatus method
     */
    start(vrchatApiContainer: VRChatApiContainer): { success: boolean } {
        this.vrchatApi = vrchatApiContainer
        if (vrchatApiContainer.isAuthenticated()) {
            const currentStatus = vrchatApiContainer.getCurrentUserStatus()
            this.syncCurrentStatus(currentStatus.status, currentStatus.statusDescription)
            // Capture the initial status before ARC makes any changes
            if (this.initialStatus === null) {
                this.initialStatus = currentStatus.status
                this.initialStatusDescription = currentStatus.statusDescription
            }
        }
        this.startScheduleEngine()
        this.startLocationTracker()
        debug.info('[AutoStatus] Service started')
        return { success: true }
    }

    /**
     * Stop the AutoStatus service.
     */
    stop(): { success: boolean } {
        this.stopScheduleEngine()
        this.stopLocationTracker()
        this.stopGuardExpiryTimeout()
        this.vrchatApi = null
        debug.info('[AutoStatus] Service stopped')
        return { success: true }
    }

    /**
     * Notify the UI of a status change.
     */
    notifyStatusChange(): void {
        if (typeof this.onStatusChange === 'function') {
            this.onStatusChange(this.getStatus())
        }
    }

    syncCurrentStatus(status: string | null, statusDescription: string | null): void {
        this.currentStatus = status ?? null
        this.currentStatusDescription = statusDescription ?? null
        this.notifyStatusChange()
    }

    /**
     * Set the callback for status change notifications.
     */
    setStatusChangeCallback(callback: (status: unknown) => void): void {
        this.onStatusChange = callback
    }

    /**
     * Record an avatar change to activate the 30s guard window.
     */
    recordAvatarChange(): void {
        this.lastAvatarChangeTime = Date.now()
        this.lastOscValue = 0
        debug.info('[AutoStatus] Avatar change detected, status changes blocked for 30s')
        this.notifyStatusChange()
        this.startGuardExpiryTimeout()
    }

    /**
     * Schedule a single update when the avatar guard expires.
     */
    startGuardExpiryTimeout(): void {
        this.stopGuardExpiryTimeout()
        this.guardExpiryTimeout = setTimeout(() => {
            this.guardExpiryTimeout = null
            this.notifyStatusChange()
        }, AVATAR_CHANGE_GUARD_MS + 50)
    }

    /**
     * Stop the pending avatar guard expiry update.
     */
    stopGuardExpiryTimeout(): void {
        if (this.guardExpiryTimeout) {
            clearTimeout(this.guardExpiryTimeout)
            this.guardExpiryTimeout = null
        }
    }

    /**
     * Handle an external status change detected via VRChat pipeline.
     * Compares incoming status against what ARC last set to determine
     * whether the change was made externally (website, in-game).
     * @param {string|null} newStatus - Current VRChat status type
     * @param {string|null} newStatusDescription - Current VRChat status message
     */
    handleExternalStatusChange(newStatus: string | null, newStatusDescription: string | null): void {
        const normalizedStatus = newStatus ?? null
        const normalizedDescription = newStatusDescription ?? null
        this.currentStatus = normalizedStatus
        this.currentStatusDescription = normalizedDescription
        const withinArcEchoWindow = Date.now() - this.lastArcStatusSetAt <= ARC_STATUS_ECHO_IGNORE_MS
        const matchesLastSetStatus = normalizedStatus === this.lastSetStatus
        const matchesLastSetDescription = normalizedDescription === this.lastSetStatusDescription

        if (withinArcEchoWindow && matchesLastSetStatus && matchesLastSetDescription) {
            if (this.externallySet) {
                this.externallySet = false
                this.notifyStatusChange()
            }
            debug.info(`[AutoStatus] Ignoring VRChat API status echo from ARC-set status: ${normalizedStatus} — "${normalizedDescription || ''}"`)
            return
        }

        const statusDiffers = normalizedStatus !== this.lastSetStatus
        const descDiffers = normalizedDescription !== this.lastSetStatusDescription
        if (statusDiffers || descDiffers) {
            this.externallySet = true
            debug.info(`[AutoStatus] External status change detected: ${normalizedStatus} — "${normalizedDescription || ''}" (ARC last set: ${this.lastSetStatus} — "${this.lastSetStatusDescription || ''}")`)
            this.notifyStatusChange()
        } else if (this.externallySet) {
            this.externallySet = false
            this.notifyStatusChange()
        }
    }

    /**
     * Handle an incoming OSC message.
     * Processes two addresses:
     *   /avatar/parameters/ARCOSC/vrc-status/statuspreset (int 0-8) — preset trigger
     *   /avatar/parameters/ARCOSC/vrc-status (int 0-4) — direct status color
     * @returns {boolean} true if the message was consumed by AutoStatus
     */
    handleOscMessage(oscData: OscData): boolean {
        if (oscData.address === OSC_ADDRESS_PRESET) {
            const value = parseInt(oscData.value as string, 10)
            if (isNaN(value) || value < 0 || value > 8) return true
            this.lastOscValue = value
            if (value === 0) return true
            if (Date.now() - this.lastAvatarChangeTime < AVATAR_CHANGE_GUARD_MS) {
                debug.info(`[AutoStatus] Ignoring OSC preset ${value} — avatar changed within 30s`)
                return true
            }
            // OSC trigger is intentional user action — clear external flag
            this.externallySet = false
            this.applyPreset(value, 'osc')
            return true
        }
        if (oscData.address === OSC_ADDRESS_STATUS) {
            const value = parseInt(oscData.value as string, 10)
            if (isNaN(value) || value < 0 || value > 4) return true
            if (value === 0) return true
            if (Date.now() - this.lastAvatarChangeTime < AVATAR_CHANGE_GUARD_MS) {
                debug.info(`[AutoStatus] Ignoring OSC direct status ${value} — avatar changed within 30s`)
                return true
            }
            // OSC trigger is intentional user action — clear external flag
            this.externallySet = false
            this.applyDirectStatus(value)
            return true
        }
        return false
    }

    /**
     * Apply a direct status color change (no preset).
     * @param {number} colorIndex - 1=join me, 2=active, 3=ask me, 4=busy
     */
    async applyDirectStatus(colorIndex: number): Promise<{ success: boolean, error?: string }> {
        const statusType = DIRECT_STATUS_MAP[colorIndex]
        if (!statusType) return { success: false, error: `Invalid color index: ${colorIndex}` }
        if (!this.vrchatApi || !this.vrchatApi.isAuthenticated()) {
            debug.warn('[AutoStatus] VRChat API not available for direct status')
            return { success: false, error: 'VRChat API not available' }
        }
        // External override protection
        if (this.externallySet && !this.config.settings?.alwaysAllowOverride) {
            debug.info(`[AutoStatus] Skipping direct status ${colorIndex} — status was changed externally`)
            return { success: false, error: 'Status was changed externally' }
        }
        const cooldown = (this.config.settings?.cooldownSeconds || 10) * 1000
        const now = Date.now()
        if (now - this.lastStatusChangeTime < cooldown) {
            debug.info(`[AutoStatus] Cooldown active, skipping direct status ${colorIndex}`)
            return { success: false, error: 'Cooldown active' }
        }
        const result = await this.vrchatApi.setStatus(statusType, null)
        if (result.success) {
            const applied = this.getResultStatusValues(result, statusType, this.currentStatusDescription)
            this.lastStatusChangeTime = now
            this.lastAppliedPresetId = null
            this.recordArcStatusSet(applied.status, applied.statusDescription, now)
            debug.info(`[AutoStatus] Applied direct status: ${statusType} (color ${colorIndex})`)
            this.notifyStatusChange()
        } else {
            debug.error(`[AutoStatus] Failed to apply direct status: ${result.error}`)
        }
        return result
    }

    /**
     * Apply a preset by its ID (1-8).
     * @param {number} presetId
     * @param {string} source - 'osc', 'schedule', or 'manual'
     * @returns {Promise<Object>}
     */
    async applyPreset(presetId: number, source: string = 'manual'): Promise<{ success: boolean, error?: string }> {
        const normalizedPresetId = Number(presetId)
        const preset = this.config.presets.find(p => p.id === normalizedPresetId)
        if (!preset) {
            debug.warn(`[AutoStatus] Preset ${normalizedPresetId} not found`)
            return { success: false, error: `Preset ${normalizedPresetId} not found` }
        }
        if (!this.vrchatApi) {
            debug.warn('[AutoStatus] VRChat API not available')
            return { success: false, error: 'VRChat API not available' }
        }
        if (!this.vrchatApi.isAuthenticated()) {
            debug.warn('[AutoStatus] VRChat API not authenticated')
            return { success: false, error: 'VRChat API not authenticated' }
        }
        // Manual trigger is intentional user action — clear external flag
        if (source === 'manual') {
            this.externallySet = false
        }
        // External override protection (skip for manual triggers)
        if (source !== 'manual' && this.externallySet && !this.config.settings?.alwaysAllowOverride) {
            debug.info(`[AutoStatus] Skipping preset ${normalizedPresetId} — status was changed externally (source: ${source})`)
            return { success: false, error: 'Status was changed externally' }
        }
        // Cooldown check
        const cooldown = (this.config.settings?.cooldownSeconds || 10) * 1000
        const now = Date.now()
        if (now - this.lastStatusChangeTime < cooldown) {
            debug.info(`[AutoStatus] Cooldown active, skipping preset ${normalizedPresetId}`)
            return { success: false, error: 'Cooldown active' }
        }

        const result = await this.vrchatApi.setStatus(preset.statusType || null, preset.statusMessage || null)
        if (result.success) {
            const applied = this.getResultStatusValues(result, preset.statusType || null, preset.statusMessage || null)
            this.lastStatusChangeTime = now
            this.lastAppliedPresetId = normalizedPresetId
            this.recordArcStatusSet(applied.status, applied.statusDescription, now)
            debug.info(`[AutoStatus] Applied preset ${normalizedPresetId} (${preset.name}): ${preset.statusType} — source: ${source}`)
            this.notifyStatusChange()
        } else {
            debug.error(`[AutoStatus] Failed to apply preset ${normalizedPresetId}: ${result.error}`)
        }
        return result
    }

    // --- Preset Management ---

    getPresets(): AutoStatusPreset[] {
        this.config = this.normalizeConfig(this.config)
        return JSON.parse(JSON.stringify(this.config.presets))
    }

    setPreset(presetData: AutoStatusPreset): { success: boolean, error?: string, preset?: AutoStatusPreset } {
        const id = Number(presetData.id)
        if (id < 1 || id > 8) return { success: false, error: 'Preset ID must be 1-8' }
        const statusType = presetData.statusType === '' ? null : presetData.statusType
        if (!VALID_STATUSES.includes(statusType)) {
            return { success: false, error: `Invalid status type: ${statusType}` }
        }
        if (presetData.statusMessage && presetData.statusMessage.length > 32) {
            presetData.statusMessage = presetData.statusMessage.slice(0, 32)
        }
        const idx = this.config.presets.findIndex(p => p.id === id)
        const preset: AutoStatusPreset = {
            id,
            name: presetData.name || `Preset ${id}`,
            statusType,
            statusMessage: presetData.statusMessage || ''
        }
        if (idx >= 0) {
            this.config.presets[idx] = preset
        } else {
            this.config.presets.push(preset)
        }
        this.saveConfig()
        return { success: true, preset }
    }

    deletePreset(presetId: number): { success: boolean, error?: string } {
        const normalizedPresetId = Number(presetId)
        const idx = this.config.presets.findIndex(p => p.id === normalizedPresetId)
        if (idx < 0) return { success: false, error: 'Preset not found' }
        this.config.presets.splice(idx, 1)
        // Remove schedule entries referencing this preset
        this.config.schedule = this.config.schedule.filter(s => s.presetId !== normalizedPresetId)
        // Remove location rules referencing this preset
        this.config.locationRules = this.config.locationRules.filter(r => r.presetId !== normalizedPresetId)
        this.saveConfig()
        return { success: true }
    }

    // --- Schedule Management ---

    getSchedule(): AutoStatusScheduleEntry[] {
        this.config = this.normalizeConfig(this.config)
        return JSON.parse(JSON.stringify(this.config.schedule))
    }

    addScheduleEntry(entry: Omit<AutoStatusScheduleEntry, 'id'>): { success: boolean, error?: string, entry?: AutoStatusScheduleEntry } {
        if (!Array.isArray(entry.daysOfWeek) || entry.daysOfWeek.length === 0) {
            return { success: false, error: 'daysOfWeek must be a non-empty array' }
        }
        if (!entry.startTime || !entry.endTime) {
            return { success: false, error: 'startTime and endTime are required (HH:mm)' }
        }
        const normalizedPresetId = Number(entry.presetId)
        if (!this.config.presets.find(p => p.id === normalizedPresetId)) {
            return { success: false, error: `Preset ${normalizedPresetId} not found` }
        }
        const scheduleEntry: AutoStatusScheduleEntry = {
            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            name: entry.name || '',
            daysOfWeek: entry.daysOfWeek,
            startTime: entry.startTime,
            endTime: entry.endTime,
            presetId: normalizedPresetId,
            fallbackStatusType: entry.fallbackStatusType || null,
            enabled: entry.enabled !== false
        }
        this.config.schedule.push(scheduleEntry)
        this.saveConfig()
        return { success: true, entry: scheduleEntry }
    }

    updateScheduleEntry(entryId: string, updates: Partial<AutoStatusScheduleEntry>): { success: boolean, error?: string, entry?: AutoStatusScheduleEntry } {
        const idx = this.config.schedule.findIndex(s => s.id === entryId)
        if (idx < 0) return { success: false, error: 'Schedule entry not found' }
        const normalizedUpdates = {
            ...updates,
            ...(updates.presetId !== undefined ? { presetId: Number(updates.presetId) } : {})
        }
        this.config.schedule[idx] = { ...this.config.schedule[idx], ...normalizedUpdates }
        this.saveConfig()
        return { success: true, entry: this.config.schedule[idx] }
    }

    deleteScheduleEntry(entryId: string): { success: boolean, error?: string } {
        const idx = this.config.schedule.findIndex(s => s.id === entryId)
        if (idx < 0) return { success: false, error: 'Schedule entry not found' }
        this.config.schedule.splice(idx, 1)
        this.saveConfig()
        return { success: true }
    }

    // --- Schedule Engine ---

    startScheduleEngine(): void {
        this.stopScheduleEngine()
        this.scheduleInterval = setInterval(() => this.evaluateSchedule(), SCHEDULE_CHECK_INTERVAL_MS)
        // Run an initial check shortly after starting
        setTimeout(() => this.evaluateSchedule(), 2000)
        debug.info('[AutoStatus] Schedule engine started')
    }

    stopScheduleEngine(): void {
        if (this.scheduleInterval) {
            clearInterval(this.scheduleInterval)
            this.scheduleInterval = null
        }
    }

    evaluateSchedule(): void {
        if (!this.vrchatApi || !this.vrchatApi.isAuthenticated()) return
        // Don't override active OSC-triggered presets
        if (this.lastOscValue > 0) return
        // Don't override externally set status
        if (this.externallySet && !this.config.settings?.alwaysAllowOverride) return

        const prioritySource = this.config.settings?.prioritySource || 'schedule'
        // If location has priority and a location rule is active, schedule defers
        if (prioritySource === 'location' && this.lastLocationMatchedRuleId !== null) return

        const now = new Date()
        const currentDay = now.getDay() // 0=Sun
        const currentMinutes = now.getHours() * 60 + now.getMinutes()

        for (const entry of this.config.schedule) {
            if (!entry.enabled) continue
            if (!entry.daysOfWeek.includes(currentDay)) continue

            const [startH, startM] = entry.startTime.split(':').map(Number)
            const [endH, endM] = entry.endTime.split(':').map(Number)
            const startMinutes = startH * 60 + startM
            const endMinutes = endH * 60 + endM

            let inRange: boolean
            if (endMinutes > startMinutes) {
                // Normal range (e.g., 09:00-17:00)
                inRange = currentMinutes >= startMinutes && currentMinutes < endMinutes
            } else {
                // Overnight range (e.g., 23:00-07:00)
                inRange = currentMinutes >= startMinutes || currentMinutes < endMinutes
            }

            if (inRange) {
                const alreadyActive = this.lastSchedulePresetId === entry.presetId && this.lastActiveScheduleEntryId === entry.id
                if (!alreadyActive) {
                    this.lastActiveScheduleEntryId = entry.id
                    this.lastSchedulePresetId = entry.presetId
                    this.applyPreset(entry.presetId, 'schedule')
                }
                return
            }
        }
        // No schedule matched — a timed entry just ended
        if (this.lastActiveScheduleEntryId !== null) {
            const prevEntry = this.config.schedule.find(s => s.id === this.lastActiveScheduleEntryId)
            const fallback = prevEntry?.fallbackStatusType || null
            this.lastActiveScheduleEntryId = null
            this.lastSchedulePresetId = null
            if (this.config.settings?.returnToInitial) {
                this._returnToInitialStatus('schedule')
            } else if (fallback) {
                this._applyFallbackStatus(fallback)
            }
            return
        }
        this.lastSchedulePresetId = null
    }

    async _applyFallbackStatus(statusType: string): Promise<void> {
        if (!this.vrchatApi || !this.vrchatApi.isAuthenticated()) return
        if (this.externallySet && !this.config.settings?.alwaysAllowOverride) return
        const cooldown = (this.config.settings?.cooldownSeconds || 10) * 1000
        const now = Date.now()
        if (now - this.lastStatusChangeTime < cooldown) {
            debug.info(`[AutoStatus] Cooldown active, skipping fallback status ${statusType}`)
            return
        }
        const result = await this.vrchatApi.setStatus(statusType, null)
        if (result.success) {
            const now = Date.now()
            const applied = this.getResultStatusValues(result, statusType, this.currentStatusDescription)
            this.lastStatusChangeTime = now
            this.lastAppliedPresetId = null
            this.recordArcStatusSet(applied.status, applied.statusDescription, now)
            debug.info(`[AutoStatus] Applied fallback status: ${statusType}`)
            this.notifyStatusChange()
        } else {
            debug.error(`[AutoStatus] Failed to apply fallback status: ${result.error}`)
        }
    }

    async _returnToInitialStatus(source: string): Promise<void> {
        if (!this.vrchatApi || !this.vrchatApi.isAuthenticated()) return
        if (this.externallySet && !this.config.settings?.alwaysAllowOverride) return
        if (this.initialStatus === null && this.initialStatusDescription === null) return
        const cooldown = (this.config.settings?.cooldownSeconds || 10) * 1000
        const now = Date.now()
        if (now - this.lastStatusChangeTime < cooldown) {
            debug.info(`[AutoStatus] Cooldown active, skipping return-to-initial from ${source}`)
            return
        }
        const result = await this.vrchatApi.setStatus(this.initialStatus, this.initialStatusDescription)
        if (result.success) {
            const applied = this.getResultStatusValues(result, this.initialStatus, this.initialStatusDescription)
            this.lastStatusChangeTime = now
            this.lastAppliedPresetId = null
            this.recordArcStatusSet(applied.status, applied.statusDescription, now)
            debug.info(`[AutoStatus] Returned to initial status from ${source}: ${this.initialStatus} — "${this.initialStatusDescription || ''}"`)
            this.notifyStatusChange()
        } else {
            debug.error(`[AutoStatus] Failed to return to initial status: ${result.error}`)
        }
    }

    // --- Location Rule Management ---

    getLocationRules(): LocationRule[] {
        this.config = this.normalizeConfig(this.config)
        return JSON.parse(JSON.stringify(this.config.locationRules))
    }

    addLocationRule(rule: Omit<LocationRule, 'id'>): { success: boolean, error?: string, rule?: LocationRule } {
        const normalizedPresetId = Number(rule.presetId) || 0
        const newRule: LocationRule = {
            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            name: rule.name || '',
            enabled: rule.enabled !== false,
            presetId: normalizedPresetId,
            matchWorld: rule.matchWorld || '',
            matchWorldMode: rule.matchWorldMode || 'contains',
            matchGroup: rule.matchGroup || '',
            matchGroupMode: rule.matchGroupMode || 'contains',
            matchAccessTypes: Array.isArray(rule.matchAccessTypes) ? rule.matchAccessTypes : [],
            fallbackStatusType: rule.fallbackStatusType || null
        }
        this.config.locationRules.push(newRule)
        this.saveConfig()
        this.syncLocationTracker()
        return { success: true, rule: newRule }
    }

    updateLocationRule(ruleId: string, updates: Partial<LocationRule>): { success: boolean, error?: string, rule?: LocationRule } {
        const idx = this.config.locationRules.findIndex(r => r.id === ruleId)
        if (idx < 0) return { success: false, error: 'Location rule not found' }
        const normalizedUpdates: Record<string, unknown> = { ...updates }
        if (updates.presetId !== undefined) {
            normalizedUpdates.presetId = Number(updates.presetId)
        }
        this.config.locationRules[idx] = { ...this.config.locationRules[idx], ...normalizedUpdates } as LocationRule
        this.saveConfig()
        this.syncLocationTracker()
        return { success: true, rule: this.config.locationRules[idx] }
    }

    deleteLocationRule(ruleId: string): { success: boolean, error?: string } {
        const idx = this.config.locationRules.findIndex(r => r.id === ruleId)
        if (idx < 0) return { success: false, error: 'Location rule not found' }
        this.config.locationRules.splice(idx, 1)
        this.saveConfig()
        this.syncLocationTracker()
        return { success: true }
    }

    // --- Location Tracker ---

    startLocationTracker(): void {
        this.locationTracker.setVrcxDbPath((this.config.settings as Record<string, unknown>).vrcxDbPath as string | null || null)
        this.locationTracker.setCallbacks({
            onLocationChange: (location: LocationState) => this.evaluateLocationRules(location),
            onLocationLeave: () => this.handleLocationLeave()
        })
        this.syncLocationTracker()
        debug.info('[AutoStatus] Location tracker initialized')
    }

    syncLocationTracker(): void {
        if (this.config.locationRules.length > 0) {
            this.locationTracker.start()
        } else {
            this.locationTracker.stop()
        }
    }

    stopLocationTracker(): void {
        this.locationTracker.stop()
        this.lastLocationMatchedRuleId = null
    }

    evaluateLocationRules(location: LocationState): void {
        if (!this.vrchatApi || !this.vrchatApi.isAuthenticated()) return
        if (this.lastOscValue > 0) return
        if (this.externallySet && !this.config.settings?.alwaysAllowOverride) return

        const prioritySource = this.config.settings?.prioritySource || 'schedule'
        // If schedule has priority and a schedule entry is active, location defers
        if (prioritySource === 'schedule' && this.lastActiveScheduleEntryId !== null) return

        for (const rule of this.config.locationRules) {
            if (!rule.enabled) continue
            if (!this.locationRuleMatches(rule, location)) continue

            const alreadyActive = this.lastLocationMatchedRuleId === rule.id
            if (!alreadyActive) {
                this.lastLocationMatchedRuleId = rule.id
                this.applyPreset(rule.presetId, 'location')
            }
            this.notifyStatusChange()
            return
        }
        // No rule matched — clear match state
        this.lastLocationMatchedRuleId = null
        this.notifyStatusChange()
    }

    locationRuleMatches(rule: LocationRule, location: LocationState): boolean {
        // Match access type
        if (rule.matchAccessTypes && rule.matchAccessTypes.length > 0 && !rule.matchAccessTypes.includes(location.instanceType || '')) return false
        // Match world name
        if (rule.matchWorld && location.worldName) {
            const worldName = location.worldName
            if (rule.matchWorldMode === 'exact') {
                if (worldName !== rule.matchWorld) return false
            } else {
                if (!worldName.toLowerCase().includes(rule.matchWorld.toLowerCase())) return false
            }
        } else if (rule.matchWorld && !location.worldName) {
            return false
        }
        // Match group name
        if (rule.matchGroup && location.groupName) {
            const groupName = location.groupName
            if (rule.matchGroupMode === 'exact') {
                if (groupName !== rule.matchGroup) return false
            } else {
                if (!groupName.toLowerCase().includes(rule.matchGroup.toLowerCase())) return false
            }
        } else if (rule.matchGroup && !location.groupName) {
            return false
        }
        return true
    }

    handleLocationLeave(): void {
        if (this.lastLocationMatchedRuleId === null) return
        const prevRule = this.config.locationRules.find(r => r.id === this.lastLocationMatchedRuleId)
        const fallback = prevRule?.fallbackStatusType || null
        this.lastLocationMatchedRuleId = null
        this.notifyStatusChange()
        if (this.config.settings?.returnToInitial) {
            this._returnToInitialStatus('location')
        } else if (fallback) {
            this._applyFallbackStatus(fallback)
        }
    }

    // --- Settings ---

    getSettings(): AutoStatusSettings {
        return { ...this.config.settings }
    }

    updateSettings(settings: Partial<AutoStatusSettings>): { success: boolean, settings: AutoStatusSettings } {
        this.config.settings = { ...this.config.settings, ...settings }
        this.saveConfig()
        return { success: true, settings: this.config.settings }
    }

    // --- Status ---

    getStatus(): {
        lastAppliedPresetId: number | null
        lastStatusChangeTime: number
        lastOscValue: number
        scheduleRunning: boolean
        presetCount: number
        scheduleCount: number
        avatarGuardActive: boolean
        vrchatApiAvailable: boolean
        externallySet: boolean
        currentStatus: string | null
        currentStatusDescription: string | null
        locationRunning: boolean
        locationSource: 'log-watcher' | 'vrcx' | null
        locationRuleCount: number
        currentWorldName: string | null
        currentAccessType: string | null
        currentGroupName: string | null
        lastLocationMatchedRuleId: string | null
        initialStatus: string | null
        initialStatusDescription: string | null
        returnToInitial: boolean
        prioritySource: 'schedule' | 'location'
    } {
        const loc = this.locationTracker.current
        return {
            lastAppliedPresetId: this.lastAppliedPresetId,
            lastStatusChangeTime: this.lastStatusChangeTime,
            lastOscValue: this.lastOscValue,
            scheduleRunning: !!this.scheduleInterval,
            presetCount: this.config.presets.length,
            scheduleCount: this.config.schedule.length,
            avatarGuardActive: Date.now() - this.lastAvatarChangeTime < AVATAR_CHANGE_GUARD_MS,
            vrchatApiAvailable: !!(this.vrchatApi && this.vrchatApi.isAuthenticated()),
            externallySet: this.externallySet,
            currentStatus: this.currentStatus,
            currentStatusDescription: this.currentStatusDescription,
            locationRunning: this.locationTracker.isRunning(),
            locationSource: this.locationTracker.getSource(),
            locationRuleCount: this.config.locationRules.length,
            currentWorldName: loc?.worldName || null,
            currentAccessType: loc?.instanceType || null,
            currentGroupName: loc?.groupName || null,
            lastLocationMatchedRuleId: this.lastLocationMatchedRuleId,
            initialStatus: this.initialStatus,
            initialStatusDescription: this.initialStatusDescription,
            returnToInitial: !!this.config.settings?.returnToInitial,
            prioritySource: this.config.settings?.prioritySource || 'schedule'
        }
    }

    /**
     * Full cleanup.
     */
    close(): void {
        this.stop()
        this.locationTracker.stop()
        debug.info('[AutoStatus] Container closed')
    }
}

export default AutoStatus
