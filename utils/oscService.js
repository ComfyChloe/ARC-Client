const osc = require('osc');
const EventEmitter = require('events');
class OscService extends EventEmitter {
  constructor() {
    super();
    this.primaryUdpPort = null;
    this.additionalPorts = new Map();
    this.isListening = false;
    this.localPort = null;
    this.targetPort = 9000;
    this.targetAddress = '127.0.0.1';
    this.parameters = {};
    this.additionalConnections = [];
    this.forwardFromAdditionalToPrimary = true;
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
  setupAdditionalPorts() {
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
    this.additionalConnections.forEach(connection => {
      if (!connection.enabled || !connection.port) return;
      const portData = {};
      if (connection.type === 'incoming') {
        try {
          portData.server = new osc.UDPPort({
            localAddress: connection.address || "0.0.0.0",
            localPort: connection.port,
            metadata: true
          });
          portData.server.on("ready", () => {
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
            this.emit('additionalPortReady', {
              connectionId: connection.id,
              type: 'outgoing',
              port: connection.port,
              address: connection.address,
              name: connection.name
            });
          });
          portData.client.on("error", (error) => {
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
  }
  start() {
    if (!this.primaryUdpPort) {
      this.emit('error', new Error('OSC service not initialized'));
      return false;
    }
    try {
      this.primaryUdpPort.open();
      this.additionalPorts.forEach((portData) => {
        if (portData.server) {
          try {
            portData.server.open();
          } catch (err) {
            console.warn('Error opening additional server:', err);
          }
        }
        if (portData.client) {
          try {
            portData.client.open();
          } catch (err) {
            console.warn('Error opening additional client:', err);
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
    if (this.primaryUdpPort && this.isListening) {
      try {
        this.primaryUdpPort.close();
      } catch (error) {
        this.emit('error', error);
      }
    }
    this.additionalPorts.forEach((portData) => {
      if (portData.server) {
        try {
          portData.server.close();
        } catch (err) {
          console.warn('Error closing additional server:', err);
        }
      }
      if (portData.client) {
        try {
          portData.client.close();
        } catch (err) {
          console.warn('Error closing additional client:', err);
        }
      }
    });
    this.isListening = false;
    this.emit('stopped');
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
      this.parameters[address] = { value, type };
      if (connectionId !== null && this.forwardFromAdditionalToPrimary && this.primaryUdpPort && this.isListening) {
        try {
          this.primaryUdpPort.send(oscMsg);
        } catch (forwardError) {
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
    const message = this.formatOscMessage(address, value, type);
    outgoingConnections.forEach(connection => {
      const portData = this.additionalPorts.get(connection.id);
      if (portData && portData.client) {
        try {
          portData.client.send(message);
          this.emit('messageSent', { address, value, type, connectionId: connection.id });
          successCount++;
        } catch (error) {
          this.emit('error', error);
        }
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
