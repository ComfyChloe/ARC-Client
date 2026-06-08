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
import http from 'node:http'
import dgram from 'node:dgram'
import { Bonjour, Service } from 'bonjour-service'
import { EventEmitter } from 'node:events'
import osc from 'osc'
import https from 'node:https'
import { URL } from 'node:url'
import os from 'node:os'

const OSCQAccess = {
    NO_VALUE: 0,
    READONLY: 1,
    WRITEONLY: 2,
    READWRITE: 3,
} as const

const OSCTypeSimple = {
    INT: "i",
    FLOAT: "f",
    STRING: "s",
    BLOB: "b",
    TRUE: "T",
    FALSE: "F",
} as const

const EXTENSIONS = {
    ACCESS: true,
    VALUE: true,
    RANGE: true,
    DESCRIPTION: true,
    TAGS: true,
    CRITICAL: true,
    CLIPMODE: true,
} as const

const DEFAULT_BIND_ADDRESS = '127.0.0.1'
const DEFAULT_FALLBACK_ADDRESS = '0.0.0.0'
const DEFAULT_FALLBACK_IP = '127.0.0.1'

interface OscQueryNode {
    description?: string
    access?: number
    name?: string
    children?: Record<string, OscQueryNode>
    [key: string]: unknown
}

interface OscQuerySerializedNode {
    FULL_PATH: string
    DESCRIPTION?: string
    ACCESS?: number
    CONTENTS?: Record<string, OscQuerySerializedNode>
}

interface MdnsService {
    name?: string
    port?: number
    host?: string
    addresses?: string[]
    referer?: { address?: string }
    [key: string]: unknown
}

interface SuppressionMetadata {
    [address: string]: unknown
}

class OSCQueryService extends EventEmitter {
    httpPort: number | null
    oscPort: number | null
    assignedHttpPort: number | null
    assignedOscPort: number | null
    httpServer: http.Server | null
    oscUdpPort: InstanceType<typeof osc.UDPPort> | null
    vrchatListenerPort: dgram.Socket | null
    bonjour: InstanceType<typeof Bonjour> | null
    bonjourService: Service | null
    isRunning: boolean
    appName: string | null
    assignedAppName: string | null
    unsubscriptions: Set<string>
    hardcodedUnsubscriptions: Set<string>
    _discoveryTimer: ReturnType<typeof setTimeout> | null
    _discoveryInterval: ReturnType<typeof setInterval> | null
    _currentVRChatOscQueryAddress: string | null
    _currentVRChatOscAddress: string | null
    _currentVRChatServiceName: string | null
    _livenessCheckFailures: number
    _lastOscMessageTime: number | null
    _oscFlowMonitorInterval: ReturnType<typeof setInterval> | null
    _reAdvertiseInterval: ReturnType<typeof setInterval> | null
    _persistentBrowser: { on: (event: string, cb: (service: MdnsService) => void) => void; stop: () => void } | null
    oscAdvertisedIp: string | null
    _localIpAddresses: string[]
    bindAddress: string
    LIVENESS_FAILURE_THRESHOLD: number
    OSC_FLOW_TIMEOUT_WARNING: number
    OSC_FLOW_TIMEOUT_RECONNECT: number
    READVERTISE_INTERVAL: number
    serverBlocklist: Set<string>
    serverSuppressions: Set<string>
    serverSuppressionMetadata: SuppressionMetadata
    localOnlyPatterns: Set<string>
    rootNode: OscQueryNode
    constructor() {
        super()
        this.httpPort = null
        this.oscPort = null
        this.assignedHttpPort = null // Persistent HTTP port (assigned once, reused on restart)
        this.assignedOscPort = null  // Persistent OSC port (assigned once, reused on restart)
        this.httpServer = null
        this.oscUdpPort = null // OSC UDP listener on random port (for OSC Query protocol)
        this.vrchatListenerPort = null // Passive listener on port 9001 (VRChat's default output)
        this.bonjour = null
        this.bonjourService = null
        this.isRunning = false
        this.appName = null // Will be generated once and reused
        this.assignedAppName = null // Persistent service name (assigned once, reused on restart)
        this.unsubscriptions = new Set() // Paths to ignore (unsubscribe from)
        this.hardcodedUnsubscriptions = new Set() // Hardcoded paths that cannot be removed
        this._discoveryTimer = null
        this._discoveryInterval = null // Continuous discovery interval
        this._currentVRChatOscQueryAddress = null // Track current VRChat OSCQuery address
        this._currentVRChatOscAddress = null // Track current VRChat OSC address
        this._currentVRChatServiceName = null // Track VRChat's service name to detect restarts
        // Liveness & health monitoring
        this._livenessCheckFailures = 0 // Count consecutive liveness check failures
        this._lastOscMessageTime = null // Track last received OSC message
        this._oscFlowMonitorInterval = null // Monitor OSC data flow
        this._reAdvertiseInterval = null // Periodic mDNS re-advertisement
        this._persistentBrowser = null // Long-lived mDNS browser
        // Network configuration
        this.oscAdvertisedIp = null // IP address to advertise in HOST_INFO
        this._localIpAddresses = [] // Cache of local IP addresses
        this.bindAddress = DEFAULT_BIND_ADDRESS
        // Configuration constants
        this.LIVENESS_FAILURE_THRESHOLD = 2 // Failures before clearing connection
        this.OSC_FLOW_TIMEOUT_WARNING = 30000 // 30s without data = warning
        this.OSC_FLOW_TIMEOUT_RECONNECT = 60000 // 60s without data = reconnect
        this.READVERTISE_INTERVAL = 30000 // Re-advertise every 30 seconds
        // Hardcode heartrate parameter to never be forwarded to ARC
        this.hardcodedUnsubscriptions.add('/avatar/parameters/ARCOSC/Heartrate/*')
        // Hardcode face tracking parameters
        this.hardcodedUnsubscriptions.add('/avatar/parameters/v2/*')
        this.hardcodedUnsubscriptions.add('/avatar/parameters/FT/*')
        this.hardcodedUnsubscriptions.add('/avatar/parameters/EyeTracking*')
        this.hardcodedUnsubscriptions.add('/avatar/parameters/LipTracking*')
        // SRanipal / Vive face tracking parameters
        this.hardcodedUnsubscriptions.add('/avatar/parameters/Face/*')
        this.hardcodedUnsubscriptions.add('/avatar/parameters/Eye/*')
        this.hardcodedUnsubscriptions.add('/avatar/parameters/Lip/*')
        // OSC Trackers / body tracking
        this.hardcodedUnsubscriptions.add('/tracking/*')
        // Server-managed blocklist (pushed from ARC-OSC server, cannot be removed by user)
        this.serverBlocklist = new Set()
        // Server-managed suppressions (dynamic, from rate monitoring)
        this.serverSuppressions = new Set()
        // Local-only addresses: received by modules but never forwarded to the server
        this.localOnlyPatterns = new Set()
        // Per-address metadata from server (isPanelParam, isInAvatarJson)
        this.serverSuppressionMetadata = {}
        // Root node for OSC parameter tree
        this.rootNode = {
            description: "ARC OSC Client - VRChat Integration",
            access: OSCQAccess.NO_VALUE,
            children: {}
        }
    }
    /**
     * Formatted section header for debug console output
     * @private
     */
    _logSection(title: string): void {
        console.log(`\n${'='.repeat(60)}`)
        console.log(`  ${title}`)
        console.log(`${'='.repeat(60)}`)
    }
    /**
     * Formatted key-value log line
     * @private
     */
    _logKV(key: string, value: string | number | boolean | null, indent = 2): void {
        const pad = ' '.repeat(indent)
        const valStr = value === null ? 'null' : String(value)
        console.log(`${pad}${key.padEnd(22)} ${valStr}`)
    }
    /**
     * Formatted status badge
     * @private
     */
    _logStatus(label: string, ok: boolean, detail?: string): void {
        const badge = ok ? '[OK]' : '[!!]'
        const suffix = detail ? ` - ${detail}` : ''
        if (ok) {
            console.log(`  ${badge} ${label}${suffix}`)
        } else {
            console.warn(`  ${badge} ${label}${suffix}`)
        }
    }
    /**
     * Initialize the OSC Query service
     * @param {number} legacyPort - Legacy OSC port (not used, kept for compatibility)
     * @param {number} httpPort - Optional HTTP port (auto-detected if not provided)
     * @param {string} bindAddress - IP address to bind to (default: '127.0.0.1' for local only)
     */
    async initialize(legacyPort: number | null = null, httpPort: number | null = null, bindAddress = DEFAULT_BIND_ADDRESS): Promise<void> {
        // Reuse previously assigned ports if they exist (for persistent VRChat connection)
        // Otherwise, assign new random ports on first initialization
        if (this.assignedOscPort === null) {
            this.assignedOscPort = await this._findAvailablePort(22000, 50000)
            console.log(`[OSCQuery] First initialization - assigned new OSC Port: ${this.assignedOscPort}`)
        } else {
            console.log(`[OSCQuery] Reusing previously assigned OSC Port: ${this.assignedOscPort}`)
        }
        this.oscPort = this.assignedOscPort
        // Find available HTTP port if not specified
        if (!httpPort) {
            if (this.assignedHttpPort === null) {
                this.assignedHttpPort = await this._findAvailablePort(22000, 50000)
                console.log(`[OSCQuery] First initialization - assigned new HTTP Port: ${this.assignedHttpPort}`)
            } else {
                console.log(`[OSCQuery] Reusing previously assigned HTTP Port: ${this.assignedHttpPort}`)
            }
            this.httpPort = this.assignedHttpPort
        } else {
            this.httpPort = httpPort
            this.assignedHttpPort = httpPort; // Store explicitly provided port
        }
        // Store bind address for use during start
        this.bindAddress = bindAddress || DEFAULT_FALLBACK_ADDRESS
        this._localIpAddresses = this._getLocalIpAddresses()
        // Determine the advertised OSC IP for mDNS/HOST_INFO
        // IMPORTANT: Always advertise a non-loopback LAN IP when possible.
        // VRChat uses mDNS multicast (224.0.0.251:5353) to discover OSCQuery services,
        // and advertising 127.0.0.1 can fail on Windows with virtual network adapters
        // (Docker, WSL, Hyper-V, VPN) because the multicast may route through the wrong interface.
        const detectedLanIp = this._getLocalIpAddress()
        if (this.bindAddress === DEFAULT_FALLBACK_ADDRESS) {
            // Binding to all interfaces — auto-detect primary IP for advertisement
            this.oscAdvertisedIp = detectedLanIp || DEFAULT_FALLBACK_IP
        } else if (this._isLoopback(this.bindAddress) && detectedLanIp) {
            // Binding to loopback (127.0.0.1) — advertise the LAN IP for mDNS discovery
            // VRChat on the same machine can still connect via localhost, but mDNS needs a
            // routable address so VRChat's multicast queries reach us through the correct interface
            this.oscAdvertisedIp = detectedLanIp
        } else {
            // Specific non-loopback bind address — advertise it directly
            this.oscAdvertisedIp = this.bindAddress
        }
        this._logSection('OSCQuery Initialization')
        this._logKV('OSC Port:', this.oscPort)
        this._logKV('HTTP Port:', this.httpPort)
        this._logKV('Bind Address:', this.bindAddress)
        this._logKV('Advertised IP:', this.oscAdvertisedIp)
        this._logKV('Loopback Bind:', this._isLoopback(this.bindAddress))
        if (this._isLoopback(this.bindAddress) && detectedLanIp) {
            this._logStatus('Loopback Promotion', true, `${this.bindAddress} -> ${detectedLanIp} for mDNS`)
        }
        console.log(`  Detected LAN IPs:`)
        if (this._localIpAddresses.length > 0) {
            this._localIpAddresses.forEach(ip => console.log(`    - ${ip}`))
        } else {
            console.warn(`    (none detected)`)
        }
        this._logStatus('Network Interfaces', this._localIpAddresses.length > 0, `${this._localIpAddresses.length} non-loopback IPv4 address(es)`)
        if (this._localIpAddresses.length === 0) {
            console.warn('  [!!] WARNING: No non-loopback IPv4 addresses detected!')
            console.warn('        mDNS discovery will likely fail.')
            console.warn('        Possible causes: no active network adapter, all adapters internal,')
            console.warn('        or firewall blocking interface enumeration.')
        }

        // Setup OSC Query endpoints
        this._setupEndpoints()
    }
    /**
     * Setup default OSC Query endpoints for VRChat
     * @private
     */
    _setupEndpoints(): void {
        // Add avatar parameters endpoint
        this._addNode('/avatar/parameters', {
            description: 'VRChat Avatar Parameters',
            access: OSCQAccess.WRITEONLY,
        })
        // Add chatbox input endpoint
        this._addNode('/chatbox/input', {
            description: 'VRChat Chatbox Input',
            access: OSCQAccess.WRITEONLY,
        })
        // Add input controls endpoint
        this._addNode('/input', {
            description: 'VRChat Input Controls',
            access: OSCQAccess.WRITEONLY,
        })
    }
    /**
     * Add a node to the OSC parameter tree
     * @private
     */
    _addNode(path: string, params: Partial<OscQueryNode>): void {
        const pathParts = path.split('/').filter(p => p !== '')
        let currentNode = this.rootNode
        for (let i = 0; i < pathParts.length; i++) {
            const part = pathParts[i]
            if (!currentNode.children) {
                currentNode.children = {}
            }
            if (!currentNode.children[part]) {
                currentNode.children[part] = {
                    name: part,
                    children: {}
                }
            }
            // If this is the last part, set the parameters
            if (i === pathParts.length - 1) {
                currentNode.children[part] = {
                    ...currentNode.children[part],
                    ...params
                }
            }
            currentNode = currentNode.children[part]
        }
    }
    /**
     * Build full path for a node
     * @private
     */
    _buildFullPath(pathParts: string[]): string {
        if (pathParts.length === 0) return '/'
        return '/' + pathParts.join('/')
    }
    /**
     * Serialize node to OSC Query JSON format
     * @private
     */
    _serializeNode(node: OscQueryNode, fullPath: string): OscQuerySerializedNode {
        const result: OscQuerySerializedNode = {
            FULL_PATH: fullPath || '/'
        }
        if (node.description) {
            result.DESCRIPTION = node.description
        }
        if (node.access !== undefined) {
            result.ACCESS = node.access
        } else if (node.children && Object.keys(node.children).length > 0) {
            result.ACCESS = OSCQAccess.NO_VALUE
        }
        if (node.children && Object.keys(node.children).length > 0) {
            result.CONTENTS = {}
            for (const [name, child] of Object.entries(node.children)) {
                const childPath = fullPath === '/' ? `/${name}` : `${fullPath}/${name}`
                result.CONTENTS[name] = this._serializeNode(child, childPath)
            }
        }
        return result
    }
    /**
     * HTTP request handler
     * @private
     */
    _handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
        if (req.method !== 'GET') {
            res.statusCode = 400
            res.end()
            return
        }
        const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
        const query = url.search.length > 0 ? url.search.substring(1) : null
        const clientIP = req.socket.remoteAddress
        // Log incoming requests to help debug VRChat communication
        console.log(`[OSCQuery] HTTP request from ${clientIP}: ${req.url}`)
        // Handle HOST_INFO query
        if (query === 'HOST_INFO') {
            const hostInfo = {
                NAME: this.appName,
                EXTENSIONS,
                OSC_IP: this.oscAdvertisedIp,
                OSC_PORT: this.oscPort,
                OSC_TRANSPORT: 'UDP',
            }
            console.log(`[OSCQuery] Responding with HOST_INFO: OSC_IP=${this.oscAdvertisedIp}, OSC_PORT=${this.oscPort}`)
            this._respondJson(hostInfo, res)
            return
        }
        // Navigate to requested node
        const pathParts = url.pathname.split('/').filter(p => p !== '')
        let node = this.rootNode
        let currentPath = ''
        for (const part of pathParts) {
            if (!node.children || !node.children[part]) {
                res.statusCode = 404
                res.end()
                return
            }
            node = node.children[part]
            currentPath += '/' + part
        }
        // Return serialized node
        const fullPath = currentPath || '/'
        const serialized = this._serializeNode(node, fullPath)
        this._respondJson(serialized, res)
    }
    /**
     * Send JSON response
     * @private
     */
    _respondJson(json: unknown, res: http.ServerResponse): void {
        res.setHeader('Content-Type', 'application/json')
        res.write(JSON.stringify(json))
        res.end()
    }
    /**
     * Handle received OSC messages and check against unsubscriptions
     * By default, all messages are forwarded unless they match an unsubscription pattern
     * @private
     */
    _handleOscMessage(oscMsg: { address: string; args?: { value?: unknown; type?: string }[] }): void {
        const address = oscMsg.address
        // Update last OSC message time for health monitoring
        this._lastOscMessageTime = Date.now()
        // Check if this message matches any unsubscription (if so, ignore it)
        const isUnsubscribed = this._matchesUnsubscription(address)
        if (isUnsubscribed) {
            // Silently ignore messages that match unsubscription patterns
            return
        }
        // Parse OSC value from args
        let value = null
        let type = 'f'; // default type
        if (oscMsg.args && oscMsg.args.length > 0) {
            const arg = oscMsg.args[0]
            value = arg.value
            type = arg.type || 'f'
        }
        // Emit the OSC message for forwarding
        this.emit('osc-message', {
            address: address,
            value: value,
            type: type,
            timestamp: Date.now()
        })
    }
    /**
     * Check if an OSC address matches any unsubscription pattern
     * @private
     */
    _matchesUnsubscription(address: string): boolean {
        // Check hardcoded unsubscriptions first (cannot be removed by users)
        for (const pattern of this.hardcodedUnsubscriptions) {
            if (this._matchPattern(address, pattern)) {
                return true; // Hardcoded match found, always ignore
            }
        }
        // Check server-managed blocklist (pushed from ARC-OSC server)
        for (const pattern of this.serverBlocklist) {
            if (this._matchPattern(address, pattern)) {
                return true; // Server blocklist match, always ignore
            }
        }
        // Check server-managed suppressions (dynamic rate-based)
        for (const pattern of this.serverSuppressions) {
            if (this._matchPattern(address, pattern)) {
                return true; // Server suppression match, ignore
            }
        }
        // Check user-defined unsubscriptions
        if (this.unsubscriptions.size === 0) {
            return false; // No unsubscriptions, allow
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
    _matchPattern(address: string, pattern: string): boolean {
        // Exact match
        if (address === pattern) {
            return true
        }
        // Wildcard pattern matching
        if (pattern.includes('*')) {
            const regexPattern = pattern
                .replace(/\//g, '\\/')  // Escape slashes
                .replace(/\*/g, '.*');  // Convert * to .*
            const regex = new RegExp(`^${regexPattern}$`)
            return regex.test(address)
        }
        return false
    }
    /**
     * Find an available port
     * @private
     */
    async _findAvailablePort(min: number, max: number): Promise<number> {
        const net = require('net')
        return new Promise((resolve, reject) => {
            const tryPort = (port: number) => {
                if (port > max) {
                    reject(new Error('No available ports found'))
                    return
                }
                const server = net.createServer()
                server.once('error', (err: NodeJS.ErrnoException) => {
                    if (err.code === 'EADDRINUSE') {
                        tryPort(port + 1)
                    } else {
                        reject(err)
                    }
                })
                server.once('listening', () => {
                    server.close(() => {
                        resolve(port)
                    })
                })
                server.listen(port, '0.0.0.0')
            }
            const randomPort = Math.floor(Math.random() * (max - min + 1)) + min
            tryPort(randomPort)
        })
    }
    /**
     * Get the primary local IP address for external communication
     * Used for advertising in HOST_INFO when bound to 0.0.0.0
     * @private
     * @returns {string|null} Primary IPv4 address or null if none found
     */
    _getLocalIpAddress(): string | null {
        const interfaces = os.networkInterfaces()
        for (const name of Object.keys(interfaces)) {
            for (const iface of interfaces[name]!) {
                // Skip loopback and non-IPv4
                if (iface.family === 'IPv4' && !iface.internal) {
                    return iface.address
                }
            }
        }
        return null
    }
    /**
     * Get all local IPv4 addresses
     * @private
     * @returns {string[]} Array of local IPv4 addresses
     */
    _getLocalIpAddresses(): string[] {
        const interfaces = os.networkInterfaces()
        const addresses = []
        for (const name of Object.keys(interfaces)) {
            for (const iface of interfaces[name]!) {
                if (iface.family === 'IPv4' && !iface.internal) {
                    addresses.push(iface.address)
                }
            }
        }
        return addresses
    }
    /**
     * Check if an IP address is a loopback address
     * @private
     * @param {string} ip - IP address to check
     * @returns {boolean} True if loopback
     */
    _isLoopback(ip: string | null): boolean {
        if (!ip) return false
        return ip === '127.0.0.1' || ip === 'localhost' || ip.startsWith('127.')
    }
    /**
     * Start the OSC Query service
     */
    async start(): Promise<{ httpPort: number | null; oscPort: number | null; serviceName: string | null } | void> {
        if (this.isRunning) {
            console.log('[OSCQuery] Service already running')
            return
        }
        try {
            // Generate service name ONCE and reuse it to maintain VRChat connection
            if (!this.assignedAppName) {
                const randomSuffix = Math.random().toString(36).substring(2, 7).toUpperCase()
                this.assignedAppName = `ARC-OSC-Client-${randomSuffix}`
            }
            this.appName = this.assignedAppName
            this._logSection('OSCQuery Service Start')
            this._logKV('Service Name:', this.appName)
            
            // Close any existing OSC UDP port before creating a new one
            if (this.oscUdpPort) {
                try {
                    console.log('  Closing existing OSC UDP port before restart...')
                    this.oscUdpPort.close()
                    this.oscUdpPort = null
                    await new Promise(resolve => setTimeout(resolve, 200))
                } catch (error) {
                    console.error('  Error closing existing OSC UDP port:', error)
                }
            }
            // Create HTTP server
            this.httpServer = http.createServer(this._handleRequest.bind(this))
            await new Promise<void>((resolve, reject) => {
                this.httpServer!.once('error', reject)
                this.httpServer!.listen(this.httpPort!, this.bindAddress, () => {
                    this.httpServer!.removeListener('error', reject)
                    resolve()
                })
            })
            this._logStatus('HTTP Server', true, `${this.bindAddress}:${this.httpPort}`)
            // Create OSC UDP listener on the configured OSC port
            this.oscUdpPort = new osc.UDPPort({
                localAddress: this.bindAddress,
                localPort: this.oscPort,
                metadata: true
            })
            this.oscUdpPort.on('message', (oscMsg) => {
                this._handleOscMessage(oscMsg)
            })
            this.oscUdpPort.on('ready', () => {
                this._logStatus('OSC UDP Listener', true, `${this.bindAddress}:${this.oscPort}`)
            })
            this.oscUdpPort.on('error', (error) => {
                this._logStatus('OSC UDP Listener', false, error.message)
                this.emit('error', error)
            })
            this.oscUdpPort.open()
            
            // Initialize Bonjour for mDNS
            this._logSection('mDNS Configuration')
            const bonjourOpts: Record<string, string> = {}
            if (this.bindAddress && this.bindAddress !== DEFAULT_FALLBACK_ADDRESS) {
                bonjourOpts.interface = this.bindAddress
                this._logKV('mDNS Interface:', this.bindAddress)
            } else {
                this._logKV('mDNS Interface:', 'auto-detect (default)')
            }
            this.bonjour = new Bonjour(bonjourOpts)
            // Advertise service via mDNS
            try {
                const publishConfig = {
                    name: this.appName,
                    type: 'oscjson',
                    port: this.httpPort!,
                    protocol: 'tcp' as const,
                    host: this.oscAdvertisedIp ?? undefined
                }
                console.log(`  Publishing:`)
                this._logKV('  Name:', publishConfig.name)
                this._logKV('  Type:', `_oscjson._tcp`)
                this._logKV('  Port:', publishConfig.port)
                this._logKV('  Protocol:', publishConfig.protocol)
                this._logKV('  Host:', publishConfig.host)
                this.bonjourService = this.bonjour.publish(publishConfig)
                this._logStatus('mDNS Advertisement', true, 'Service published')
                console.log(`  Multicast Address: 224.0.0.251:5353`)
                console.log(`  Discovery Protocol: OSCQuery (oscjson)`)
                console.log(`  VRChat will query _oscjson._tcp on mDNS multicast to find this service`)
            } catch (publishError: unknown) {
                if ((publishError as Error).message && (publishError as Error).message.includes('already in use')) {
                    console.log('  Service name in use, attempting cleanup and retry...')
                    try {
                        if (this.bonjour) {
                            this.bonjour.destroy()
                        }
                        await new Promise(resolve => setTimeout(resolve, 500))
                        const retryBonjourOpts: Record<string, string> = {}
                        if (this.bindAddress && this.bindAddress !== DEFAULT_FALLBACK_ADDRESS) {
                            retryBonjourOpts.interface = this.bindAddress
                        }
                        this.bonjour = new Bonjour(retryBonjourOpts)
                        this.bonjourService = this.bonjour.publish({
                            name: this.appName,
                            type: 'oscjson',
                            port: this.httpPort!,
                            protocol: 'tcp',
                            host: this.oscAdvertisedIp ?? undefined
                        })
                        this._logStatus('mDNS Advertisement', true, 'Published (after retry)')
                    } catch (retryError) {
                        this._logStatus('mDNS Advertisement', false, 'Failed after retry')
                        throw retryError
                    }
                } else {
                    throw publishError
                }
            }
            this.isRunning = true
            this.emit('started', {
                httpPort: this.httpPort,
                oscPort: this.oscPort
            })
            // IMPORTANT: trigger mDNS discovery 1 second after service start to avoid timing bottlenecks
            if (this._discoveryTimer) {
                clearTimeout(this._discoveryTimer)
                this._discoveryTimer = null
            }
            this._discoveryTimer = setTimeout(() => {
                // Only trigger if still running
                if (this.isRunning) {
                    this.triggerDiscovery()
                    // Start continuous VRChat discovery with long-lived browser
                    this._startVRChatDiscovery()
                    // Start periodic mDNS re-advertisement to keep service visible
                    this._startReAdvertiseTimer()
                    // Start OSC data flow monitoring
                    this._startOscFlowMonitor()
                }
            }, 1000)
            return {
                httpPort: this.httpPort,
                oscPort: this.oscPort,
                serviceName: this.appName
            }
        } catch (error) {
            console.error('[OSCQuery] Failed to start service:', error)
            this.emit('error', error)
            throw error
        }
    }
    /**
     * Trigger mDNS discovery to wake up VRChat
     */
    triggerDiscovery(): void {
        if (!this.bonjour) {
            console.warn('  Bonjour not initialized, skipping discovery trigger')
            return
        }
        // Perform a brief scan to wake up the network
        const browser = this.bonjour.find({ type: 'oscjson' }, (service) => {
            // Service found (silent)
        })
        setTimeout(() => {
            try {
                browser.stop()
            } catch (error) {
                // Ignore errors during cleanup
            }
        }, 1000)
    }
    /**
     * Start continuous VRChat discovery using long-lived browser pattern
     * @private
     */
    _startVRChatDiscovery(): void {
        this._stopVRChatDiscovery()
        this._logSection('VRChat Discovery Active')
        this._logKV('Browser Type:', 'persistent (long-lived)')
        this._logKV('Query Type:', '_oscjson._tcp')
        this._logKV('Liveness Check:', 'every 5s')
        try {
            this._persistentBrowser = this.bonjour!.find({ type: 'oscjson' })
            this._persistentBrowser.on('up', async (service) => {
                if (!this.isRunning) return
                await this._handleServiceDiscovered(service)
            })
            this._persistentBrowser.on('down', (service) => {
                if (!this.isRunning) return
                this._handleServiceRemoved(service)
            })
            this._logStatus('mDNS Browser', true, 'Listening for VRChat services')
        } catch (error) {
            this._logStatus('mDNS Browser', false, (error as Error).message)
        }
        this._discoveryInterval = setInterval(() => {
            this._performLivenessCheck()
        }, 5000)
    }
    /**
     * Handle a discovered OSCQuery service
     * @private
     */
    async _handleServiceDiscovered(service: MdnsService): Promise<void> {
        // Only process VRChat client services
        if (!service.name || !service.name.startsWith('VRChat-Client-')) {
            return
        }
        const port = service.port
        const serviceName = service.name
        if (!port) {
            return
        }
        this._logSection('mDNS Service Discovered')
        this._logKV('Service Name:', serviceName)
        // Resolve the host IP with VLAN/cross-network support
        const mdnsReportedHost = service.host || service.addresses?.[0] || '127.0.0.1'
        const packetSourceIp = service.referer?.address
        let host
        let resolutionMethod = 'mDNS reported'
        if (this._isLoopback(mdnsReportedHost) && packetSourceIp && !this._isLoopback(packetSourceIp)) {
            host = packetSourceIp
            resolutionMethod = 'packet source (VLAN/cross-network)'
            this._logStatus('IP Resolution', true, `mDNS said ${mdnsReportedHost}, using packet source ${packetSourceIp}`)
        } else if (this._isLoopback(mdnsReportedHost) || !mdnsReportedHost) {
            host = '127.0.0.1'
            resolutionMethod = 'local loopback'
        } else {
            host = mdnsReportedHost
        }
        this._logKV('Resolved Host:', host)
        this._logKV('OSCQuery Port:', port)
        this._logKV('Resolution Method:', resolutionMethod)
        const oscQueryAddress = `${host}:${port}`
        // Verify the service is alive with HTTP request
        console.log(`  Verifying service at http://${oscQueryAddress}/?HOST_INFO ...`)
        const isAlive = await this._verifyVRChatService(host, port)
        if (isAlive) {
            this._logStatus('HTTP Reachability', true, `http://${oscQueryAddress}`)
            // Get OSC port from HOST_INFO
            const oscPort = await this._getVRChatOscPort(host, port)
            if (oscPort) {
                const oscAddress = `${host}:${oscPort}`
                this._logSection('VRChat Connection Established')
                this._logKV('VRChat Service:', serviceName)
                this._logKV('OSCQuery URL:', oscQueryAddress)
                this._logKV('OSC Data Port:', oscPort)
                this._logKV('OSC Data Target:', oscAddress)
                this._logStatus('Bidirectional OSC', true, 'Ready to send/receive')
                if (this._currentVRChatServiceName && this._currentVRChatServiceName !== serviceName) {
                    console.warn(`  VRChat restart detected: ${this._currentVRChatServiceName} -> ${serviceName}`)
                    this.emit('vrchat-restarted', {
                        oldServiceName: this._currentVRChatServiceName,
                        newServiceName: serviceName
                    })
                }
                this._currentVRChatServiceName = serviceName
                this._livenessCheckFailures = 0
                this._updateVRChatAddresses(oscQueryAddress, oscAddress)
            } else {
                console.warn('  VRChat service alive but HOST_INFO did not contain OSC_PORT')
                this._updateVRChatAddresses(oscQueryAddress, null)
            }
        } else {
            this._logStatus('HTTP Reachability', false, `http://${oscQueryAddress} not responding`)
        }
    }
    /**
     * Handle a removed OSCQuery service
     * Uses same IP resolution logic as discovery for consistency
     * @private
     */
    _handleServiceRemoved(service: MdnsService): void {
        if (!service.name || !service.name.startsWith('VRChat-Client-')) {
            return
        }
        // Use same logic as discovery to determine the host
        const mdnsReportedHost = service.host || service.addresses?.[0] || '127.0.0.1'
        const packetSourceIp = service.referer?.address
        let host
        if (this._isLoopback(mdnsReportedHost) && packetSourceIp && !this._isLoopback(packetSourceIp)) {
            host = packetSourceIp
        } else if (this._isLoopback(mdnsReportedHost) || !mdnsReportedHost) {
            host = '127.0.0.1'
        } else {
            host = mdnsReportedHost
        }
        const port = service.port
        const oscQueryAddress = `${host}:${port}`
        console.log(`[OSCQuery] VRChat service removed: ${service.name} at ${oscQueryAddress}`)
        // Only clear if this was our current connection
        if (this._currentVRChatOscQueryAddress === oscQueryAddress) {
            this._updateVRChatAddresses(null, null)
            this._currentVRChatServiceName = null
        }
    }
    /**
     * Perform liveness check on current VRChat connection
     * Verifies the current connection is still responsive
     * @private
     */
    async _performLivenessCheck(): Promise<void> {
        if (!this.isRunning || !this._currentVRChatOscQueryAddress) {
            return
        }
        try {
            const [host, portStr] = this._currentVRChatOscQueryAddress.split(':')
            const port = parseInt(portStr, 10)
            const isAlive = await this._verifyVRChatService(host, port)
            if (isAlive) {
                if (this._livenessCheckFailures > 0) {
                    this._logStatus('VRChat Connection', true, `Restored after ${this._livenessCheckFailures} failure(s)`)
                }
                this._livenessCheckFailures = 0
            } else {
                this._livenessCheckFailures++
                console.warn(`  Liveness check FAILED (${this._livenessCheckFailures}/${this.LIVENESS_FAILURE_THRESHOLD})`)
                if (this._livenessCheckFailures >= this.LIVENESS_FAILURE_THRESHOLD) {
                    console.warn('  VRChat connection LOST - clearing addresses, will re-discover')
                    this._updateVRChatAddresses(null, null)
                    this._currentVRChatServiceName = null
                    this._livenessCheckFailures = 0
                    this.emit('vrchat-connection-lost')
                }
            }
        } catch (error) {
            console.error('  Liveness check error:', error)
        }
    }
    /**
     * Stop continuous VRChat discovery
     * @private
     */
    _stopVRChatDiscovery(): void {
        // Stop the long-lived browser
        if (this._persistentBrowser) {
            try {
                this._persistentBrowser.stop()
                this._persistentBrowser = null
                console.log('[OSCQuery] Long-lived browser stopped')
            } catch (error) {
                // Ignore cleanup errors
            }
        }
        // Stop the liveness check interval
        if (this._discoveryInterval) {
            clearInterval(this._discoveryInterval)
            this._discoveryInterval = null
            console.log('[OSCQuery] Stopped liveness check interval')
        }
    }
    /**
     * Start periodic mDNS re-advertisement to keep service visible
     * Helps with Windows mDNS cache issues
     * @private
     */
    _startReAdvertiseTimer(): void {
        this._stopReAdvertiseTimer()
        console.log(`[OSCQuery] Starting periodic re-advertisement (every ${this.READVERTISE_INTERVAL / 1000}s)`)
        this._reAdvertiseInterval = setInterval(() => {
            if (this.isRunning && this.bonjour) {
                // Trigger a discovery scan to "wake up" the network
                // This helps Windows see our service after mDNS cache expires
                this.triggerDiscovery()
            }
        }, this.READVERTISE_INTERVAL)
    }
    /**
     * Stop periodic re-advertisement timer
     * @private
     */
    _stopReAdvertiseTimer(): void {
        if (this._reAdvertiseInterval) {
            clearInterval(this._reAdvertiseInterval)
            this._reAdvertiseInterval = null
        }
    }
    /**
     * Start OSC data flow monitoring
     * Detects when OSC data stops flowing and triggers reconnection
     * @private
     */
    _startOscFlowMonitor(): void {
        this._stopOscFlowMonitor()
        // Initialize last message time
        this._lastOscMessageTime = null
        console.log('[OSCQuery] Starting OSC data flow monitoring')
        this._oscFlowMonitorInterval = setInterval(() => {
            if (!this.isRunning || !this._currentVRChatOscQueryAddress) {
                return; // Not connected, nothing to monitor
            }
            if (!this._lastOscMessageTime) {
                return; // Haven't received any OSC yet, skip check
            }
            const timeSinceLastMessage = Date.now() - this._lastOscMessageTime
            if (timeSinceLastMessage >= this.OSC_FLOW_TIMEOUT_RECONNECT) {
                // No data for 60+ seconds, trigger reconnection
                console.log(`[OSCQuery] No OSC data for ${Math.round(timeSinceLastMessage / 1000)}s - triggering reconnection`)
                this.emit('osc-flow-timeout', {
                    lastMessageTime: this._lastOscMessageTime,
                    timeout: timeSinceLastMessage
                })
                // Force a re-discovery and re-advertisement
                this.triggerDiscovery()
                // Reset the timer to avoid spamming
                this._lastOscMessageTime = Date.now()
            } else if (timeSinceLastMessage >= this.OSC_FLOW_TIMEOUT_WARNING) {
                // No data for 30+ seconds, emit warning
                this.emit('osc-flow-warning', {
                    lastMessageTime: this._lastOscMessageTime,
                    timeout: timeSinceLastMessage
                })
            }
        }, 10000); // Check every 10 seconds
    }
    /**
     * Stop OSC data flow monitoring
     * @private
     */
    _stopOscFlowMonitor(): void {
        if (this._oscFlowMonitorInterval) {
            clearInterval(this._oscFlowMonitorInterval)
            this._oscFlowMonitorInterval = null
        }
    }
    /**
     * Verify a VRChat OSCQuery service is alive by making HTTP request
     * @private
     */
    async _verifyVRChatService(host: string, port: number): Promise<boolean> {
        return new Promise((resolve) => {
            const url = `http://${host}:${port}/?HOST_INFO`
            
            const req = http.get(url, { timeout: 2000 }, (res) => {
                // Service is alive if we get a 200 response
                resolve(res.statusCode === 200)
                res.resume(); // Consume response data
            })
            req.on('error', () => {
                resolve(false)
            })
            req.on('timeout', () => {
                req.destroy()
                resolve(false)
            })
        })
    }
    /**
     * Get VRChat's OSC port from HOST_INFO endpoint
     * @private
     */
    async _getVRChatOscPort(host: string, port: number): Promise<number | null> {
        return new Promise((resolve) => {
            const url = `http://${host}:${port}/?HOST_INFO`
            const req = http.get(url, { timeout: 2000 }, (res) => {
                if (res.statusCode !== 200) {
                    resolve(null)
                    return
                }
                let data = ''
                res.on('data', (chunk) => {
                    data += chunk
                })
                res.on('end', () => {
                    try {
                        const hostInfo = JSON.parse(data)
                        resolve(hostInfo.OSC_PORT || null)
                    } catch (error) {
                        console.error('[OSCQuery] Failed to parse HOST_INFO:', error)
                        resolve(null)
                    }
                })
            })
            req.on('error', () => {
                resolve(null)
            })
            req.on('timeout', () => {
                req.destroy()
                resolve(null)
            })
        })
    }
    /**
     * Update VRChat addresses and emit events if changed
     * @private
     */
    _updateVRChatAddresses(oscQueryAddress: string | null, oscAddress: string | null): void {
        let changed = false
        if (this._currentVRChatOscQueryAddress !== oscQueryAddress) {
            const previousAddress = this._currentVRChatOscQueryAddress
            this._currentVRChatOscQueryAddress = oscQueryAddress
            changed = true
            if (oscQueryAddress) {
                console.log(`  OSCQuery endpoint: ${oscQueryAddress}`)
            } else if (previousAddress) {
                console.warn(`  OSCQuery endpoint: LOST (${previousAddress})`)
            }
            this.emit('vrchat-oscquery-address-changed', oscQueryAddress)
        }
        if (this._currentVRChatOscAddress !== oscAddress) {
            const previousAddress = this._currentVRChatOscAddress
            this._currentVRChatOscAddress = oscAddress
            changed = true
            if (oscAddress) {
                console.log(`  OSC Data endpoint: ${oscAddress}`)
            } else if (previousAddress) {
                console.warn(`  OSC Data endpoint: LOST (${previousAddress})`)
            }
            this.emit('vrchat-osc-address-changed', oscAddress)
        }
        if (changed) {
            this.emit('vrchat-addresses-changed', {
                oscQueryAddress: this._currentVRChatOscQueryAddress,
                oscAddress: this._currentVRChatOscAddress
            })
        }
    }
    /**
     * Get current VRChat OSCQuery address (null if not found)
     */
    getVRChatOscQueryAddress(): string | null {
        return this._currentVRChatOscQueryAddress
    }
    /**
     * Get current VRChat OSC address (null if not found)
     */
    getVRChatOscAddress(): string | null {
        return this._currentVRChatOscAddress
    }
    /**
     * Stop the OSC Query service
     */
    async stop(): Promise<void> {
        if (!this.isRunning) {
            return
        }
        try {
            this._logSection('OSCQuery Service Stop')
            if (this._discoveryTimer) {
                clearTimeout(this._discoveryTimer)
                this._discoveryTimer = null
            }
            this._stopVRChatDiscovery()
            this._stopReAdvertiseTimer()
            this._stopOscFlowMonitor()
            this._livenessCheckFailures = 0
            this._lastOscMessageTime = null
            this._currentVRChatServiceName = null
            if (this.oscUdpPort) {
                try {
                    this.oscUdpPort.removeAllListeners()
                    this.oscUdpPort.close()
                    this.oscUdpPort = null
                    this._logStatus('OSC UDP Listener', true, 'Stopped')
                    await new Promise(resolve => setTimeout(resolve, 200))
                } catch (error) {
                    this._logStatus('OSC UDP Listener', false, (error as Error).message)
                }
            }
            if (this.vrchatListenerPort) {
                try {
                    this.vrchatListenerPort.removeAllListeners()
                    this.vrchatListenerPort.close()
                    this.vrchatListenerPort = null
                    await new Promise(resolve => setTimeout(resolve, 100))
                } catch (error) {
                    // ignore
                }
            }
            if (this.bonjourService) {
                try {
                    this.bonjourService.stop?.()
                    this.bonjourService = null
                    this._logStatus('mDNS Advertisement', true, 'Unpublished')
                } catch (error) {
                    this._logStatus('mDNS Advertisement', false, (error as Error).message)
                }
            }
            if (this.bonjour) {
                try {
                    this.bonjour.destroy()
                    await new Promise(resolve => setTimeout(resolve, 100))
                    this.bonjour = null
                } catch (error) {
                    // ignore
                }
            }
            if (this.httpServer) {
                await new Promise<void>((resolve) => {
                    this.httpServer!.close(() => {
                        this.httpServer = null
                        resolve()
                    })
                })
                this._logStatus('HTTP Server', true, 'Stopped')
            }
            this.isRunning = false
            this.emit('stopped')
            console.log('  Service shutdown complete')
        } catch (error) {
            console.error('  Error during shutdown:', error)
            this.emit('error', error)
        }
    }
    /**
     * Add an unsubscription path (messages matching this will be ignored)
     */
    addUnsubscription(path: string): void {
        this.unsubscriptions.add(path)
        console.log(`[OSCQuery] Added unsubscription: ${path}`)
        this.emit('unsubscription-added', path)
    }
    
    /**
     * Remove an unsubscription path (messages will be allowed again)
     * Note: Hardcoded unsubscriptions cannot be removed
     */
    removeUnsubscription(path: string): boolean {
        if (this.hardcodedUnsubscriptions.has(path)) {
            console.warn(`[OSCQuery] Cannot remove hardcoded unsubscription: ${path}`)
            return false
        }
        this.unsubscriptions.delete(path)
        console.log(`[OSCQuery] Removed unsubscription: ${path}`)
        this.emit('unsubscription-removed', path)
        return true
    }
    
    /**
     * Set unsubscription paths (replaces all existing unsubscriptions)
     * Note: Hardcoded unsubscriptions are always preserved
     */
    setUnsubscriptions(paths: string[]): void {
        this.unsubscriptions.clear()
        if (Array.isArray(paths)) {
            paths.forEach(path => {
                // Don't add hardcoded paths to user unsubscriptions (they're already handled separately)
                if (!this.hardcodedUnsubscriptions.has(path)) {
                    this.unsubscriptions.add(path)
                }
            })
            console.log(`[OSCQuery] Set ${this.unsubscriptions.size} user unsubscription(s):`, Array.from(this.unsubscriptions))
            this.emit('unsubscriptions-updated', Array.from(this.unsubscriptions))
        }
    }
    /**
     * Get all current unsubscriptions (includes hardcoded, server-managed, and user-defined)
     */
    getUnsubscriptions(): string[] {
        const all = new Set([...this.hardcodedUnsubscriptions, ...this.serverBlocklist, ...this.serverSuppressions, ...this.unsubscriptions])
        return Array.from(all)
    }
    /**
     * Get only user-defined unsubscriptions (excludes hardcoded ones)
     */
    getUserUnsubscriptions(): string[] {
        return Array.from(this.unsubscriptions)
    }
    
    /**
     * Get only hardcoded unsubscriptions (cannot be removed)
     */
    getHardcodedUnsubscriptions(): string[] {
        return Array.from(this.hardcodedUnsubscriptions)
    }
    /**
     * Clear all user-defined unsubscriptions (hardcoded unsubscriptions remain)
     */
    clearUnsubscriptions(): void {
        this.unsubscriptions.clear()
        console.log('[OSCQuery] Cleared user-defined unsubscriptions - hardcoded unsubscriptions still active')
        this.emit('unsubscriptions-cleared')
    }
    /**
     * Get service status
     */
    getStatus(): Record<string, unknown> {
        const now = Date.now()
        const timeSinceLastOsc = this._lastOscMessageTime ? now - this._lastOscMessageTime : null
        return {
            isRunning: this.isRunning,
            httpPort: this.httpPort,
            oscPort: this.oscPort,
            serviceName: this.appName,
            unsubscriptions: this.getUnsubscriptions(),
            vrchatOscQueryAddress: this._currentVRChatOscQueryAddress,
            vrchatOscAddress: this._currentVRChatOscAddress,
            // Health monitoring info
            vrchatServiceName: this._currentVRChatServiceName,
            livenessCheckFailures: this._livenessCheckFailures,
            lastOscMessageTime: this._lastOscMessageTime,
            timeSinceLastOscMessage: timeSinceLastOsc,
            isVRChatConnected: !!this._currentVRChatOscQueryAddress,
            isReceivingOscData: timeSinceLastOsc !== null && timeSinceLastOsc < this.OSC_FLOW_TIMEOUT_WARNING
        }
    }
    /**
     * Get detailed network diagnostics for troubleshooting mDNS discovery issues
     * Useful when VRChat doesn't detect the OSCQuery service
     */
    getNetworkDiagnostics(): Record<string, unknown> {
        const interfaces = os.networkInterfaces()
        const interfaceDetails: Record<string, { address: string; family: string; internal: boolean }[]> = {}
        for (const [name, addrs] of Object.entries(interfaces)) {
            interfaceDetails[name] = (addrs || []).map(iface => ({
                address: iface.address,
                family: iface.family,
                internal: iface.internal
            }))
        }
        return {
            isRunning: this.isRunning,
            bindAddress: this.bindAddress,
            advertisedIp: this.oscAdvertisedIp,
            detectedLanIp: this._getLocalIpAddress(),
            allLocalIps: this._localIpAddresses,
            isLoopbackBind: this._isLoopback(this.bindAddress),
            networkInterfaces: interfaceDetails,
            bonjourActive: !!this.bonjour,
            bonjourServiceActive: !!this.bonjourService,
            httpPort: this.httpPort,
            oscPort: this.oscPort,
            serviceName: this.appName,
            // Common issues checklist
            diagnostics: {
                hasNonLoopbackIp: this._localIpAddresses.length > 0,
                advertisedIpIsLoopback: this._isLoopback(this.oscAdvertisedIp),
                interfaceCount: Object.keys(interfaces).length,
                nonInternalInterfaces: Object.entries(interfaces)
                    .filter(([, addrs]) => (addrs || []).some(a => !a.internal && a.family === 'IPv4'))
                    .map(([name]) => name)
            }
        }
    }
    /**
     * Force a reconnection attempt
     * Useful when the user suspects the connection is stale
     */
    forceReconnect(): boolean {
        if (!this.isRunning) {
            console.warn('[OSCQuery] Cannot force reconnect - service is not running')
            return false
        }
        console.log('[OSCQuery] Forcing reconnection...')
        // Clear current connection state
        this._currentVRChatOscQueryAddress = null
        this._currentVRChatOscAddress = null
        this._currentVRChatServiceName = null
        this._livenessCheckFailures = 0
        // Trigger discovery
        this.triggerDiscovery()
        this.emit('force-reconnect')
        return true
    }
    /**
     * Reset port assignments (will assign new random ports on next initialize)
     * Useful for troubleshooting or forcing VRChat to rediscover the service
     */
    resetPorts(): boolean {
        if (this.isRunning) {
            console.warn('[OSCQuery] Cannot reset ports while service is running. Stop the service first.')
            return false
        }
        console.log('[OSCQuery] Resetting port assignments - new ports will be assigned on next initialize')
        this.assignedHttpPort = null
        this.assignedOscPort = null
        this.httpPort = null
        this.oscPort = null
        return true
    }
    /**
     * Reset service name (will generate new name on next start)
     * Useful for forcing VRChat to see this as a new service
     */
    resetServiceName(): boolean {
        if (this.isRunning) {
            console.warn('[OSCQuery] Cannot reset service name while service is running. Stop the service first.')
            return false
        }
        console.log('[OSCQuery] Resetting service name - new name will be generated on next start')
        this.assignedAppName = null
        this.appName = null
        return true
    }
    /**
     * Set server-managed blocklist patterns (pushed from ARC-OSC server)
     * These cannot be removed by the user
     */
    setServerBlocklist(patterns: string[]): void {
        this.serverBlocklist.clear()
        if (Array.isArray(patterns)) {
            patterns.forEach(pattern => this.serverBlocklist.add(pattern))
        }
        console.log(`[OSCQuery] Server blocklist updated: ${this.serverBlocklist.size} pattern(s)`)
        this.emit('server-blocklist-updated', Array.from(this.serverBlocklist))
    }
    /**
     * Get server-managed blocklist patterns
     */
    getServerBlocklist(): string[] {
        return Array.from(this.serverBlocklist)
    }
    /**
     * Register an address as local-only (modules receive it, but it is never forwarded to the server)
     */
    addLocalOnlyAddress(address: string): void {
        this.localOnlyPatterns.add(address)
    }
    /**
     * Unregister a local-only address (restores normal forwarding)
     */
    removeLocalOnlyAddress(address: string): void {
        this.localOnlyPatterns.delete(address)
    }
    /**
     * Returns true if the address should be handled locally and not forwarded to the server
     */
    isLocalOnly(address: string): boolean {
        return this.localOnlyPatterns.has(address)
    }
    /**
     * Add server-managed suppression addresses (from rate monitoring)
     */
    addServerSuppressions(addresses: string[], metadata?: Record<string, SuppressionMetadata>): void {
        if (Array.isArray(addresses)) {
            addresses.forEach(addr => this.serverSuppressions.add(addr))
            // Store per-address metadata if provided
            if (metadata && typeof metadata === 'object') {
                Object.assign(this.serverSuppressionMetadata, metadata)
            }
            console.log(`[OSCQuery] Server suppressions added: ${addresses.length} address(es), total: ${this.serverSuppressions.size}`)
            this.emit('server-suppressions-updated', Array.from(this.serverSuppressions))
        }
    }
    /**
     * Remove server-managed suppression addresses (staff unsuppressed)
     */
    removeServerSuppressions(addresses: string[]): void {
        if (Array.isArray(addresses)) {
            addresses.forEach(addr => {
                this.serverSuppressions.delete(addr)
                delete this.serverSuppressionMetadata[addr]
            })
            console.log(`[OSCQuery] Server suppressions removed: ${addresses.length} address(es), remaining: ${this.serverSuppressions.size}`)
            this.emit('server-suppressions-updated', Array.from(this.serverSuppressions))
        }
    }
    /**
     * Clear all server suppressions (e.g., on avatar change)
     */
    clearServerSuppressions(): void {
        this.serverSuppressions.clear()
        this.serverSuppressionMetadata = {}
        console.log('[OSCQuery] Server suppressions cleared')
        this.emit('server-suppressions-updated', [])
    }
    /**
     * Get server-managed suppression addresses
     */
    getServerSuppressions(): string[] {
        return Array.from(this.serverSuppressions)
    }
    /**
     * Get per-address metadata for server suppressions
     */
    getServerSuppressionMetadata(): SuppressionMetadata {
        return { ...this.serverSuppressionMetadata }
    }
    /**
     * Reset everything (ports and service name)
     * Forces complete re-initialization on next start
     */
    resetAll(): boolean {
        if (this.isRunning) {
            console.warn('[OSCQuery] Cannot reset while service is running. Stop the service first.')
            return false
        }
        console.log('[OSCQuery] Resetting all persistent state - service will fully re-initialize on next start')
        this.assignedHttpPort = null
        this.assignedOscPort = null
        this.assignedAppName = null
        this.httpPort = null
        this.oscPort = null
        this.appName = null
        return true
    }
}
export { OSCQueryService, OSCQAccess, OSCTypeSimple }
