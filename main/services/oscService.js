const osc = require('osc');
const EventEmitter = require('events');
import debug from './debugger';

class OscService extends EventEmitter {
  constructor() {
    super();
    this.primaryUdpPort = null;
    this.additionalPorts = new Map(); // Map of portId -> { outgoing: Client }
    this.isListening = false;
    this.localPort = null;
    this.targetPort = 9000;
    this.targetAddress = '127.0.0.1';
    this.additionalConnections = [];
    this.oscLeashListeners = new Map(); // Map of address -> callback for OSCLeash
  }
  initialize(localPort = null, targetPort = 9000, targetAddress = '127.0.0.1') {
    this.targetPort = targetPort;
    this.targetAddress = targetAddress;
    if (localPort === null) {
      this.localPort = this.findAvailablePort(9001, 9100);
    } else {
      this.localPort = localPort;
    }
    try {
      this.primaryUdpPort = new osc.UDPPort({
        localAddress: "0.0.0.0",
        localPort: this.localPort, // Listen on the local port for incoming messages
        remoteAddress: this.targetAddress,
        remotePort: this.targetPort,
        metadata: true
      });
      this.setupEventHandlers();
      return true;
    } catch (error) {
      debug.error(`Failed to initialize OSC service: ${error.message}`, {
        localPort: this.localPort,
        targetPort,
        targetAddress,
        stack: error.stack
      });
      this.emit('error', error);
      return false;
    }
  }
  setupEventHandlers() {
    this.primaryUdpPort.on("ready", () => {
      this.isListening = true;
      this.emit('ready', {
        localPort: this.localPort,
        targetPort: this.targetPort,
        targetAddress: this.targetAddress
      });
    });
    this.primaryUdpPort.on("message", (oscMessage) => {
      // Handle incoming OSC messages for OSCLeash
      if (this.oscLeashListeners.size > 0) {
        const address = oscMessage.address;
        const callback = this.oscLeashListeners.get(address);
        if (callback) {
          try {
            const value = oscMessage.args && oscMessage.args.length > 0 ? oscMessage.args[0].value : 0;
            callback(value);
          } catch (error) {
            debug.error(`Error in OSCLeash listener for ${address}: ${error.message}`, {
              address,
              stack: error.stack
            });
          }
        }
      }
    });
    this.primaryUdpPort.on("error", (error) => {
      debug.error(`OSC UDP port error: ${error.message}`, {
        code: error.code,
        port: this.localPort,
        stack: error.stack
      });
      this.emit('error', error);
    });
  }
  setAdditionalConnections(connections) {
    this.additionalConnections = connections || [];
    console.log(`Setting up ${this.additionalConnections.length} additional OSC connections`);
    this.setupAdditionalPorts();
  }
  updateAdditionalConnections(connections) {
    this.additionalConnections = connections || [];
    console.log(`Updating ${this.additionalConnections.length} additional OSC connections (enabled: ${this.additionalConnections.filter(c => c.enabled).length})`);
    this.setupAdditionalPorts();
  }
  setupAdditionalPorts() {
    // Clean up existing additional ports
    this.additionalPorts.forEach((portData, portId) => {
      if (portData.client) {
        try {
          portData.client.close();
        } catch (err) {
          console.warn(`Error closing additional client ${portId}:`, err);
        }
      }
    });
    this.additionalPorts.clear();
    
    // Setup new additional ports only for enabled OUTGOING connections
    this.additionalConnections.forEach(connection => {
      // Only setup outgoing connections - skip incoming since we don't receive
      if (!connection.enabled || !connection.port || connection.type !== 'outgoing') {
        console.log(`Skipping connection ${connection.name || connection.id}: enabled=${connection.enabled}, port=${connection.port}, type=${connection.type}`);
        return;
      }
      console.log(`Setting up ${connection.type} connection: ${connection.name || connection.id} on port ${connection.port}`);
      const portData = {};
      
      try {
        portData.client = new osc.UDPPort({
          localAddress: "0.0.0.0",
          localPort: 0, // Let system assign local port
          remoteAddress: connection.address || '127.0.0.1',
          remotePort: connection.port,
          metadata: true
        });
        
        portData.client.on("ready", () => {
          console.log(`Additional outgoing port ready: ${connection.name} to ${connection.address}:${connection.port}`);
          this.emit('additionalPortReady', {
            connectionId: connection.id,
            type: 'outgoing',
            port: connection.port,
            address: connection.address,
            name: connection.name
          });
        });
        
        portData.client.on("error", (error) => {
          console.error(`Additional outgoing port error for ${connection.name}:`, error);
          this.emit('additionalPortError', {
            connectionId: connection.id,
            type: 'outgoing',
            port: connection.port,
            name: connection.name,
            error
          });
        });
        
        if (this.isListening) {
          portData.client.open();
        }
      } catch (error) {
        console.error(`Failed to create outgoing port for ${connection.name}:`, error);
        this.emit('additionalPortError', {
          connectionId: connection.id,
          type: 'outgoing',
          port: connection.port,
          name: connection.name,
          error
        });
      }
      
      this.additionalPorts.set(connection.id, portData);
    });
    
    console.log(`Setup complete: ${this.additionalPorts.size} additional ports active`);
  }
  
  start() {
    if (!this.primaryUdpPort) {
      const error = new Error('OSC service not initialized');
      debug.error('Attempted to start OSC service without initialization');
      this.emit('error', error);
      return false;
    }
    try {
      this.primaryUdpPort.open();
      
      // Start additional outgoing ports
      this.additionalPorts.forEach((portData, connectionId) => {
        const connection = this.additionalConnections.find(c => c.id === connectionId);
        if (portData.client) {
          try {
            portData.client.open();
            console.log(`Opened additional outgoing port for ${connection?.name || connectionId}`);
          } catch (err) {
            debug.warn(`Error opening additional outgoing port for ${connection?.name || connectionId}: ${err.message}`);
          }
        }
      });
      
      return true;
    } catch (error) {
      debug.error(`Failed to start OSC service: ${error.message}`, {
        localPort: this.localPort,
        stack: error.stack
      });
      this.emit('error', error);
      return false;
    }
  }
  
  stop() {
    // Remove all event listeners from this EventEmitter instance
    this.removeAllListeners();
    // Stop primary port
    if (this.primaryUdpPort && this.isListening) {
      try {
        // Remove all event listeners to prevent memory leaks
        this.primaryUdpPort.removeAllListeners();
        this.primaryUdpPort.close();
      } catch (error) {
        if (error.code !== 'ERR_SOCKET_DGRAM_NOT_RUNNING') {
          debug.error(`Error stopping primary UDP port: ${error.message}`, {
            code: error.code,
            stack: error.stack
          });
        }
      }
    }
    
    // Stop and clean up all additional ports
    this.additionalPorts.forEach((portData, connectionId) => {
      if (portData.client) {
        try {
          // Remove all event listeners to prevent memory leaks
          portData.client.removeAllListeners();
          if (portData.client._handle) {
            portData.client.close();
          }
        } catch (err) {
          if (err.code !== 'ERR_SOCKET_DGRAM_NOT_RUNNING') {
            debug.error(`Error closing additional client ${connectionId}: ${err.message}`);
          }
        }
      }
    });
    // Clear the additional ports map to ensure they're fully cleaned up
    this.additionalPorts.clear();
    // Reset the primary UDP port to null to ensure it's fully cleaned up
    this.primaryUdpPort = null;
    
    this.isListening = false;
    this.emit('stopped');
    console.log('OSC Service stopped - all connections closed');
    return true;
  }
  sendMessageToConnection(connectionId, address, value, type = 'f', rawMessage = null) {
    const portData = this.additionalPorts.get(connectionId);
    if (!portData || !portData.client) {
      this.emit('error', new Error(`Outgoing connection ${connectionId} not available for sending`));
      return false;
    }
    if (typeof portData.client.isOpen === 'boolean' && !portData.client.isOpen) {
      this.emit('error', new Error(`Outgoing connection ${connectionId} is not ready`));
      return false;
    }
    try {
      // Use the raw message if provided, otherwise format a new one
      const message = rawMessage || this.formatOscMessage(address, value, type);
      portData.client.send(message);
      this.emit('messageSent', { address, value, type, connectionId });
      return true;
    } catch (error) {
      this.emit('error', error);
      return false;
    }
  }
  broadcastToAllOutgoing(address, value, type = 'f') {
    let successCount = 0;
    const outgoingConnections = this.additionalConnections.filter(conn => 
      conn.type === 'outgoing' && conn.enabled
    );
    
    // Create the message once
    const message = this.formatOscMessage(address, value, type);
    
    outgoingConnections.forEach(connection => {
      const portData = this.additionalPorts.get(connection.id);
      if (portData && portData.client) {
        try {
          portData.client.send(message);
          this.emit('messageSent', { address, value, type, connectionId: connection.id });
          successCount++;
        } catch (error) {
          console.error(`Error broadcasting to ${connection.name}:`, error);
          this.emit('error', error);
        }
      } else {
        console.warn(`Outgoing connection ${connection.name} not available for broadcast`);
      }
    });
    
    return successCount;
  }
  formatOscMessage(address, value, type) {
    let oscType = type;
    let oscValue = value;
    switch (type) {
      case 'float':
      case 'f':
        oscType = 'f';
        oscValue = parseFloat(value);
        break;
      case 'int':
      case 'i':
        oscType = 'i';
        oscValue = parseInt(value);
        break;
      case 'bool':
      case 'T':
      case 'F':
        oscType = value ? 'T' : 'F';
        oscValue = undefined;
        break;
      case 'string':
      case 's':
        oscType = 's';
        oscValue = String(value);
        break;
      default:
        oscType = 'f';
        oscValue = parseFloat(value);
    }
    const message = {
      address: address,
      args: oscType === 'T' || oscType === 'F' ? [] : [{ type: oscType, value: oscValue }]
    };
    if (oscType === 'T' || oscType === 'F') {
      message.args = [{ type: oscType }];
    }
    return message;
  }
  sendMessage(address, value, type = 'f') {
    if (!this.primaryUdpPort || !this.isListening) {
      // Dont emit error for expected "not running"
      return false;
    }
    try {
      const message = this.formatOscMessage(address, value, type);
      this.primaryUdpPort.send(message);
      this.emit('messageSent', { address, value, type });
      return true;
    } catch (error) {
      debug.error(`Error sending primary OSC message: ${error.message}`, {
        address,
        value,
        type,
        stack: error.stack
      });
      this.emit('error', error);
      return false;
    }
  }
  setTargetConfig(targetAddress, targetPort) {
    this.targetAddress = targetAddress;
    this.targetPort = targetPort;
    if (this.primaryUdpPort) {
      this.primaryUdpPort.options.remoteAddress = targetAddress;
      this.primaryUdpPort.options.remotePort = targetPort;
    }
  }
  getConfig() {
    return {
      localPort: this.localPort,
      targetPort: this.targetPort,
      targetAddress: this.targetAddress,
      isListening: this.isListening
    };
  }
  findAvailablePort(startPort, endPort) {
    const net = require('net');
    for (let port = startPort; port <= endPort; port++) {
      try {
        const server = net.createServer();
        server.listen(port, () => {
          server.close();
        });
        return port;
      } catch (error) {
        continue;
      }
    }
    return startPort;
  }
  getStatus() {
    const status = {
      isListening: this.isListening,
      localPort: this.localPort,
      targetPort: this.targetPort,
      targetAddress: this.targetAddress,
      additionalConnections: this.additionalConnections.length,
      activeAdditionalPorts: this.additionalPorts.size,
      outgoingConnections: this.additionalConnections.filter(c => c.type === 'outgoing').length,
      primaryPortReady: !!(this.primaryUdpPort && this.isListening),
      additionalPortsDetails: []
    };
    this.additionalPorts.forEach((portData, connectionId) => {
      const connection = this.additionalConnections.find(c => c.id === connectionId);
      status.additionalPortsDetails.push({
        connectionId,
        type: connection?.type,
        name: connection?.name,
        port: connection?.port,
        address: connection?.address,
        enabled: connection?.enabled,
        hasClient: !!portData.client
      });
    });
    return status;
  }

  // OSCLeash listener registration methods
  registerOSCLeashListener(address, callback) {
    this.oscLeashListeners.set(address, callback);
  }

  unregisterOSCLeashListener(address) {
    this.oscLeashListeners.delete(address);
  }
}
export default OscService;
