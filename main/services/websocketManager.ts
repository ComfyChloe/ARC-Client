import { io, Socket } from 'socket.io-client'
import type { clientStatus } from '../containers/autostatus/locationTracker'
import { ClientStateChannel } from './clientStateChannel'

interface ConnectionConfig {
    serverUrl: string
    autoReconnect: boolean
    reconnectDelay: number
}

interface Credentials {
    username?: string
    password?: string
}

interface ConnectResult {
    success: boolean
    message: string
    user?: { username: string }
}

type EventHandler = (data: unknown) => void

// Pending request/response correlation entry. Each request sends a UUID linkRequestId;
// the server echoes the same id in its response; the manager dispatches by id so that
// a Socket.IO reconnect (which replaces the underlying `socket`) cannot orphan an
// in-flight request.
interface PendingResponse {
    resolve: (value: unknown) => void
    reject: (reason: Error) => void
    timeoutHandle: ReturnType<typeof setTimeout>
    eventName: string
}

class WebSocketManager {
    socket: Socket | null
    isConnected: boolean
    isAuthenticated: boolean
    currentUser: { username: string } | null
    connectionConfig: ConnectionConfig
    reconnectAttempts: number
    eventHandlers: Map<string, Set<EventHandler>>
    // Latency tracking via Socket.IO engine packet events. We
    // capture the wall-clock when the engine sends a 'ping' and
    // when the matching 'pong' returns; the delta is the current
    // round-trip. Reported per-clientStatus batch + in the diag
    // snapshot.
    //
    // Telemetry flow: clientStatus batches are sent to the server
    // only when telemetryEnabled (local) is true. The server does
    // NOT send a set-client-status-enabled signal — this is a
    // client-side opt-in gate. Events queue in the LocationTracker
    // while disabled and drain in arrival order on re-enable.
    private currentPingMs: number = 0
    private lastPingSentAt: number = 0
    // Packet loss tracking — rolling window of sent/acked counts.
    // Resets when the window fills so the rolling average stays
    // bounded. Computed on demand by computePacketLossPct().
    private packetLossSent: number = 0
    private packetLossAcked: number = 0
    private static readonly PACKET_LOSS_WINDOW: number = 100
    // Wall-clock of the most recent Socket.IO connect. Used for
    // the diag snapshot's uptime field. Reset on each (re)connect.
    private connectedAt: number = 0
    // Autostatus telemetry gate. When false, the engine-packet
    // drain skips — the LocationTracker still collects events into
    // its in-process queue (in order) but no clientStatus wire
    // emissions happen until the toggle is re-enabled. Controlled
    // locally via setTelemetryEnabled() (called from settings
    // persistence + IPC). The server does NOT send an opt-in;
    // this is a client-side gate. Defaults to true so existing
    // installs keep emitting.
    telemetryEnabled: boolean = true
    // Active page reported by the renderer for clientState emissions.
    activePage: string = ''
    // Accessor for the set of enabled module names. Injected by
    // main/index.ts after constructing wsManager to avoid circular
    // imports (websocketManager must not import container modules).
    private moduleAccessors: { getEnabledModules: () => string[] } | null = null
    // ClientState telemetry channel — owns payload building, the
    // 2s debounce, the offline buffer, and the heartbeat. All
    // clientState state lives here instead of inline on this class.
    private clientStateChannel: ClientStateChannel
    // Session id for clientState. Set on first connect; persists
    // across reconnects as the same credential login = same session.
    private sessionId: string = ''
    // Pending request-id → pending dispatcher. Entries are added on send* and removed
    // when the matching response arrives or the timeout fires. Survives Socket.IO
    // internal reconnects because dispatch is handled by a long-lived `socket.on()`
    // registered in setupEventHandlers() — it just re-binds on each reconnect.
    private pendingResponses: Map<string, PendingResponse> = new Map()
    private nextRequestId: number = 0

    constructor() {
        this.socket = null
        this.isConnected = false
        this.isAuthenticated = false
        this.currentUser = null
        this.connectionConfig = {
            serverUrl: 'wss://arcosc.app:48255',
            autoReconnect: true,
            reconnectDelay: 5000,
        }
        this.reconnectAttempts = 0
        this.eventHandlers = new Map()
        this.clientStateChannel = new ClientStateChannel({
            isEnabled: () => this.telemetryEnabled,
            isConnected: () => this.isConnected,
            getSocket: () => this.socket,
            buildPayload: () => this.buildClientStatePayload(),
        })
    }

    /**
     * Build the current clientState snapshot payload. Single source
     * of truth for the wire shape — the channel uses this for live
     * emits, buffered snapshots, and fresh (request-state) replies.
     */
    private buildClientStatePayload(): { v: 1; ts: number; activePage: string; modules: string[]; sessionId: string } {
        return {
            v: 1,
            ts: Date.now(),
            activePage: this.activePage,
            modules: this.collectModuleStates(),
            sessionId: this.sessionId,
        }
    }

    /**
     * Inject the module-accessor object after construction from
     * main/index.ts. This avoids circular imports between
     * websocketManager and container modules.
     */
    setModuleAccessors(accessors: { getEnabledModules: () => string[] }): void {
        this.moduleAccessors = accessors
    }

    /**
     * Collect enabled module names for clientState emission.
     * Returns only currently-enabled modules (sparse encoding:
     * absent/disabled modules are omitted from the array).
     */
    collectModuleStates(): string[] {
        if (!this.moduleAccessors) return []
        return this.moduleAccessors.getEnabledModules()
    }

    /**
     * Emit a fresh clientState snapshot immediately, bypassing the
     * 2-second debounce. Used to service server-side request-state
     * commands. Optionally attaches a requestId field so the server
     * can correlate the reply.
     */
    emitFreshClientState(requestId?: string): void {
        this.clientStateChannel.emitFresh(requestId)
    }

    /**
     * Store the active page and trigger a clientState emission.
     * Called by the set-active-page IPC handler in main/index.ts.
     */
    setActivePage(page: string): void {
        this.activePage = page
        this.clientStateChannel.emit('page-change')
    }

    /**
     * Notify that a module was started or stopped. Called by
     * main/index.ts after module start/stop handlers.
     */
    notifyModuleToggled(): void {
        this.clientStateChannel.emit('module-toggle')
    }
    // ── Server command handlers (native methods) ─────────────────
    // Each server→client command from the client:command envelope
    // family is a first-class method here. The dispatcher in
    // setupEventHandlers routes client:command:<name> to these.
    // Server wants a fresh clientState snapshot — reply immediately
    // with the requestId attached for correlation.
    private handleRequestStateCommand(env: unknown): void {
        try {
            const requestId = (env as { requestId?: string } | null)?.requestId
            this.clientStateChannel.emitFresh(requestId)
        } catch { /* ignore */ }
    }
    // Server wants a toast/banner shown to the user. Validates the
    // payload shape, then re-emits locally as 'notice' (main/index.ts
    // forwards it to the renderer over the notice-banner IPC channel).
    private handleNoticeCommand(env: unknown): void {
        try {
            const p = (env as { payload?: unknown } | null)?.payload as {
                id?: unknown
                level?: unknown
                title?: unknown
                body?: unknown
                dismissible?: unknown
                ttlMs?: unknown
            } | undefined
            if (!p || typeof p.id !== 'string' || typeof p.title !== 'string' || typeof p.body !== 'string') return
            const level = p.level
            if (level !== 'info' && level !== 'warn' && level !== 'error') return
            this.emit('notice', {
                id: p.id,
                level: level as 'info' | 'warn' | 'error',
                title: p.title as string,
                body: p.body as string,
                dismissible: p.dismissible === true,
                ttlMs: typeof p.ttlMs === 'number' && p.ttlMs > 0 ? p.ttlMs : 8000,
            })
        } catch { /* ignore */ }
    }
    // Server asks which of the named modules are currently enabled.
    // Replies with the standard clientState payload plus a
    // moduleAvailability map and the requestId (the server's parser
    // ignores extra fields).
    private handleCheckModulesCommand(env: unknown): void {
        try {
            const p = (env as { payload?: unknown } | null)?.payload as { modules?: unknown; requestId?: unknown } | undefined
            if (!Array.isArray(p?.modules)) return
            const enabledModules = new Set(this.collectModuleStates())
            const moduleAvailability: Record<string, boolean> = {}
            for (const m of p.modules as unknown[]) {
                if (typeof m === 'string') moduleAvailability[m] = enabledModules.has(m)
            }
            const requestId = (p?.requestId as string | undefined) ?? (env as { requestId?: string } | null)?.requestId
            const payload: Record<string, unknown> = this.buildClientStatePayload()
            payload.requestId = requestId
            payload.moduleAvailability = moduleAvailability
            if (this.isConnected && this.socket) this.socket.emit('clientState', payload)
        } catch { /* ignore */ }
    }
    // Server pushes a config delta: parameter blocklist patterns
    // and/or default app settings. Blocklist reuses the existing
    // 'parameter-blocklist' local event path; settings merge happens
    // in main/index.ts (only fills undefined keys).
    private handleConfigSyncCommand(env: unknown): void {
        try {
            const p = (env as { payload?: unknown } | null)?.payload as {
                parameterBlocklist?: unknown
                defaultAppSettings?: unknown
            } | undefined
            if (!p) return
            if (Array.isArray(p.parameterBlocklist)) {
                this.emit('parameter-blocklist', { patterns: p.parameterBlocklist })
            }
            if (p.defaultAppSettings && typeof p.defaultAppSettings === 'object' && p.defaultAppSettings !== null) {
                this.emit('config-sync', { defaultAppSettings: p.defaultAppSettings as Record<string, unknown> })
            }
        } catch { /* ignore */ }
    }
    setConfig(config: Partial<ConnectionConfig>): void {
        this.connectionConfig = { ...this.connectionConfig, ...config }
    }

    // Generates a short monotonic linkRequestId. UUID would be overkill for an
    // in-process correlation key; a counter is unique within this renderer session
    // and friendly to server-side log scanning.
    private generateLinkRequestId(): string {
        this.nextRequestId += 1
        return `lri-${Date.now().toString(36)}-${this.nextRequestId.toString(36)}`
    }

    // Registers a pending response handler keyed by the given request id and returns
    // the id the caller should send to the server. The dispatcher installed in
    // setupEventHandlers() resolves/rejects this entry when a matching response
    // arrives on the (possibly new) socket.
    private registerPending(eventName: string, timeoutMs: number): { id: string; promise: Promise<unknown> } {
        const id = this.generateLinkRequestId()
        const promise = new Promise<unknown>((resolve, reject) => {
            const timeoutHandle = setTimeout(() => {
                const entry = this.pendingResponses.get(id)
                if (entry) {
                    this.pendingResponses.delete(id)
                    reject(new Error(`${eventName} timed out after ${timeoutMs}ms`))
                }
            }, timeoutMs)
            this.pendingResponses.set(id, { resolve, reject, timeoutHandle, eventName })
        })
        return { id, promise }
    }

    // Called from the long-lived socket.on() dispatcher in setupEventHandlers().
    private dispatchResponse(eventName: string, payload: any): boolean {
        const id = payload?.linkRequestId
        if (!id) return false
        const entry = this.pendingResponses.get(id)
        if (!entry || entry.eventName !== eventName) return false
        this.pendingResponses.delete(id)
        clearTimeout(entry.timeoutHandle)
        if (payload && payload.success === false) {
            entry.reject(new Error(payload.error || `${eventName} failed`))
        } else {
            entry.resolve(payload)
        }
        return true
    }

    // On socket reconnect we just re-register the dispatch listeners; pending
    // responses are unaffected since they're stored on the manager, not the socket.
    private installResponseDispatchers(socket: Socket): void {
        socket.on('vrchat-link-response', (payload: any) => {
            // If the dispatcher handles it, done. Otherwise fall back to a one-shot
            // (legacy/single-call behaviour) so older server builds that don't echo
            // linkRequestId still resolve the in-flight promise.
            if (this.dispatchResponse('vrchat-link-response', payload)) return
            // Legacy path: no id present. Best-effort resolve of any pending
            // vrchat-link-response entry — but only the most-recent one because we
            // can't safely correlate without an id. Use the onResponse handler registered
            // by the caller for forward-compat via a fallback event.
            const legacyHandler = (this as any).__legacyVrchatLinkHandler
            if (typeof legacyHandler === 'function') legacyHandler(payload)
        })
        socket.on('vrchat-link-status-response', (payload: any) => {
            if (this.dispatchResponse('vrchat-link-status-response', payload)) return
            const legacyHandler = (this as any).__legacyCheckLinkHandler
            if (typeof legacyHandler === 'function') legacyHandler(payload)
        })
    }
    async connect(credentials: Credentials = {}): Promise<ConnectResult> {
        if (this.socket && this.isConnected) {
            // Re-announce the current status so a renderer that (re)issues
            // connect while we're already connected (e.g. after a renderer
            // reload or login/logout cycle) doesn't get stuck waiting for a
            // status push that will never come — pushes only fire on changes.
            this.emit('connection-status', {
                status: 'connected',
                user: this.currentUser
            })
            return { success: true, message: 'Already connected' }
        }
        if (this.socket) {
            this.socket.removeAllListeners()
            this.socket.disconnect()
            this.socket = null
        }
        try {
            const { username, password } = credentials
            if (!username || !password) {
                throw new Error('Username and password are required')
            }
            const { app } = require('electron')
            const clientVersion = app.getVersion()
            const socketUrl = this.connectionConfig.serverUrl
            // Disable TLS verification only when (a) connecting to a non-prod
            // host AND (b) running an unpackaged dev build. Packaged builds
            // ALWAYS verify, regardless of the host string \u2014 this prevents a
            // distributed binary from silently accepting attacker certs if
            // someone points it at a custom host.
            const looksLikeDevHost = !socketUrl.includes('arcosc.app') && !socketUrl.includes('beta.arcosc.app')
            const isPackaged = !!app.isPackaged
            const allowInsecure = looksLikeDevHost && !isPackaged
            // Capture the client's IANA timezone once at connect time.
            // Sent in the Socket.IO query/auth payload so the server can
            // store it alongside client_connection_history (per session).
            // No new dependency \u2014 Intl is built into Node's main process.
            // Falls back to undefined for hosts without ICU data.
            let clientTimezone: string | undefined
            try {
                clientTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone
            } catch {
                clientTimezone = undefined
            }
            this.socket = io(socketUrl, {
                query: { username, password, clientVersion, timezone: clientTimezone },
                transports: ['websocket'],
                autoConnect: false,
                reconnection: this.connectionConfig.autoReconnect,
                reconnectionDelay: this.connectionConfig.reconnectDelay,
                reconnectionDelayMax: this.connectionConfig.reconnectDelay,
                secure: socketUrl.startsWith('wss://'),
                rejectUnauthorized: !allowInsecure,
                forceNew: true
            })
            await this.setupEventHandlers()
            // Install the correlation-id dispatchers on the freshly created socket.
            // These survive Socket.IO internal reconnects because setupEventHandlers
            // is also re-called in those paths, but the dispatchers themselves read
            // pendingResponses from the manager (not the socket) so re-binding is
            // automatic.
            this.installResponseDispatchers(this.socket)
            return new Promise<ConnectResult>((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Connection timeout'))
                }, 10000)
                this.socket!.once('connect', () => {
                    clearTimeout(timeout)
                    this.isConnected = true
                    this.reconnectAttempts = 0
                    this.currentUser = { username }
                    // Set sessionId once per (re)connect. Using timestamp +
                    // reconnectAttempts as a unique-ish session identifier for
                    // this client instantiation.
                    if (!this.sessionId) {
                        this.sessionId = `${Date.now()}-${this.reconnectAttempts}`
                    }
                    resolve({ 
                        success: true, 
                        message: 'Connected successfully',
                        user: this.currentUser 
                    })
                    // Drain buffered clientState snapshots if any
                    this.clientStateChannel.drainBuffer()
                    // Emit connect reason
                    this.clientStateChannel.emit('connect')
                    // Start heartbeat
                    this.clientStateChannel.startHeartbeat()
                })
                this.socket!.once('connect_error', (error: Error & { type?: string; description?: string; context?: unknown; req?: { url?: string; method?: string; headers?: Record<string, string> } }) => {
                    clearTimeout(timeout)
                    this.isConnected = false
                    this.isAuthenticated = false
                    console.error('WebSocket connection error details:', {
                        message: error.message,
                        type: error.type,
                        description: error.description,
                        context: error.context,
                        req: error.req ? {
                            url: error.req.url,
                            method: error.req.method,
                            headers: error.req.headers
                        } : undefined
                    })
                    reject(new Error(`Connection failed: ${error.message}`))
                })
                this.socket!.connect()
            })
        } catch (error) {
            throw new Error(`WebSocket connection failed: ${(error as Error).message}`)
        }
    }
    async setupEventHandlers(): Promise<void> {
        if (!this.socket) return
        // Universal server → client envelope dispatchers.
        // ARC-OSC sends two envelope families on this socket:
        //   client:command { command, payload, requestId?, ts } — server asks client to DO something
        //   client:update  { topic, data,  requestId?, ts } — server announces a state change
        // OSC continues to use the bare `osc-data` event (high-throughput hot path).
        // Remove any existing listener before registering to prevent stacking across reconnects.
        this.socket.removeAllListeners('client:command')
        this.socket.on('client:command', (env: { command: string; payload?: unknown; requestId?: string; ts?: number } | unknown) => {
            const e = env as { command?: string; payload?: unknown; requestId?: string; ts?: number }
            if (!e || typeof e.command !== 'string') return
            // requestId may live inside payload for some command types (e.g. check-modules)
            const payloadObj = e.payload as { requestId?: string } | undefined
            const requestId = e.requestId ?? payloadObj?.requestId
            try {
                this.emit(`client:command:${e.command}`, { payload: e.payload, requestId, ts: e.ts })
            } catch { /* ignore */ }
        })
        this.socket.on('client:update', (env: { topic: string; data?: Record<string, unknown>; requestId?: string; ts?: number } | unknown) => {
            const e = env as { topic?: string; data?: Record<string, unknown>; requestId?: string; ts?: number }
            if (!e || typeof e.topic !== 'string') return
            try {
                this.emit(`client:update:${e.topic}`, { data: e.data ?? {}, requestId: e.requestId, ts: e.ts })
            } catch { /* ignore */ }
        })
        // ── Server → client command handlers ──────────────────────────
        // Each command is a native method below — the wiring here is
        // just the event-name → method table (reconnect-safe: these
        // are re-registered per setupEventHandlers call on a fresh
        // socket, so no stacking is possible).
        this.socket.on('client:command:request-state', (env: unknown) => this.handleRequestStateCommand(env))
        this.socket.on('client:command:notice', (env: unknown) => this.handleNoticeCommand(env))
        this.socket.on('client:command:check-modules', (env: unknown) => this.handleCheckModulesCommand(env))
        this.socket.on('client:command:config-sync', (env: unknown) => this.handleConfigSyncCommand(env))
        // Install (or re-install) the request-id correlation dispatchers so any
        // response that arrives after a Socket.IO internal reconnect still
        // resolves the corresponding pending promise.
        this.installResponseDispatchers(this.socket)
        this.socket.on('connect', () => {
            this.isConnected = true
            this.reconnectAttempts = 0
            this.emit('connection-status', {
                status: 'connected',
                user: this.currentUser
            })
            // On (re)connect, drain any pending client statuses
            // from the location tracker. The tracker accumulates events
            // from the VRChat gamelog; without this hook, transient
            // disconnect windows would lose data.
            try {
                const { getActive } = require('../containers/autostatus/locationTracker')
                const tracker = getActive()
                if (tracker && typeof tracker.drainClientStatusBuffer === 'function') {
                    tracker.drainClientStatusBuffer()
                }
            } catch { /* ignore — autostatus not started yet */ }
            this.connectedAt = Date.now()
            // Attach ping + packet-loss trackers to the underlying
            // engine. On every engine ping, drain the autostatus
            // buffer so batched data piggybacks on the engine's
            // existing 25s cadence. Autostatus is fully client-driven
            // — there is no server-side opt-in gate.
            try {
                const engine = (this.socket as any)?.io?.engine
                if (engine && typeof engine.on === 'function') {
                    engine.on('packet', (packet: any) => {
                        if (packet && packet.type === 'ping') {
                            this.lastPingSentAt = Date.now()
                            this.packetLossSent++
                            if (this.packetLossSent > WebSocketManager.PACKET_LOSS_WINDOW) {
                                this.packetLossSent = 0
                                this.packetLossAcked = 0
                            }
                            try {
                                // Skip the drain when telemetry is off —
                                // events stay buffered in arrival order in
                                // the LocationTracker until the toggle flips
                                // back on (see setTelemetryEnabled).
                                if (!this.telemetryEnabled) return
                                const { getActive } = require('../containers/autostatus/locationTracker')
                                const t = getActive()
                                if (t && typeof t.drainClientStatusBuffer === 'function') {
                                    t.drainClientStatusBuffer()
                                }
                            } catch { /* ignore */ }
                        }
                    })
                    engine.on('packetCreate', (packet: any) => {
                        if (packet && packet.type === 'pong') {
                            if (this.lastPingSentAt > 0) {
                                this.currentPingMs = Date.now() - this.lastPingSentAt
                                this.packetLossAcked++
                                if (this.packetLossAcked > WebSocketManager.PACKET_LOSS_WINDOW) {
                                    this.packetLossAcked = WebSocketManager.PACKET_LOSS_WINDOW
                                }
                            }
                        }
                    })
                }
            } catch { /* ignore — engine not exposed yet */ }
        })
        this.socket.on('disconnect', (reason: string) => {
            this.isConnected = false
            this.isAuthenticated = false
            this.currentPingMs = 0
            this.lastPingSentAt = 0
            this.packetLossSent = 0
            this.packetLossAcked = 0
            this.connectedAt = 0
            this.emit('connection-status', {
                status: 'disconnected',
                reason
            })
        })
        this.socket.on('connect_error', (error: Error) => {
            this.isConnected = false
            this.isAuthenticated = false
            this.reconnectAttempts++
            console.error('WebSocket connection error:', {
                message: error.message,
                attempts: this.reconnectAttempts,
                serverUrl: this.connectionConfig.serverUrl
            })
            this.emit('connection-error', { 
                error: error.message,
                attempts: this.reconnectAttempts
            })
        })
        this.socket.on('connection-status', (data: { status: string }) => {
            if (data.status === 'connected') {
                this.isAuthenticated = true
                this.emit('authenticated', data)
            }
        })
        this.socket.on('osc-data', (data: unknown) => {
            this.emit('osc-data', data)
        })
        this.socket.on('avatar-change', (data: unknown) => {
            console.log('WebSocket received avatar-change:', data)
            this.emit('avatar-change', data)
        })
        this.socket.on('avatar-state-confirmed', (data: unknown) => {
            this.emit('avatar-state-confirmed', data)
        })
        this.socket.on('parameter-update', (data: unknown) => {
            this.emit('parameter-update', data)
        })
        this.socket.on('server-message', (data: unknown) => {
            this.emit('server-message', data)
        })
        // Server-initiated prompt asking for our current location
        // context. We reply with a 1-update clientStatus batch ONLY if
        // the location tracker has a current instance — silence
        // when unknown (the server treats silence as "unknown").
        this.socket.on('request-clientStatus', (_data: { requestId?: string } | unknown) => {
            try {
                const { getActive } = require('../containers/autostatus/locationTracker')
                const tracker = getActive()
                const ctx = tracker?.getCurrentInstanceContext?.()
                if (!ctx || !this.socket) return
                const envelope = this.buildClientBatch([{
                    state: 'join',
                    instanceId: ctx.instanceId,
                    clientTs: Date.now(),
                }])
                if (envelope) this.socket.emit('clientStatus', envelope)
            } catch { /* ignore */ }
        })
        // Server confirms it received our final shutdown batch.
        // We log at info for diagnostics; no further action.
        this.socket.on('statusFlushAck', (_data: { received?: boolean; ts?: number } | unknown) => {
            try { (require('../services/debugger').default.info
                ?? console.info)('[WebSocketManager] server acknowledged statusFlushAck') } catch { /* ignore */ }
        })
        this.socket.on('panel-connections-update', (data: unknown) => {
            this.emit('panel-connections-update', data)
        })
        this.socket.on('feedback-update', (data: unknown) => {
            this.emit('feedback-update', data)
        })
        this.socket.on('parameter-blocklist', (data: { patterns?: unknown[] }) => {
            console.log('WebSocket received parameter-blocklist:', data?.patterns?.length || 0, 'patterns')
            this.emit('parameter-blocklist', data)
        })
        this.socket.on('suppress-parameters', (data: { addresses?: unknown[] }) => {
            console.log('WebSocket received suppress-parameters:', data?.addresses?.length || 0, 'addresses')
            this.emit('suppress-parameters', data)
        })
        this.socket.on('unsuppress-parameters', (data: { addresses?: unknown[] }) => {
            console.log('WebSocket received unsuppress-parameters:', data?.addresses?.length || 0, 'addresses')
            this.emit('unsuppress-parameters', data)
        })
        this.socket.on('unsuppress-denied', (data: { address?: string; reason?: string }) => {
            console.log('WebSocket received unsuppress-denied:', data?.address, 'reason:', data?.reason)
            this.emit('unsuppress-denied', data)
        })
    }
    /**
     * Synchronously drain any pending clientInfo updates from the
     * active location tracker, emit them as a clientStatusFlush
     * marker on the existing socket, and then close the socket.
     * Called from app.on('before-quit') and explicit disconnect
     * paths so the server gets a final batch before the socket
     * dies. No-op when the socket is already disconnected.
     *
     * Bounded by a 1-second wait for the server's statusFlushAck
     * so we never hang shutdown. If ack arrives, debug-log it; if
     * not, close anyway — the server still has the batch in flight.
     */
    flushAndClose(): { flushed: boolean; pending: number } {
        this.clientStateChannel.stop()
        let pending = 0
        try {
            const { getActive } = require('../containers/autostatus/locationTracker')
            const tracker = getActive() as { flushStatusBuffer(): unknown[]; getClientStatusBufferLength(): number } | null
            if (tracker) {
                pending = tracker.getClientStatusBufferLength()
                const drained = tracker.flushStatusBuffer()
                if (drained.length > 0 && this.isConnected && this.socket) {
                    const envelope = this.buildClientBatch(drained as any)
                    if (envelope) {
                        try { this.socket.emit('clientStatusFlush', envelope) } catch { /* ignore */ }
                    }
                }
            }
        } catch { /* ignore */ }
        // Synchronously wait up to 1 second for the server's
        // statusFlushAck. Electron's before-quit handler is
        // synchronous, so we use a busy-wait on hrtime — blocks the
        // main thread for up to 1s, which is acceptable for
        // shutdown. We avoid Atomics.wait because it requires a
        // Worker context and throws on the main thread.
        let ackReceived = false
        if (this.isConnected && this.socket) {
            try {
                const onAck = () => { ackReceived = true }
                this.socket.once('statusFlushAck', onAck)
                const startNs = process.hrtime.bigint()
                const timeoutNs = 1_000_000_000n // 1s
                while (!ackReceived) {
                    const elapsed = process.hrtime.bigint() - startNs
                    if (elapsed > timeoutNs) break
                }
                try { this.socket.off('statusFlushAck', onAck) } catch { /* ignore */ }
            } catch { /* ignore */ }
        }
        try { this.disconnect() } catch { /* ignore */ }
        return { flushed: ackReceived, pending }
    }
    disconnect(): { success: boolean; message: string } {
        this.clientStateChannel.stop()
        if (this.socket) {
            this.socket.removeAllListeners()
            this.socket.disconnect()
            this.socket = null
        }
        this.isConnected = false
        this.isAuthenticated = false
        this.currentUser = null
        this.reconnectAttempts = 0
        this.emit('connection-status', { status: 'disconnected' })
        this.eventHandlers.clear()
        return { success: true, message: 'Disconnected successfully' }
    }
    sendOscData(data: unknown): { success: boolean } {
        if (!this.isConnected || !this.socket) {
            throw new Error('Not connected to server')
        }
        this.socket.emit('osc-data', data)
        return { success: true }
    }
    requestUnsuppress(address: string): void {
        if (!this.isConnected || !this.socket) {
            throw new Error('Not connected to server')
        }
        this.socket.emit('request-unsuppress', { address })
    }
    requestClearAllSuppressions(): Promise<{ success: boolean; count?: number; cooldown?: boolean; remainingMs?: number; error?: string }> {
        if (!this.isConnected || !this.socket) {
            return Promise.reject(new Error('Not connected to server'))
        }
        return new Promise((resolve) => {
            this.socket!.once('clear-all-suppressed-ack', resolve)
            this.socket!.emit('request-clear-all-suppressed')
        })
    }
    setPanelState(kind: string, value: boolean): Promise<{ success: boolean; kind?: string; value?: boolean; changed?: boolean; error?: string }> {
        if (!this.isConnected || !this.socket) {
            return Promise.reject(new Error('Not connected to server'))
        }
        return new Promise((resolve) => {
            this.socket!.once('set-panel-state-ack', resolve)
            this.socket!.emit('set-panel-state', { kind, value })
            setTimeout(() => {
                this.socket?.off('set-panel-state-ack', resolve as any)
                resolve({ success: false, error: 'Request timed out' })
            }, 10000)
        })
    }
    /**
     * Build a plain-JSON client batch envelope. Used by the
     * location tracker (live emits + drain) and the
     * request-clientStatus reply path. Reads the local VRChat user
     * id + client version + current RTT once per batch. The wire
     * payload is a plain JSON object on the existing authenticated
     * WebSocket — auth + integrity come from TLS + bcrypt +
     * per-socket sessionId, not from any payload encoding.
     *
     * When clientStatusEnabled is true (server has opted the
     * client in), the envelope also carries a diag snapshot
     * (ping, loss, uptime, reconnects, buffered, lastEventTs).
     * The snapshot piggybacks on the engine ping cadence, so
     * there's no extra timer.
     *
     * Returns null if the update list is empty.
     */
    buildClientBatch(updates: clientStatus[]): {
        v: 1
        usrId: string | null
        version: string
        ping: number
        updates: clientStatus[]
        diag?: {
            ping: number
            loss: number
            uptime: number
            reconnects: number
            buffered: number
            lastEventTs: number | null
        }
    } | null {
        if (!Array.isArray(updates) || updates.length === 0) return null
        const envelope: any = {
            v: 1,
            usrId: this.readLocalVrchatUserId(),
            version: this.readAppVersion(),
            ping: this.currentPingMs,
            updates,
        }
        // Diag snapshot is always included now that the server-side
        // opt-in flag has been removed — autostatus is fully client-driven.
        envelope.diag = {
            ping: this.currentPingMs,
            loss: this.computePacketLossPct(),
            uptime: this.connectedAt > 0 ? Date.now() - this.connectedAt : 0,
            reconnects: this.reconnectAttempts,
            buffered: updates.length,
            lastEventTs: this.readLastEventTs(),
        }
        return envelope
    }
    /**
     * Public entry point used by the location tracker. Builds the
     * envelope and emits it on the existing authenticated socket
     * with the wire event name `clientStatus`. The tracker never
     * mentions the wire event name directly — that lives here.
     */
    sendClientStatus(updates: clientStatus[]): void {
        if (!this.isConnected || !this.socket) return
        const envelope = this.buildClientBatch(updates)
        if (!envelope) return
        try { this.socket.emit('clientStatus', envelope) } catch { /* ignore */ }
    }
    /**
     * Toggle autostatus telemetry. When transitioning OFF → ON,
     * immediately drain the LocationTracker's queue so any events
     * collected while telemetry was off are sent in arrival order
     * (the user wants "off-load send straight to server in order"
     * the moment they re-enable). When ON → OFF, the next engine
     * ping's drain will skip; the queue keeps filling (bounded at
     * CLIENT_BUFFER_CAP) until the toggle flips back.
     *
     * Safe to call before connect — the backlog will fire on the
     * next connect.
     */
    setTelemetryEnabled(enabled: boolean): void {
        const wasEnabled = this.telemetryEnabled
        this.telemetryEnabled = enabled === true
        if (!wasEnabled && this.telemetryEnabled) {
            // Just turned on — flush the backlog in order.
            try {
                const { getActive } = require('../containers/autostatus/locationTracker')
                const t = getActive()
                if (t && typeof t.drainClientStatusBuffer === 'function') {
                    t.drainClientStatusBuffer()
                }
            } catch { /* ignore */ }
            // Also drain any buffered clientState snapshots
            this.clientStateChannel.drainBuffer()
        }
        if (wasEnabled && !this.telemetryEnabled) {
            // Turning off — stop heartbeat and clear pending debounce
            this.clientStateChannel.stop()
        }
    }
    /**
     * Pull the most recent enqueue timestamp from the active
     * tracker (used by the diag snapshot's lastEventTs field).
     */
    private readLastEventTs(): number | null {
        try {
            const { getActive } = require('../containers/autostatus/locationTracker')
            const tracker = getActive() as { getLastEventTs?: () => number | null } | null
            return tracker?.getLastEventTs?.() ?? null
        } catch { return null }
    }
    /**
     * Compute packet loss % over the rolling 100-ping window.
     * The packet-loss counters are reset by the engine ping
     * handler when the window fills — see connect().
     */
    private computePacketLossPct(): number {
        if (this.packetLossSent === 0) return 0
        const loss = ((this.packetLossSent - this.packetLossAcked) / this.packetLossSent) * 100
        return Math.round(loss * 100) / 100
    }
    // Read the local VRChat user id from the autoStatus container
    // via the globalThis hook registered by main/index.ts. Returns
    // null when not authenticated. Read per-call so a fresh link /
    // unlink reflects immediately.
    private readLocalVrchatUserId(): string | null {
        try {
            const container = (globalThis as any).__arc_auto_status_container
            const status = container?.vrchatApi?.getStatus?.()
            const id = status?.currentUser?.id
            return typeof id === 'string' && id.startsWith('usr_') ? id : null
        } catch { return null }
    }
    // Read app.getVersion() lazily. Returns 'unknown' on any
    // failure (e.g. when this is called outside Electron).
    private readAppVersion(): string {
        try {
            const { app } = require('electron')
            return app?.getVersion?.() ?? 'unknown'
        } catch { return 'unknown' }
    }
    sendMessage(event: string, data: unknown): Promise<unknown> {
        return new Promise((resolve, reject) => {
            if (!this.isConnected || !this.socket) {
                reject(new Error('Not connected to server'))
                return
            }
            const responseEvents: Record<string, string> = {
                'submit-feedback': 'feedback-response',
                'get-feedback-list': 'feedback-list-response',
                'vote-feedback': 'vote-feedback-response',
                'get-user-feedback-stats': 'user-feedback-stats-response'
            }
            if (responseEvents[event]) {
                const responseHandler = (response: { success?: boolean; error?: string }) => {
                    if (response.success !== false) {
                        resolve(response)
                    } else {
                        reject(new Error(response.error || 'Request failed'))
                    }
                }
                this.socket.once(responseEvents[event], responseHandler)
                this.socket.emit(event, data)
                setTimeout(() => {
                    this.socket!.off(responseEvents[event], responseHandler)
                    reject(new Error('Request timed out'))
                }, 10000)
            } else {
                this.socket.emit(event, data)
                resolve({ success: true })
            }
        })
    }
    sendVRChatLink(vrchatUserId: string, vrchatUsername: string): Promise<unknown> {
        if (!this.isConnected || !this.socket) {
            return Promise.reject(new Error('Not connected to server'))
        }
        // Use the correlation-id dispatcher so a Socket.IO reconnect mid-flight
        // doesn't orphan the in-flight request. The server echoes linkRequestId
        // back in its response; installResponseDispatchers() reads it and
        // resolves/rejects the matching pending entry.
        const { id, promise } = this.registerPending('vrchat-link-response', 10000)
        this.socket.emit('link-vrchat-account', {
            vrchatUserId,
            vrchatUsername,
            linkRequestId: id
        })
        return promise
    }
    checkVRChatLink(): Promise<unknown> {
        if (!this.isConnected || !this.socket) {
            return Promise.reject(new Error('Not connected to server'))
        }
        // Correlation-id dispatch — see sendVRChatLink() above.
        const { id, promise } = this.registerPending('vrchat-link-status-response', 5000)
        this.socket.emit('check-vrchat-link', { linkRequestId: id })
        return promise
    }
    getStatus(): { isConnected: boolean; isAuthenticated: boolean; currentUser: { username: string } | null; reconnectAttempts: number; serverUrl: string } {
        return {
            isConnected: this.isConnected,
            isAuthenticated: this.isAuthenticated,
            currentUser: this.currentUser,
            reconnectAttempts: this.reconnectAttempts,
            serverUrl: this.connectionConfig.serverUrl
        }
    }
    on(event: string, handler: EventHandler): void {
        if (!this.eventHandlers.has(event)) {
            this.eventHandlers.set(event, new Set())
        }
        this.eventHandlers.get(event)!.add(handler)
    }
    off(event: string, handler: EventHandler): void {
        if (this.eventHandlers.has(event)) {
            this.eventHandlers.get(event)!.delete(handler)
        }
    }
    emit(event: string, data: unknown): void {
        if (this.eventHandlers.has(event)) {
            this.eventHandlers.get(event)!.forEach(handler => {
                try {
                    handler(data)
                } catch (error) {
                    console.error(`Error in event handler for ${event}:`, error)
                }
            })
        }
    }
    removeAllListeners(event?: string): void {
        if (event) {
            this.eventHandlers.delete(event)
        } else {
            this.eventHandlers.clear()
        }
    }
}
export default WebSocketManager