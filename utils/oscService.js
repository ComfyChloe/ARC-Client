const osc = require('osc');
const EventEmitter = require('events');
class OscService extends EventEmitter {
  constructor() {
    super();
    this.primaryUdpPort = null;
    this.additionalPorts = new Map(); // Map of portId -> { incoming: UDPPort, outgoing: Client }
    this.isListening = false;
    this.localPort = null;
    this.targetPort = 9000;
    this.targetAddress = '127.0.0.1';
    this.parameters = {};
    this.additionalConnections = [];
    this.forwardFromAdditionalToPrimary = true;
    // Memory management settings - more aggressive for logs only
    this.maxParameterCount = 1000; // Reduced from 5000 to 1000 for logs view only
    this.parameterCleanupInterval = 20000; // Reduced from 30 seconds to 20 seconds
    this.lastParameterCleanup = Date.now();
    this.maxParameterAge = 40000; // Keep parameters for only 40 seconds (logs view)
    // Start parameter cleanup timer
    this.setupParameterCleanup();
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
        localPort: this.localPort,
        remoteAddress: this.targetAddress,
        remotePort: this.targetPort,
        metadata: true
      });
      this.setupEventHandlers();
      return true;
    } catch (error) {
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
    this.primaryUdpPort.on("message", (oscMsg) => {
      this.handleIncomingMessage(oscMsg);
    });
    this.primaryUdpPort.on("error", (error) => {
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
      if (portData.server) {
        try {
          portData.server.close();
        } catch (err) {
          console.warn(`Error closing additional server ${portId}:`, err);
        }
      }
      if (portData.client) {
        try {
          portData.client.close();
        } catch (err) {
          console.warn(`Error closing additional client ${portId}:`, err);
        }
      }
    });
    this.additionalPorts.clear();
    
    // Setup new additional ports only for enabled connections
    this.additionalConnections.forEach(connection => {
      // Skip if connection is disabled or missing required fields
      if (!connection.enabled || !connection.port) {
        console.log(`Skipping connection ${connection.name || connection.id}: enabled=${connection.enabled}, port=${connection.port}`);
        return;
      }
      console.log(`Setting up ${connection.type} connection: ${connection.name || connection.id} on port ${connection.port}`);
      const portData = {};
      
      if (connection.type === 'incoming') {
        try {
          portData.server = new osc.UDPPort({
            localAddress: connection.address || "0.0.0.0",
            localPort: connection.port,
            metadata: true
          });
          
          portData.server.on("ready", () => {
            console.log(`Additional incoming port ready: ${connection.name} on ${connection.port}`);
            this.emit('additionalPortReady', {
              connectionId: connection.id,
              type: 'incoming',
              port: connection.port,
              address: connection.address,
              name: connection.name
            });
          });
          
          portData.server.on("message", (oscMsg) => {
            this.handleIncomingMessage(oscMsg, connection.id);
          });
          
          portData.server.on("error", (error) => {
            console.error(`Additional incoming port error for ${connection.name}:`, error);
            this.emit('additionalPortError', {
              connectionId: connection.id,
              type: 'incoming',
              port: connection.port,
              name: connection.name,
              error
            });
          });
          
          if (this.isListening) {
            portData.server.open();
          }
        } catch (error) {
          console.error(`Failed to create incoming port for ${connection.name}:`, error);
          this.emit('additionalPortError', {
            connectionId: connection.id,
            type: 'incoming',
            port: connection.port,
            name: connection.name,
            error
          });
        }
      } else if (connection.type === 'outgoing') {
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
      }
      
      this.additionalPorts.set(connection.id, portData);
    });
    
    console.log(`Setup complete: ${this.additionalPorts.size} additional ports active`);
  }
  
  start() {
    if (!this.primaryUdpPort) {
      this.emit('error', new Error('OSC service not initialized'));
      return false;
    }
    try {
      this.primaryUdpPort.open();
      
      // Start additional ports
      this.additionalPorts.forEach((portData, connectionId) => {
        const connection = this.additionalConnections.find(c => c.id === connectionId);
        if (portData.server) {
          try {
            portData.server.open();
            console.log(`Opened additional incoming port for ${connection?.name || connectionId}`);
          } catch (err) {
            console.warn(`Error opening additional incoming port for ${connection?.name || connectionId}:`, err);
          }
        }
        if (portData.client) {
          try {
            portData.client.open();
            console.log(`Opened additional outgoing port for ${connection?.name || connectionId}`);
          } catch (err) {
            console.warn(`Error opening additional outgoing port for ${connection?.name || connectionId}:`, err);
          }
        }
      });
      
      return true;
    } catch (error) {
      this.emit('error', error);
      return false;
    }
  }
  
  stop() {
    // Clear parameter cleanup timer
    if (this.parameterCleanupTimer) {
      clearInterval(this.parameterCleanupTimer);
      this.parameterCleanupTimer = null;
    }
    // Clear parameters to free memory
    this.parameters = {};
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
          console.error('Error stopping primary UDP port:', error);
        }
      }
    }
    
    // Stop and clean up all additional ports
    this.additionalPorts.forEach((portData, connectionId) => {
      if (portData.server) {
        try {
          // Remove all event listeners to prevent memory leaks
          portData.server.removeAllListeners();
          if (portData.server._handle) {
            portData.server.close();
          }
        } catch (err) {
          if (err.code !== 'ERR_SOCKET_DGRAM_NOT_RUNNING') {
            console.error('Error closing additional server:', err);
          }
        }
      }
      if (portData.client) {
        try {
          // Remove all event listeners to prevent memory leaks
          portData.client.removeAllListeners();
          if (portData.client._handle) {
            portData.client.close();
          }
        } catch (err) {
          if (err.code !== 'ERR_SOCKET_DGRAM_NOT_RUNNING') {
            console.error('Error closing additional client:', err);
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
  
  handleIncomingMessage(oscMsg, connectionId = null) {
    try {
      const address = oscMsg.address;
      let value = null;
      let type = 'unknown';
      if (oscMsg.args && oscMsg.args.length > 0) {
        const arg = oscMsg.args[0];
        value = arg.value;
        type = arg.type;
      } else if (oscMsg.args && oscMsg.args.length === 0) {
        type = 'bool';
        value = true;
      }
      // Always store for logs view, but with immediate cleanup if needed
      const currentParamCount = Object.keys(this.parameters).length;
      // If we're at the limit, remove the oldest parameter first
      if (currentParamCount >= this.maxParameterCount) {
        this.removeOldestParameter();
      }
      // Store the new parameter for logs view (only keep recent for UI)
      this.parameters[address] = { value, type, timestamp: Date.now() };
      // Trigger cleanup more frequently to keep memory low
      this.checkParameterCleanup();
      if (connectionId !== null && this.forwardFromAdditionalToPrimary && this.primaryUdpPort && this.isListening) {
        try {
          // Forward the exact original message without reformatting
          this.primaryUdpPort.send(oscMsg);
        } catch (forwardError) {
          // Silent fail for forwarding errors to prevent spam
        }
      }
      this.emit('messageReceived', {
        address: address,
        value: value,
        type: type,
        timestamp: Date.now(),
        connectionId: connectionId
      });
    } catch (error) {
      console.error('Error handling incoming OSC message:', error);
      this.emit('error', error);
    }
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
      console.warn('OSC service not running - cannot send message');
      this.emit('error', new Error('OSC service not running'));
      return false;
    }
    try {
      const message = this.formatOscMessage(address, value, type);
      this.primaryUdpPort.send(message);
      this.parameters[address] = { value: value, type: type };
      this.emit('messageSent', { address, value, type });
      return true;
    } catch (error) {
      console.error('Error sending primary OSC message:', error);
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
  setForwardingEnabled(enabled) {
    this.forwardFromAdditionalToPrimary = enabled;
    console.log(`OSC forwarding from additional to primary connections: ${enabled ? 'enabled' : 'disabled'}`);
  }
  isForwardingEnabled() {
    return this.forwardFromAdditionalToPrimary;
  }
  getConfig() {
    return {
      localPort: this.localPort,
      targetPort: this.targetPort,
      targetAddress: this.targetAddress,
      isListening: this.isListening
    };
  }
  getParameters() {
    return this.parameters;
  }
  clearParameters() {
    this.parameters = {};
    this.emit('parametersCleared');
  }
  setupParameterCleanup() {
    // Clear any existing timer to prevent duplicates
    if (this.parameterCleanupTimer) {
      clearInterval(this.parameterCleanupTimer);
    }
    // Set up periodic cleanup to prevent memory leaks
    this.parameterCleanupTimer = setInterval(() => {
      this.cleanupOldParameters();
    }, this.parameterCleanupInterval);
  }
  checkParameterCleanup() {
    const parameterCount = Object.keys(this.parameters).length;
    const now = Date.now();
    // More aggressive cleanup - trigger every 30 seconds or when approaching limit
    if (parameterCount > this.maxParameterCount * 0.7 || 
        (now - this.lastParameterCleanup) > 30000) {
      this.cleanupOldParameters();
    }
  }
  cleanupOldParameters() {
    const now = Date.now();
    let cleanedCount = 0;
    // Remove parameters older than maxParameterAge (1 minute for logs)
    Object.keys(this.parameters).forEach(address => {
      const param = this.parameters[address];
      if (param.timestamp && (now - param.timestamp) > this.maxParameterAge) {
        delete this.parameters[address];
        cleanedCount++;
      }
    });
    // If still too many parameters, keep only the most recent ones for logs view
    const currentCount = Object.keys(this.parameters).length;
    if (currentCount > this.maxParameterCount) {
      const targetCount = Math.floor(this.maxParameterCount * 0.8); // Keep 80% for breathing room
      const sortedEntries = Object.entries(this.parameters)
        .filter(([_, param]) => param.timestamp)
        .sort(([_, a], [__, b]) => b.timestamp - a.timestamp)
        .slice(0, targetCount);
      this.parameters = {};
      sortedEntries.forEach(([address, param]) => {
        this.parameters[address] = param;
      });
      cleanedCount += currentCount - sortedEntries.length;
    }
    if (cleanedCount > 0) {
      console.log(`Cleaned up ${cleanedCount} old parameters for logs view, ${Object.keys(this.parameters).length} remaining`);
    }
    this.lastParameterCleanup = now;
  }
  removeOldestParameter() {
    // Find and remove the oldest parameter to make room for new ones
    const paramEntries = Object.entries(this.parameters);
    if (paramEntries.length === 0) return;
    let oldestAddress = null;
    let oldestTimestamp = Date.now();
    paramEntries.forEach(([address, param]) => {
      if (param.timestamp && param.timestamp < oldestTimestamp) {
        oldestTimestamp = param.timestamp;
        oldestAddress = address;
      }
    });
    if (oldestAddress) {
      delete this.parameters[oldestAddress];
    }
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
      parameterCount: Object.keys(this.parameters).length,
      additionalConnections: this.additionalConnections.length,
      activeAdditionalPorts: this.additionalPorts.size,
      incomingConnections: this.additionalConnections.filter(c => c.type === 'incoming').length,
      outgoingConnections: this.additionalConnections.filter(c => c.type === 'outgoing').length,
      primaryPortReady: !!(this.primaryUdpPort && this.isListening),
      forwardingEnabled: this.forwardFromAdditionalToPrimary,
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
        hasServer: !!portData.server,
        hasClient: !!portData.client
      });
    });
    return status;
  }
}
module.exports = OscService;
