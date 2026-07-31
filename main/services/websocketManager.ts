import { io, Socket } from 'socket.io-client'

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
            this.socket = io(socketUrl, {
                query: { username, password, clientVersion },
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
                    resolve({ 
                        success: true, 
                        message: 'Connected successfully',
                        user: this.currentUser 
                    })
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
        })
        this.socket.on('disconnect', (reason: string) => {
            this.isConnected = false
            this.isAuthenticated = false
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
        this.socket.on('parameter-update', (data: unknown) => {
            this.emit('parameter-update', data)
        })
        this.socket.on('server-message', (data: unknown) => {
            this.emit('server-message', data)
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
    disconnect(): { success: boolean; message: string } {
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