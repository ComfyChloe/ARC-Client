import osc from 'osc'
import { EventEmitter } from 'node:events'
import debug from './debugger'

const BIND_ALL = '0.0.0.0'

interface OscArg {
  type: string
  value?: unknown
}

interface OscMessage {
  address: string
  args: OscArg[]
}

interface AdditionalConnection {
  id: string
  name?: string
  type: 'incoming' | 'outgoing'
  enabled: boolean
  port: number
  address?: string
}

interface PortData {
  client?: InstanceType<typeof osc.UDPPort> & { _handle?: unknown; isOpen?: boolean; options?: Record<string, unknown> }
}

interface AdditionalPortDetail {
  connectionId: string
  type: string | undefined
  name: string | undefined
  port: number | undefined
  address: string | undefined
  enabled: boolean | undefined
  hasClient: boolean
}

class OscService extends EventEmitter {
  primaryUdpPort: (InstanceType<typeof osc.UDPPort> & { options?: Record<string, unknown> }) | null
  additionalPorts: Map<string, PortData>
  isListening: boolean
  localPort: number | null
  targetPort: number
  targetAddress: string
  bindAddress: string
  additionalConnections: AdditionalConnection[]
  oscLeashListeners: Map<string, (value: unknown) => void>

  constructor() {
    super()
    this.primaryUdpPort = null
    this.additionalPorts = new Map()
    this.isListening = false
    this.localPort = null
    this.targetPort = 9000
    this.targetAddress = '127.0.0.1'
    this.bindAddress = BIND_ALL
    this.additionalConnections = []
    this.oscLeashListeners = new Map()
  }
  initialize(localPort: number | null = null, targetPort = 9000, targetAddress = '127.0.0.1', bindAddress = BIND_ALL): boolean {
    this.targetPort = targetPort
    this.targetAddress = targetAddress
    this.bindAddress = bindAddress
    if (localPort === null) {
      this.localPort = this.findAvailablePort(9001, 9100)
    } else {
      this.localPort = localPort
    }
    try {
      this.primaryUdpPort = new osc.UDPPort({
        localAddress: bindAddress,
        localPort: this.localPort,
        remoteAddress: this.targetAddress,
        remotePort: this.targetPort,
        metadata: true
      })
      this.setupEventHandlers()
      return true
    } catch (error) {
      const err = error as Error
      debug.error(`Failed to initialize OSC service: ${err.message}`, {
        localPort: this.localPort,
        targetPort,
        targetAddress,
        stack: err.stack
      })
      this.emit('error', error)
      return false
    }
  }
  setupEventHandlers(): void {
    this.primaryUdpPort!.on("ready", () => {
      this.isListening = true
      this.emit('ready', {
        localPort: this.localPort,
        targetPort: this.targetPort,
        targetAddress: this.targetAddress
      })
    })
    this.primaryUdpPort!.on("message", (oscMessage: OscMessage) => {
      if (this.oscLeashListeners.size > 0) {
        const address = oscMessage.address
        const callback = this.oscLeashListeners.get(address)
        if (callback) {
          try {
            const value = oscMessage.args && oscMessage.args.length > 0 ? oscMessage.args[0].value : 0
            callback(value)
          } catch (error) {
            const err = error as Error
            debug.error(`Error in OSCLeash listener for ${address}: ${err.message}`, {
              address,
              stack: err.stack
            })
          }
        }
      }
    })
    this.primaryUdpPort!.on("error", (error: Error & { code?: string }) => {
      debug.error(`OSC UDP port error: ${error.message}`, {
        code: error.code,
        port: this.localPort,
        stack: error.stack
      })
      this.emit('error', error)
    })
  }
  setAdditionalConnections(connections: AdditionalConnection[]): void {
    this.additionalConnections = connections || []
    console.log(`Setting up ${this.additionalConnections.length} additional OSC connections`)
    this.setupAdditionalPorts()
  }
  updateAdditionalConnections(connections: AdditionalConnection[]): void {
    this.additionalConnections = connections || []
    console.log(`Updating ${this.additionalConnections.length} additional OSC connections (enabled: ${this.additionalConnections.filter(c => c.enabled).length})`)
    this.setupAdditionalPorts()
  }
  setupAdditionalPorts(): void {
    this.additionalPorts.forEach((portData, portId) => {
      if (portData.client) {
        try {
          portData.client.close()
        } catch (err) {
          console.warn(`Error closing additional client ${portId}:`, err)
        }
      }
    })
    this.additionalPorts.clear()
    
    this.additionalConnections.forEach(connection => {
      if (!connection.enabled || !connection.port || connection.type !== 'outgoing') {
        console.log(`Skipping connection ${connection.name || connection.id}: enabled=${connection.enabled}, port=${connection.port}, type=${connection.type}`)
        return
      }
      console.log(`Setting up ${connection.type} connection: ${connection.name || connection.id} on port ${connection.port}`)
      const portData: PortData = {}
      
      try {
        portData.client = new osc.UDPPort({
          localAddress: this.bindAddress ?? BIND_ALL,
          localPort: 0,
          remoteAddress: connection.address || '127.0.0.1',
          remotePort: connection.port,
          metadata: true
        })
        
        portData.client.on("ready", () => {
          console.log(`Additional outgoing port ready: ${connection.name} to ${connection.address}:${connection.port}`)
          this.emit('additionalPortReady', {
            connectionId: connection.id,
            type: 'outgoing',
            port: connection.port,
            address: connection.address,
            name: connection.name
          })
        })
        
        portData.client.on("error", (error: Error) => {
          console.error(`Additional outgoing port error for ${connection.name}:`, error)
          this.emit('additionalPortError', {
            connectionId: connection.id,
            type: 'outgoing',
            port: connection.port,
            name: connection.name,
            error
          })
        })
        
        if (this.isListening) {
          portData.client.open()
        }
      } catch (error) {
        console.error(`Failed to create outgoing port for ${connection.name}:`, error)
        this.emit('additionalPortError', {
          connectionId: connection.id,
          type: 'outgoing',
          port: connection.port,
          name: connection.name,
          error
        })
      }
      
      this.additionalPorts.set(connection.id, portData)
    })
    
    console.log(`Setup complete: ${this.additionalPorts.size} additional ports active`)
  }
  
  start(): boolean {
    if (!this.primaryUdpPort) {
      const error = new Error('OSC service not initialized')
      debug.error('Attempted to start OSC service without initialization')
      this.emit('error', error)
      return false
    }
    try {
      this.primaryUdpPort.open()
      
      this.additionalPorts.forEach((portData, connectionId) => {
        const connection = this.additionalConnections.find(c => c.id === connectionId)
        if (portData.client) {
          try {
            portData.client.open()
            console.log(`Opened additional outgoing port for ${connection?.name || connectionId}`)
          } catch (err) {
            debug.warn(`Error opening additional outgoing port for ${connection?.name || connectionId}: ${(err as Error).message}`)
          }
        }
      })
      
      return true
    } catch (error) {
      const err = error as Error
      debug.error(`Failed to start OSC service: ${err.message}`, {
        localPort: this.localPort,
        stack: err.stack
      })
      this.emit('error', error)
      return false
    }
  }
  
  stop(): boolean {
    this.removeAllListeners()
    if (this.primaryUdpPort && this.isListening) {
      try {
        this.primaryUdpPort.removeAllListeners()
        this.primaryUdpPort.close()
      } catch (error) {
        const err = error as Error & { code?: string }
        if (err.code !== 'ERR_SOCKET_DGRAM_NOT_RUNNING') {
          debug.error(`Error stopping primary UDP port: ${err.message}`, {
            code: err.code,
            stack: err.stack
          })
        }
      }
    }
    
    this.additionalPorts.forEach((portData, connectionId) => {
      if (portData.client) {
        try {
          portData.client.removeAllListeners()
          if (portData.client._handle) {
            portData.client.close()
          }
        } catch (err) {
          const e = err as Error & { code?: string }
          if (e.code !== 'ERR_SOCKET_DGRAM_NOT_RUNNING') {
            debug.error(`Error closing additional client ${connectionId}: ${e.message}`)
          }
        }
      }
    })
    this.additionalPorts.clear()
    this.primaryUdpPort = null
    
    this.isListening = false
    this.emit('stopped')
    console.log('OSC Service stopped - all connections closed')
    return true
  }
  sendMessageToConnection(connectionId: string, address: string, value: unknown, type = 'f', rawMessage: OscMessage | null = null): boolean {
    const portData = this.additionalPorts.get(connectionId)
    if (!portData || !portData.client) {
      this.emit('error', new Error(`Outgoing connection ${connectionId} not available for sending`))
      return false
    }
    if (typeof portData.client.isOpen === 'boolean' && !portData.client.isOpen) {
      this.emit('error', new Error(`Outgoing connection ${connectionId} is not ready`))
      return false
    }
    try {
      const message = rawMessage || this.formatOscMessage(address, value, type)
      portData.client.send(message)
      this.emit('messageSent', { address, value, type, connectionId })
      return true
    } catch (error) {
      this.emit('error', error)
      return false
    }
  }
  broadcastToAllOutgoing(address: string, value: unknown, type = 'f'): number {
    let successCount = 0
    const outgoingConnections = this.additionalConnections.filter(conn => 
      conn.type === 'outgoing' && conn.enabled
    )
    
    const message = this.formatOscMessage(address, value, type)
    
    outgoingConnections.forEach(connection => {
      const portData = this.additionalPorts.get(connection.id)
      if (portData && portData.client) {
        try {
          portData.client.send(message)
          this.emit('messageSent', { address, value, type, connectionId: connection.id })
          successCount++
        } catch (error) {
          console.error(`Error broadcasting to ${connection.name}:`, error)
          this.emit('error', error)
        }
      } else {
        console.warn(`Outgoing connection ${connection.name} not available for broadcast`)
      }
    })
    
    return successCount
  }
  formatOscMessage(address: string, value: unknown, type: string): OscMessage {
    let oscType = type
    let oscValue: unknown = value
    switch (type) {
      case 'float':
      case 'f':
        oscType = 'f'
        oscValue = parseFloat(String(value))
        break
      case 'int':
      case 'i':
        oscType = 'i'
        oscValue = parseInt(String(value))
        break
      case 'bool':
      case 'T':
      case 'F':
        oscType = value ? 'T' : 'F'
        oscValue = undefined
        break
      case 'string':
      case 's':
        oscType = 's'
        oscValue = String(value)
        break
      default:
        oscType = 'f'
        oscValue = parseFloat(String(value))
    }
    const message: OscMessage = {
      address: address,
      args: oscType === 'T' || oscType === 'F' ? [] : [{ type: oscType, value: oscValue }]
    }
    if (oscType === 'T' || oscType === 'F') {
      message.args = [{ type: oscType }]
    }
    return message
  }
  sendMessage(address: string, value: unknown, type = 'f'): boolean {
    if (!this.primaryUdpPort || !this.isListening) {
      return false
    }
    try {
      const message = this.formatOscMessage(address, value, type)
      this.primaryUdpPort.send(message)
      this.emit('messageSent', { address, value, type })
      return true
    } catch (error) {
      const err = error as Error
      debug.error(`Error sending primary OSC message: ${err.message}`, {
        address,
        value,
        type,
        stack: err.stack
      })
      this.emit('error', error)
      return false
    }
  }
  setTargetConfig(targetAddress: string, targetPort: number): void {
    this.targetAddress = targetAddress
    this.targetPort = targetPort
    if (this.primaryUdpPort) {
      this.primaryUdpPort.options!.remoteAddress = targetAddress
      this.primaryUdpPort.options!.remotePort = targetPort
    }
  }
  getConfig(): { localPort: number | null; targetPort: number; targetAddress: string; isListening: boolean } {
    return {
      localPort: this.localPort,
      targetPort: this.targetPort,
      targetAddress: this.targetAddress,
      isListening: this.isListening
    }
  }
  findAvailablePort(startPort: number, endPort: number): number {
    const net = require('net')
    for (let port = startPort; port <= endPort; port++) {
      try {
        const server = net.createServer()
        server.listen(port, () => {
          server.close()
        })
        return port
      } catch (_error) {
        continue
      }
    }
    return startPort
  }
  getStatus(): {
    isListening: boolean
    localPort: number | null
    targetPort: number
    targetAddress: string
    additionalConnections: number
    activeAdditionalPorts: number
    outgoingConnections: number
    primaryPortReady: boolean
    additionalPortsDetails: AdditionalPortDetail[]
  } {
    const status = {
      isListening: this.isListening,
      localPort: this.localPort,
      targetPort: this.targetPort,
      targetAddress: this.targetAddress,
      additionalConnections: this.additionalConnections.length,
      activeAdditionalPorts: this.additionalPorts.size,
      outgoingConnections: this.additionalConnections.filter(c => c.type === 'outgoing').length,
      primaryPortReady: !!(this.primaryUdpPort && this.isListening),
      additionalPortsDetails: [] as AdditionalPortDetail[]
    }
    this.additionalPorts.forEach((portData, connectionId) => {
      const connection = this.additionalConnections.find(c => c.id === connectionId)
      status.additionalPortsDetails.push({
        connectionId,
        type: connection?.type,
        name: connection?.name,
        port: connection?.port,
        address: connection?.address,
        enabled: connection?.enabled,
        hasClient: !!portData.client
      })
    })
    return status
  }

  registerOSCLeashListener(address: string, callback: (value: unknown) => void): void {
    this.oscLeashListeners.set(address, callback)
  }
  unregisterOSCLeashListener(address: string): void {
    this.oscLeashListeners.delete(address)
  }
}
export default OscService
