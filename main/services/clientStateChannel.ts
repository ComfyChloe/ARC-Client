/**
 * ClientState Channel
 * Owns everything about the low-frequency clientState telemetry
 * stream (active page + enabled modules): payload building,
 * 2-second trailing debounce, offline FIFO buffer (max 10), and
 * the 5-minute heartbeat. The WebSocketManager delegates to this
 * class instead of carrying the state inline, so the telemetry
 * gate, teardown, and drain paths all have exactly one owner.
 *
 * Wire contract (must stay in sync with ARC-OSC clientState
 * handler): `{ v: 1, ts, activePage?, modules: string[], sessionId }`
 * — sparse encoding, modules array contains ONLY enabled names.
 */
export type ClientStateReason = 'connect' | 'module-toggle' | 'page-change' | 'heartbeat'
export interface ClientStatePayload {
    v: 1
    ts: number
    activePage: string
    modules: string[]
    sessionId: string
}
export interface ClientStateChannelDeps {
    // Telemetry opt-in gate (shared with clientStatus telemetry).
    isEnabled: () => boolean
    // Live connection state — checked at emit time, not cached.
    isConnected: () => boolean
    // The live socket, or null when disconnected.
    getSocket: () => { emit(event: string, payload: unknown): void } | null
    // Builds the current snapshot payload (page + modules + session).
    buildPayload: () => ClientStatePayload
}
const CLIENT_STATE_DEBOUNCE_MS = 2000
const CLIENT_STATE_HEARTBEAT_MS = 5 * 60 * 1000
const CLIENT_STATE_BUFFER_CAP = 10
export class ClientStateChannel {
    private deps: ClientStateChannelDeps
    private buffer: ClientStatePayload[] = []
    private debounceTimer: ReturnType<typeof setTimeout> | null = null
    private heartbeatInterval: ReturnType<typeof setInterval> | null = null
    constructor(deps: ClientStateChannelDeps) {
        this.deps = deps
    }
    /**
     * Request a clientState emission for the given reason. When
     * connected, coalesces rapid reasons into one trailing emit
     * (2s debounce). When disconnected, buffers the snapshot
     * (FIFO, max 10) so it drains on the next connect.
     */
    emit(reason: ClientStateReason): void {
        if (!this.deps.isEnabled()) return
        if (!this.deps.isConnected() || !this.deps.getSocket()) {
            this.bufferSnapshot()
            return
        }
        if (this.debounceTimer !== null) {
            clearTimeout(this.debounceTimer)
            this.debounceTimer = null
        }
        this.debounceTimer = setTimeout(() => {
            this.debounceTimer = null
            this.flush()
        }, CLIENT_STATE_DEBOUNCE_MS)
    }
    /**
     * Emit a fresh snapshot immediately, bypassing the debounce.
     * Used to service server-side request-state commands. The
     * optional requestId is attached for server-side correlation;
     * the server parser ignores unknown fields.
     */
    emitFresh(requestId?: string): void {
        if (!this.deps.isEnabled()) return
        const socket = this.deps.getSocket()
        if (!this.deps.isConnected() || !socket) return
        const payload: Record<string, unknown> = { ...this.deps.buildPayload() }
        if (requestId !== undefined) payload.requestId = requestId
        try { socket.emit('clientState', payload) } catch { /* ignore */ }
    }
    /**
     * Send the current snapshot now (debounce target). No-op when
     * telemetry is off or the socket is gone.
     */
    flush(): void {
        if (!this.deps.isEnabled()) return
        const socket = this.deps.getSocket()
        if (!this.deps.isConnected() || !socket) return
        try { socket.emit('clientState', this.deps.buildPayload()) } catch { /* ignore */ }
    }
    /**
     * Drain the offline buffer in order. Called on (re)connect and
     * on the telemetry OFF→ON transition.
     */
    drainBuffer(): void {
        while (this.buffer.length > 0) {
            const snapshot = this.buffer.shift()!
            const socket = this.deps.getSocket()
            if (this.deps.isConnected() && socket) {
                try { socket.emit('clientState', snapshot) } catch { /* ignore */ }
            }
        }
    }
    startHeartbeat(): void {
        this.stopHeartbeat()
        this.heartbeatInterval = setInterval(() => {
            this.emit('heartbeat')
        }, CLIENT_STATE_HEARTBEAT_MS)
    }
    stopHeartbeat(): void {
        if (this.heartbeatInterval !== null) {
            clearInterval(this.heartbeatInterval)
            this.heartbeatInterval = null
        }
    }
    /**
     * Full teardown: heartbeat + pending debounce. Called from
     * disconnect, flushAndClose, and the telemetry OFF transition —
     * the single stop path for this channel.
     */
    stop(): void {
        this.stopHeartbeat()
        if (this.debounceTimer !== null) {
            clearTimeout(this.debounceTimer)
            this.debounceTimer = null
        }
    }
    private bufferSnapshot(): void {
        if (this.buffer.length >= CLIENT_STATE_BUFFER_CAP) {
            this.buffer.shift()
        }
        this.buffer.push(this.deps.buildPayload())
    }
}
