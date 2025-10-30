/**
 * OSCQueryService - Manages OSC Query protocol for VRChat integration
 * 
 * This service provides OSC Query functionality which allows VRChat to discover
 * the ARC-OSC Client automatically and subscribe to specific parameters.
 * 
 * Key Features:
 * - Automatic service discovery via mDNS
 * - HTTP server for OSC Query protocol
 * - Parameter subscription management
 * - Integration with existing OSC service
 */
const http = require('http');
const { Bonjour } = require('bonjour-service');
const EventEmitter = require('events');
const osc = require('osc');
/**
 * OSC Query Access Control enumeration
 */
const OSCQAccess = {
    NO_VALUE: 0,    // Parameter has no value (container node only)
    READONLY: 1,    // Parameter can only be read
    WRITEONLY: 2,   // Parameter can only be written
    READWRITE: 3,   // Parameter supports both operations
};
/**
 * OSC Type enumeration
 */
const OSCTypeSimple = {
    INT: "i",
    FLOAT: "f",
    STRING: "s",
    BLOB: "b",
    TRUE: "T",
    FALSE: "F",
};
/**
 * OSC Query Extensions
 */
const EXTENSIONS = {
    ACCESS: true,
    VALUE: true,
    RANGE: true,
    DESCRIPTION: true,
    TAGS: true,
    CRITICAL: true,
    CLIPMODE: true,
};
class OSCQueryService extends EventEmitter {
    constructor() {
        super();
        this.httpPort = null;
        this.oscPort = null;
        this.assignedHttpPort = null; // Persistent HTTP port (assigned once, reused on restart)
        this.assignedOscPort = null;  // Persistent OSC port (assigned once, reused on restart)
        this.httpServer = null;
        this.oscUdpPort = null; // OSC UDP listener
        this.bonjour = null;
        this.bonjourService = null;
        this.isRunning = false;
        this.appName = null; // Will be generated once and reused
        this.assignedAppName = null; // Persistent service name (assigned once, reused on restart)
        this.unsubscriptions = new Set(); // Paths to ignore (unsubscribe from)
        this._discoveryTimer = null;
        // Root node for OSC parameter tree
        this.rootNode = {
            description: "ARC OSC Client - VRChat Integration",
            access: OSCQAccess.NO_VALUE,
            children: {}
        };
    }
    /**
     * Initialize the OSC Query service
     * @param {number} legacyPort - Legacy OSC port (not used, kept for compatibility)
     * @param {number} httpPort - Optional HTTP port (auto-detected if not provided)
     */
    async initialize(legacyPort = null, httpPort = null) {
        // Reuse previously assigned ports if they exist (for persistent VRChat connection)
        // Otherwise, assign new random ports on first initialization
        if (this.assignedOscPort === null) {
            this.assignedOscPort = await this._findAvailablePort(22000, 50000);
            console.log(`[OSCQuery] First initialization - assigned new OSC Port: ${this.assignedOscPort}`);
        } else {
            console.log(`[OSCQuery] Reusing previously assigned OSC Port: ${this.assignedOscPort}`);
        }
        this.oscPort = this.assignedOscPort;
        
        // Find available HTTP port if not specified
        if (!httpPort) {
            if (this.assignedHttpPort === null) {
                this.assignedHttpPort = await this._findAvailablePort(22000, 50000);
                console.log(`[OSCQuery] First initialization - assigned new HTTP Port: ${this.assignedHttpPort}`);
            } else {
                console.log(`[OSCQuery] Reusing previously assigned HTTP Port: ${this.assignedHttpPort}`);
            }
            this.httpPort = this.assignedHttpPort;
        } else {
            this.httpPort = httpPort;
            this.assignedHttpPort = httpPort; // Store explicitly provided port
        }
        
        console.log(`[OSCQuery] Initializing with OSC Port: ${this.oscPort}, HTTP Port: ${this.httpPort}`);

        // Setup OSC Query endpoints
        this._setupEndpoints();
    }
    /**
     * Setup default OSC Query endpoints for VRChat
     * @private
     */
    _setupEndpoints() {
        // Add avatar parameters endpoint
        this._addNode('/avatar/parameters', {
            description: 'VRChat Avatar Parameters',
            access: OSCQAccess.WRITEONLY,
        });
        // Add chatbox input endpoint
        this._addNode('/chatbox/input', {
            description: 'VRChat Chatbox Input',
            access: OSCQAccess.WRITEONLY,
        });
        // Add input controls endpoint
        this._addNode('/input', {
            description: 'VRChat Input Controls',
            access: OSCQAccess.WRITEONLY,
        });
    }
    /**
     * Add a node to the OSC parameter tree
     * @private
     */
    _addNode(path, params) {
        const pathParts = path.split('/').filter(p => p !== '');
        let currentNode = this.rootNode;
        for (let i = 0; i < pathParts.length; i++) {
            const part = pathParts[i];
            if (!currentNode.children) {
                currentNode.children = {};
            }
            if (!currentNode.children[part]) {
                currentNode.children[part] = {
                    name: part,
                    children: {}
                };
            }
            // If this is the last part, set the parameters
            if (i === pathParts.length - 1) {
                currentNode.children[part] = {
                    ...currentNode.children[part],
                    ...params
                };
            }
            currentNode = currentNode.children[part];
        }
    }
    /**
     * Build full path for a node
     * @private
     */
    _buildFullPath(pathParts) {
        if (pathParts.length === 0) return '/';
        return '/' + pathParts.join('/');
    }
    /**
     * Serialize node to OSC Query JSON format
     * @private
     */
    _serializeNode(node, fullPath) {
        const result = {
            FULL_PATH: fullPath || '/'
        };
        if (node.description) {
            result.DESCRIPTION = node.description;
        }
        if (node.access !== undefined) {
            result.ACCESS = node.access;
        } else if (node.children && Object.keys(node.children).length > 0) {
            result.ACCESS = OSCQAccess.NO_VALUE;
        }
        if (node.children && Object.keys(node.children).length > 0) {
            result.CONTENTS = {};
            for (const [name, child] of Object.entries(node.children)) {
                const childPath = fullPath === '/' ? `/${name}` : `${fullPath}/${name}`;
                result.CONTENTS[name] = this._serializeNode(child, childPath);
            }
        }
        return result;
    }
    /**
     * HTTP request handler
     * @private
     */
    _handleRequest(req, res) {
        if (req.method !== 'GET') {
            res.statusCode = 400;
            res.end();
            return;
        }
        const url = new URL(req.url, `http://${req.headers.host}`);
        const query = url.search.length > 0 ? url.search.substring(1) : null;
        // Handle HOST_INFO query
        if (query === 'HOST_INFO') {
            const hostInfo = {
                NAME: this.appName,
                EXTENSIONS,
                OSC_IP: '127.0.0.1',
                OSC_PORT: this.oscPort,
                OSC_TRANSPORT: 'UDP',
            };
            this._respondJson(hostInfo, res);
            return;
        }
        // Navigate to requested node
        const pathParts = url.pathname.split('/').filter(p => p !== '');
        let node = this.rootNode;
        let currentPath = '';
        for (const part of pathParts) {
            if (!node.children || !node.children[part]) {
                res.statusCode = 404;
                res.end();
                return;
            }
            node = node.children[part];
            currentPath += '/' + part;
        }
        // Return serialized node
        const fullPath = currentPath || '/';
        const serialized = this._serializeNode(node, fullPath);
        this._respondJson(serialized, res);
    }
    /**
     * Send JSON response
     * @private
     */
    _respondJson(json, res) {
        res.setHeader('Content-Type', 'application/json');
        res.write(JSON.stringify(json));
        res.end();
    }
    /**
     * Handle received OSC messages and check against unsubscriptions
     * By default, all messages are forwarded unless they match an unsubscription pattern
     * @private
     */
    _handleOscMessage(oscMsg) {
        const address = oscMsg.address;
        
        // Check if this message matches any unsubscription (if so, ignore it)
        const isUnsubscribed = this._matchesUnsubscription(address);
        if (isUnsubscribed) {
            // Silently ignore messages that match unsubscription patterns
            return;
        }
        
        // Parse OSC value from args
        let value = null;
        let type = 'f'; // default type
        if (oscMsg.args && oscMsg.args.length > 0) {
            const arg = oscMsg.args[0];
            value = arg.value;
            type = arg.type || 'f';
        }
        
        // Emit the OSC message for forwarding
        this.emit('osc-message', {
            address: address,
            value: value,
            type: type,
            timestamp: Date.now()
        });
    }
    
    /**
     * Check if an OSC address matches any unsubscription pattern
     * @private
     */
    _matchesUnsubscription(address) {
        if (this.unsubscriptions.size === 0) {
            return false; // No unsubscriptions, allow all
        }
        
        for (const pattern of this.unsubscriptions) {
            if (this._matchPattern(address, pattern)) {
                return true; // Match found, this message should be ignored
            }
        }
        
        return false; // No match, allow this message
    }
    /**
     * Match an OSC address against a subscription pattern
     * Supports wildcard patterns like /avatar/parameters/*
     * @private
     */
    _matchPattern(address, pattern) {
        // Exact match
        if (address === pattern) {
            return true;
        }
        // Wildcard pattern matching
        if (pattern.includes('*')) {
            const regexPattern = pattern
                .replace(/\//g, '\\/')  // Escape slashes
                .replace(/\*/g, '.*');  // Convert * to .*
            const regex = new RegExp(`^${regexPattern}$`);
            return regex.test(address);
        }
        return false;
    }
    /**
     * Find an available port
     * @private
     */
    async _findAvailablePort(min, max) {
        const net = require('net');
        return new Promise((resolve, reject) => {
            const tryPort = (port) => {
                if (port > max) {
                    reject(new Error('No available ports found'));
                    return;
                }
                const server = net.createServer();
                server.once('error', (err) => {
                    if (err.code === 'EADDRINUSE') {
                        tryPort(port + 1);
                    } else {
                        reject(err);
                    }
                });
                server.once('listening', () => {
                    server.close(() => {
                        resolve(port);
                    });
                });
                server.listen(port, '0.0.0.0');
            };
            const randomPort = Math.floor(Math.random() * (max - min + 1)) + min;
            tryPort(randomPort);
        });
    }
    /**
     * Start the OSC Query service
     */
    async start() {
        if (this.isRunning) {
            console.log('[OSCQuery] Service already running');
            return;
        }
        try {
            // Generate service name ONCE and reuse it to maintain VRChat connection
            if (!this.assignedAppName) {
                const randomSuffix = Math.random().toString(36).substring(2, 7).toUpperCase();
                this.assignedAppName = `ARC-OSC-Client-${randomSuffix}`;
                console.log(`[OSCQuery] First start - generated new service name: ${this.assignedAppName}`);
            } else {
                console.log(`[OSCQuery] Reusing persistent service name: ${this.assignedAppName}`);
            }
            this.appName = this.assignedAppName;
            
            // Close any existing OSC UDP port before creating a new one
            if (this.oscUdpPort) {
                try {
                    console.log('[OSCQuery] Closing existing OSC UDP port before restart...');
                    this.oscUdpPort.close();
                    this.oscUdpPort = null;
                    // Wait a moment for the port to be fully released
                    await new Promise(resolve => setTimeout(resolve, 200));
                } catch (error) {
                    console.error('[OSCQuery] Error closing existing OSC UDP port:', error);
                }
            }
            // Create HTTP server
            this.httpServer = http.createServer(this._handleRequest.bind(this));
            // Start HTTP server
            await new Promise((resolve, reject) => {
                this.httpServer.listen(this.httpPort, '0.0.0.0', (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
            console.log(`[OSCQuery] HTTP Server started on port ${this.httpPort}`);
            // Create OSC UDP listener on the configured OSC port
            this.oscUdpPort = new osc.UDPPort({
                localAddress: '0.0.0.0',
                localPort: this.oscPort,
                metadata: true
            });
            // Setup OSC message handler
            this.oscUdpPort.on('message', (oscMsg) => {
                this._handleOscMessage(oscMsg);
            });
            this.oscUdpPort.on('ready', () => {
                console.log(`[OSCQuery] OSC UDP listener started on port ${this.oscPort}`);
            });
            this.oscUdpPort.on('error', (error) => {
                console.error(`[OSCQuery] OSC UDP port error:`, error);
                this.emit('error', error);
            });
            // Open the OSC UDP port
            this.oscUdpPort.open();
            // Initialize Bonjour for mDNS
            this.bonjour = new Bonjour();
            // Advertise service via mDNS with error handling for name conflicts
            try {
                this.bonjourService = this.bonjour.publish({
                    name: this.appName,
                    type: 'oscjson',
                    port: this.httpPort,
                    protocol: 'tcp'
                });
                console.log(`[OSCQuery] Service advertised via mDNS as '${this.appName}'`);
            } catch (publishError) {
                // If service name is already in use, try to destroy and retry once
                if (publishError.message && publishError.message.includes('already in use')) {
                    console.log('[OSCQuery] Service name in use, attempting cleanup and retry...');
                    try {
                        if (this.bonjour) {
                            this.bonjour.destroy();
                        }
                        // Wait a moment for cleanup
                        await new Promise(resolve => setTimeout(resolve, 500));
                        // Reinitialize and retry
                        this.bonjour = new Bonjour();
                        this.bonjourService = this.bonjour.publish({
                            name: this.appName,
                            type: 'oscjson',
                            port: this.httpPort,
                            protocol: 'tcp'
                        });
                        console.log(`[OSCQuery] Service advertised via mDNS as '${this.appName}' (after retry)`);
                    } catch (retryError) {
                        console.error('[OSCQuery] Failed to publish service after retry:', retryError);
                        throw retryError;
                    }
                } else {
                    throw publishError;
                }
            }
            this.isRunning = true;
            this.emit('started', {
                httpPort: this.httpPort,
                oscPort: this.oscPort
            });
            // IMPORTANT: trigger mDNS discovery 1 second after service start to avoid timing bottlenecks
            if (this._discoveryTimer) {
                clearTimeout(this._discoveryTimer);
                this._discoveryTimer = null;
            }
            this._discoveryTimer = setTimeout(() => {
                // Only trigger if still running
                if (this.isRunning) {
                    this.triggerDiscovery();
                }
            }, 1000);
            return {
                httpPort: this.httpPort,
                oscPort: this.oscPort,
                serviceName: this.appName
            };
        } catch (error) {
            console.error('[OSCQuery] Failed to start service:', error);
            this.emit('error', error);
            throw error;
        }
    }
    /**
     * Trigger mDNS discovery to wake up VRChat
     */
    triggerDiscovery() {
        if (!this.bonjour) {
            console.log('[OSCQuery] Bonjour not initialized, skipping discovery trigger');
            return;
        }
        console.log('[OSCQuery] Triggering mDNS discovery...');
        // Perform a brief scan to wake up the network
        const browser = this.bonjour.find({ type: 'oscjson' }, (service) => {
            console.log(`[OSCQuery] Found service during discovery: ${service.name}`);
        });
        // Stop discovery after 1 second
        setTimeout(() => {
            try {
                browser.stop();
                console.log('[OSCQuery] Discovery trigger completed');
            } catch (error) {
                // Ignore errors during cleanup
            }
        }, 1000);
    }
    /**
     * Stop the OSC Query service
     */
    async stop() {
        if (!this.isRunning) {
            return;
        }
        try {
            console.log('[OSCQuery] Stopping service...');
            // Clear any pending discovery timer
            if (this._discoveryTimer) {
                clearTimeout(this._discoveryTimer);
                this._discoveryTimer = null;
            }
            // Stop OSC UDP listener FIRST to prevent new messages
            if (this.oscUdpPort) {
                try {
                    // Remove all event listeners to prevent memory leaks
                    this.oscUdpPort.removeAllListeners();
                    this.oscUdpPort.close();
                    this.oscUdpPort = null;
                    console.log('[OSCQuery] OSC UDP listener stopped');
                    // Wait for port to be fully released
                    await new Promise(resolve => setTimeout(resolve, 200));
                } catch (error) {
                    console.error('[OSCQuery] Error stopping OSC UDP listener:', error);
                }
            }
            // Stop mDNS service to unpublish from network
            if (this.bonjourService) {
                try {
                    this.bonjourService.stop();
                    this.bonjourService = null;
                } catch (error) {
                    console.error('[OSCQuery] Error stopping Bonjour service:', error);
                }
            }
            // Destroy Bonjour instance
            if (this.bonjour) {
                try {
                    this.bonjour.destroy();
                    // Wait for Bonjour to fully clean up network resources
                    await new Promise(resolve => setTimeout(resolve, 100));
                    this.bonjour = null;
                } catch (error) {
                    console.error('[OSCQuery] Error destroying Bonjour:', error);
                }
            }
            // Stop HTTP server last
            if (this.httpServer) {
                await new Promise((resolve) => {
                    this.httpServer.close(() => {
                        this.httpServer = null;
                        resolve();
                    });
                });
            }
            this.isRunning = false;
            this.emit('stopped');
            console.log('[OSCQuery] Service stopped');
        } catch (error) {
            console.error('[OSCQuery] Error stopping service:', error);
            this.emit('error', error);
        }
    }
    /**
     * Add an unsubscription path (messages matching this will be ignored)
     */
    addUnsubscription(path) {
        this.unsubscriptions.add(path);
        console.log(`[OSCQuery] Added unsubscription: ${path}`);
        this.emit('unsubscription-added', path);
    }
    
    /**
     * Remove an unsubscription path (messages will be allowed again)
     */
    removeUnsubscription(path) {
        this.unsubscriptions.delete(path);
        console.log(`[OSCQuery] Removed unsubscription: ${path}`);
        this.emit('unsubscription-removed', path);
    }
    
    /**
     * Set unsubscription paths (replaces all existing unsubscriptions)
     */
    setUnsubscriptions(paths) {
        this.unsubscriptions.clear();
        if (Array.isArray(paths)) {
            paths.forEach(path => this.unsubscriptions.add(path));
            console.log(`[OSCQuery] Set ${paths.length} unsubscription(s):`, paths);
            this.emit('unsubscriptions-updated', paths);
        }
    }
    
    /**
     * Get all current unsubscriptions
     */
    getUnsubscriptions() {
        return Array.from(this.unsubscriptions);
    }
    
    /**
     * Clear all unsubscriptions (allow all messages)
     */
    clearUnsubscriptions() {
        this.unsubscriptions.clear();
        console.log('[OSCQuery] Cleared all unsubscriptions - now listening to all OSC messages');
        this.emit('unsubscriptions-cleared');
    }
    /**
     * Get service status
     */
    getStatus() {
        return {
            isRunning: this.isRunning,
            httpPort: this.httpPort,
            oscPort: this.oscPort,
            serviceName: this.appName,
            unsubscriptions: this.getUnsubscriptions()
        };
    }
    
    /**
     * Reset port assignments (will assign new random ports on next initialize)
     * Useful for troubleshooting or forcing VRChat to rediscover the service
     */
    resetPorts() {
        if (this.isRunning) {
            console.warn('[OSCQuery] Cannot reset ports while service is running. Stop the service first.');
            return false;
        }
        console.log('[OSCQuery] Resetting port assignments - new ports will be assigned on next initialize');
        this.assignedHttpPort = null;
        this.assignedOscPort = null;
        this.httpPort = null;
        this.oscPort = null;
        return true;
    }
    
    /**
     * Reset service name (will generate new name on next start)
     * Useful for forcing VRChat to see this as a new service
     */
    resetServiceName() {
        if (this.isRunning) {
            console.warn('[OSCQuery] Cannot reset service name while service is running. Stop the service first.');
            return false;
        }
        console.log('[OSCQuery] Resetting service name - new name will be generated on next start');
        this.assignedAppName = null;
        this.appName = null;
        return true;
    }
    
    /**
     * Reset everything (ports and service name)
     * Forces complete re-initialization on next start
     */
    resetAll() {
        if (this.isRunning) {
            console.warn('[OSCQuery] Cannot reset while service is running. Stop the service first.');
            return false;
        }
        console.log('[OSCQuery] Resetting all persistent state - service will fully re-initialize on next start');
        this.assignedHttpPort = null;
        this.assignedOscPort = null;
        this.assignedAppName = null;
        this.httpPort = null;
        this.oscPort = null;
        this.appName = null;
        return true;
    }
}
module.exports = { OSCQueryService, OSCQAccess, OSCTypeSimple };