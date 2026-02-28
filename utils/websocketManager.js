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
    async connect(credentials = {}) {
        if (this.socket && this.isConnected) {
            return { success: true, message: 'Already connected' };
        }
        // Clean up any existing socket to prevent memory leaks
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
            // Get client version
            const { app } = require('electron');
            const clientVersion = app.getVersion();
            const socketUrl = this.connectionConfig.serverUrl;
            // In dev mode (non-official servers), ignore SSL certificate validation
            const isDevMode = !socketUrl.includes('arcosc.app') && !socketUrl.includes('beta.arcosc.app');
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
        this.socket.on('panel-connections-update', (data) => {
            this.emit('panel-connections-update', data);
        });
        this.socket.on('feedback-update', (data) => {
            this.emit('feedback-update', data);
        });
        // Server-managed parameter blocklist (pushed on connect and updates)
        this.socket.on('parameter-blocklist', (data) => {
            console.log('WebSocket received parameter-blocklist:', data?.patterns?.length || 0, 'patterns');
            this.emit('parameter-blocklist', data);
        });
        // Server-managed parameter suppressions (from rate monitoring)
        this.socket.on('suppress-parameters', (data) => {
            console.log('WebSocket received suppress-parameters:', data?.addresses?.length || 0, 'addresses');
            this.emit('suppress-parameters', data);
        });
        // Server-managed parameter unsuppressions (staff action)
        this.socket.on('unsuppress-parameters', (data) => {
            console.log('WebSocket received unsuppress-parameters:', data?.addresses?.length || 0, 'addresses');
            this.emit('unsuppress-parameters', data);
        });
    }
    disconnect() {
        if (this.socket) {
            // Remove all event listeners to prevent memory leaks
            this.socket.removeAllListeners();
            this.socket.disconnect();
            this.socket = null;
        }
        this.isConnected = false;
        this.isAuthenticated = false;
        this.currentUser = null;
        this.reconnectAttempts = 0;
        // Emit disconnection status before clearing handlers so they receive it
        this.emit('connection-status', { status: 'disconnected' });
        // Clear internal event handlers to prevent memory leaks
        this.eventHandlers.clear();
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
        return new Promise((resolve, reject) => {
            if (!this.isConnected || !this.socket) {
                reject(new Error('Not connected to server'));
                return;
            }
            // Events that expect responses
            const responseEvents = {
                'submit-feedback': 'feedback-response',
                'get-feedback-list': 'feedback-list-response',
                'vote-feedback': 'vote-feedback-response',
                'get-user-feedback-stats': 'user-feedback-stats-response'
            };
            if (responseEvents[event]) {
                // Set up response listener
                const responseHandler = (response) => {
                    if (response.success !== false) {
                        resolve(response);
                    } else {
                        reject(new Error(response.error || 'Request failed'));
                    }
                };
                // Listen for response (one-time listener)
                this.socket.once(responseEvents[event], responseHandler);
                // Send the request
                this.socket.emit(event, data);
                // Set timeout for response
                setTimeout(() => {
                    this.socket.off(responseEvents[event], responseHandler);
                    reject(new Error('Request timed out'));
                }, 10000); // 10 second timeout
            } else {
                // Fire and forget for other events
                this.socket.emit(event, data);
                resolve({ success: true });
            }
        });
    }
    /**
     * Send VRChat account linking request to server
     * @param {string} vrchatUserId - VRChat user ID (usr_xxx format)
     * @param {string} vrchatUsername - VRChat display name
     * @returns {Promise} Promise that resolves with server response
     */
    sendVRChatLink(vrchatUserId, vrchatUsername) {
        return new Promise((resolve, reject) => {
            if (!this.isConnected || !this.socket) {
                reject(new Error('Not connected to server'));
                return;
            }
            // Set up response listener
            const responseHandler = (response) => {
                if (response.success) {
                    resolve(response);
                } else {
                    reject(new Error(response.error || 'Failed to link VRChat account'));
                }
            };
            // Listen for response (one-time listener)
            this.socket.once('vrchat-link-response', responseHandler);
            // Send the link request
            this.socket.emit('link-vrchat-account', {
                vrchatUserId,
                vrchatUsername
            });
            // Set timeout for response
            setTimeout(() => {
                this.socket.off('vrchat-link-response', responseHandler);
                reject(new Error('Link request timed out'));
            }, 10000); // 10 second timeout
        });
    }
    /**
     * Check VRChat account link status
     * @returns {Promise} Promise that resolves with link status
     */
    checkVRChatLink() {
        return new Promise((resolve, reject) => {
            if (!this.isConnected || !this.socket) {
                reject(new Error('Not connected to server'));
                return;
            }
            // Set up response listener
            const responseHandler = (response) => {
                resolve(response);
            };
            // Listen for response (one-time listener)
            this.socket.once('vrchat-link-status-response', responseHandler);
            // Send the status check request
            this.socket.emit('check-vrchat-link');
            // Set timeout for response
            setTimeout(() => {
                this.socket.off('vrchat-link-status-response', responseHandler);
                reject(new Error('Link status check timed out'));
            }, 5000); // 5 second timeout
        });
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