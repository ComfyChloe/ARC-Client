import { io, Socket } from 'socket.io-client'

interface ConnectionConfig {
    serverUrl: string
    autoReconnect: boolean
    reconnectDelay: number
    maxReconnectAttempts: number
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

class WebSocketManager {
    socket: Socket | null
    isConnected: boolean
    isAuthenticated: boolean
    currentUser: { username: string } | null
    connectionConfig: ConnectionConfig
    reconnectAttempts: number
    eventHandlers: Map<string, Set<EventHandler>>

    constructor() {
        this.socket = null
        this.isConnected = false
        this.isAuthenticated = false
        this.currentUser = null
        this.connectionConfig = {
            serverUrl: 'wss://avatar.comfychloe.uk:48255',
            autoReconnect: true,
            reconnectDelay: 3000,
            maxReconnectAttempts: 5
        }
        this.reconnectAttempts = 0
        this.eventHandlers = new Map()
    }
    setConfig(config: Partial<ConnectionConfig>): void {
        this.connectionConfig = { ...this.connectionConfig, ...config }
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
            const isDevMode = !socketUrl.includes('arcosc.app') && !socketUrl.includes('beta.arcosc.app')
            this.socket = io(socketUrl, {
                query: { username, password, clientVersion },
                transports: ['websocket'],
                autoConnect: false,
                reconnection: this.connectionConfig.autoReconnect,
                reconnectionDelay: this.connectionConfig.reconnectDelay,
                reconnectionAttempts: this.connectionConfig.maxReconnectAttempts,
                secure: socketUrl.startsWith('wss://'),
                rejectUnauthorized: !isDevMode,
                forceNew: true
            })
            await this.setupEventHandlers()
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
                maxAttempts: this.connectionConfig.maxReconnectAttempts,
                serverUrl: this.connectionConfig.serverUrl
            })
            this.emit('connection-error', { 
                error: error.message,
                attempts: this.reconnectAttempts,
                maxAttempts: this.connectionConfig.maxReconnectAttempts
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
        return new Promise((resolve, reject) => {
            if (!this.isConnected || !this.socket) {
                reject(new Error('Not connected to server'))
                return
            }
            const responseHandler = (response: { success?: boolean; error?: string }) => {
                if (response.success) {
                    resolve(response)
                } else {
                    reject(new Error(response.error || 'Failed to link VRChat account'))
                }
            }
            this.socket.once('vrchat-link-response', responseHandler)
            this.socket.emit('link-vrchat-account', {
                vrchatUserId,
                vrchatUsername
            })
            setTimeout(() => {
                this.socket!.off('vrchat-link-response', responseHandler)
                reject(new Error('Link request timed out'))
            }, 10000)
        })
    }
    checkVRChatLink(): Promise<unknown> {
        return new Promise((resolve, reject) => {
            if (!this.isConnected || !this.socket) {
                reject(new Error('Not connected to server'))
                return
            }
            const responseHandler = (response: unknown) => {
                resolve(response)
            }
            this.socket.once('vrchat-link-status-response', responseHandler)
            this.socket.emit('check-vrchat-link')
            setTimeout(() => {
                this.socket!.off('vrchat-link-status-response', responseHandler)
                reject(new Error('Link status check timed out'))
            }, 5000)
        })
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