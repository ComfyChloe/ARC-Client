const { io } = require('socket.io-client');
class WebSocketManager {
    constructor() {
        this.socket = null;
        this.isConnected = false;
        this.isAuthenticated = false;
        this.currentUser = null;
        this.connectionConfig = {
            serverUrl: 'wss://avatar.comfychloe.uk:48255',
            autoReconnect: true,
            reconnectDelay: 3000,
            maxReconnectAttempts: 5
            // For development with self-signed certificates, add: rejectUnauthorized: false
        };
        this.reconnectAttempts = 0;
        this.eventHandlers = new Map();
    }
    setConfig(config) {
        this.connectionConfig = { ...this.connectionConfig, ...config };
    }
    updateServerUrl(url, persistent = true) {
        this.connectionConfig.serverUrl = url;
        this.connectionConfig.persistent = persistent;
        return { success: true, url, persistent };
    }
    async connect(credentials = {}) {
        if (this.socket && this.isConnected) {
            return { success: true, message: 'Already connected' };
        }
        if (this.socket) {
            this.socket.removeAllListeners();
            this.socket.disconnect();
            this.socket = null;
        }
        try {
            const { username, password } = credentials;
            if (!username || !password) {
                throw new Error('Username and password are required');
            }
            const socketUrl = this.connectionConfig.serverUrl;
            this.socket = io(socketUrl, {
                query: { username, password },
                transports: ['websocket'],
                autoConnect: false,
                reconnection: this.connectionConfig.autoReconnect,
                reconnectionDelay: this.connectionConfig.reconnectDelay,
                reconnectionAttempts: this.connectionConfig.maxReconnectAttempts,
                secure: socketUrl.startsWith('wss://'),
                rejectUnauthorized: true,
                forceNew: true
            });
            await this.setupEventHandlers();
            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Connection timeout'));
                }, 10000);
                this.socket.once('connect', () => {
                    clearTimeout(timeout);
                    this.isConnected = true;
                    this.reconnectAttempts = 0;
                    this.currentUser = { username };
                    resolve({ 
                        success: true, 
                        message: 'Connected successfully',
                        user: this.currentUser 
                    });
                });
                this.socket.once('connect_error', (error) => {
                    clearTimeout(timeout);
                    this.isConnected = false;
                    this.isAuthenticated = false;
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
                    });
                    reject(new Error(`Connection failed: ${error.message}`));
                });
                this.socket.connect();
            });
        } catch (error) {
            throw new Error(`WebSocket connection failed: ${error.message}`);
        }
    }
    async setupEventHandlers() {
        if (!this.socket) return;
        this.socket.on('connect', () => {
            this.isConnected = true;
            this.reconnectAttempts = 0;
            this.emit('connection-status', { 
                status: 'connected', 
                user: this.currentUser 
            });
        });
        this.socket.on('disconnect', (reason) => {
            this.isConnected = false;
            this.isAuthenticated = false;
            this.emit('connection-status', { 
                status: 'disconnected', 
                reason 
            });
        });
        this.socket.on('connect_error', (error) => {
            this.isConnected = false;
            this.isAuthenticated = false;
            this.reconnectAttempts++;
            console.error('WebSocket connection error:', {
                message: error.message,
                attempts: this.reconnectAttempts,
                maxAttempts: this.connectionConfig.maxReconnectAttempts,
                serverUrl: this.connectionConfig.serverUrl
            });
            this.emit('connection-error', { 
                error: error.message,
                attempts: this.reconnectAttempts,
                maxAttempts: this.connectionConfig.maxReconnectAttempts
            });
        });
        this.socket.on('connection-status', (data) => {
            if (data.status === 'connected') {
                this.isAuthenticated = true;
                this.emit('authenticated', data);
            }
        });
        this.socket.on('osc-data', (data) => {
            this.emit('osc-data', data);
        });
        this.socket.on('avatar-change', (data) => {
            console.log('WebSocket received avatar-change:', data);
            this.emit('avatar-change', data);
        });
        this.socket.on('parameter-update', (data) => {
            this.emit('parameter-update', data);
        });
        this.socket.on('server-message', (data) => {
            this.emit('server-message', data);
        });
    }
    disconnect() {
        if (this.socket) {
            this.socket.removeAllListeners();
            this.socket.disconnect();
            this.socket = null;
        }
        this.isConnected = false;
        this.isAuthenticated = false;
        this.currentUser = null;
        this.reconnectAttempts = 0;
        this.eventHandlers.clear();
        this.emit('connection-status', { status: 'disconnected' });
        return { success: true, message: 'Disconnected successfully' };
    }
    sendOscData(data) {
        if (!this.isConnected || !this.socket) {
            throw new Error('Not connected to server');
        }
        this.socket.emit('osc-data', data);
        return { success: true };
    }
    sendMessage(event, data) {
        if (!this.isConnected || !this.socket) {
            throw new Error('Not connected to server');
        }
        this.socket.emit(event, data);
        return { success: true };
    }
    getStatus() {
        return {
            isConnected: this.isConnected,
            isAuthenticated: this.isAuthenticated,
            currentUser: this.currentUser,
            reconnectAttempts: this.reconnectAttempts,
            serverUrl: this.connectionConfig.serverUrl
        };
    }
    on(event, handler) {
        if (!this.eventHandlers.has(event)) {
            this.eventHandlers.set(event, new Set());
        }
        this.eventHandlers.get(event).add(handler);
    }
    off(event, handler) {
        if (this.eventHandlers.has(event)) {
            this.eventHandlers.get(event).delete(handler);
        }
    }
    emit(event, data) {
        if (this.eventHandlers.has(event)) {
            this.eventHandlers.get(event).forEach(handler => {
                try {
                    handler(data);
                } catch (error) {
                    console.error(`Error in event handler for ${event}:`, error);
                }
            });
        }
    }
    removeAllListeners(event) {
        if (event) {
            this.eventHandlers.delete(event);
        } else {
            this.eventHandlers.clear();
        }
    }
}
module.exports = WebSocketManager;