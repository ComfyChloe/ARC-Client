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
    this.setupAdditionalPorts();
  }
  setupAdditionalPorts() {
    this.additionalPorts.forEach((portData, portId) => {
      if (portData.incoming) {
        try {
          portData.incoming.close();
        } catch (err) {
          console.warn(`Error closing additional incoming port ${portId}:`, err);
        }
      }
      if (portData.outgoing) {
        try {
          portData.outgoing.close();
        } catch (err) {
          console.warn(`Error closing additional outgoing port ${portId}:`, err);
        }
      }
    });
    this.additionalPorts.clear();
    this.additionalConnections.forEach(connection => {
      if (!connection.enabled) return;
      const portData = {};
      if (connection.incomingPort) {
        try {
          portData.incoming = new osc.UDPPort({
            localAddress: "0.0.0.0",
            localPort: connection.incomingPort,
            metadata: true
          });
          portData.incoming.on("ready", () => {
            this.emit('additionalPortReady', {
              connectionId: connection.id,
              type: 'incoming',
              port: connection.incomingPort
            });
          });
          portData.incoming.on("message", (oscMsg) => {
            this.handleIncomingMessage(oscMsg, connection.id);
          });
          portData.incoming.on("error", (error) => {
            this.emit('additionalPortError', {
              connectionId: connection.id,
              type: 'incoming',
              port: connection.incomingPort,
              error
            });
          });
          if (this.isListening) {
            portData.incoming.open();
          }
        } catch (error) {
          this.emit('additionalPortError', {
            connectionId: connection.id,
            type: 'incoming',
            port: connection.incomingPort,
            error
          });
        }
      }
      if (connection.outgoingPort) {
        try {
          portData.outgoing = new osc.UDPPort({
            localAddress: "0.0.0.0",
            localPort: 0, // System assigned port
            remoteAddress: connection.address,
            remotePort: connection.outgoingPort,
            metadata: true
          });
          portData.outgoing.on("error", (error) => {
            this.emit('additionalPortError', {
              connectionId: connection.id,
              type: 'outgoing',
              port: connection.outgoingPort,
              error
            });
          });
          if (this.isListening) {
            portData.outgoing.open();
          }
        } catch (error) {
          this.emit('additionalPortError', {
            connectionId: connection.id,
            type: 'outgoing',
            port: connection.outgoingPort,
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
        if (portData.incoming) {
          try {
            portData.incoming.open();
          } catch (err) {
            console.warn('Error opening additional incoming port:', err);
          }
        }
        if (portData.outgoing) {
          try {
            portData.outgoing.open();
          } catch (err) {
            console.warn('Error opening additional outgoing port:', err);
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
      if (portData.incoming) {
        try {
          portData.incoming.close();
        } catch (err) {
          console.warn('Error closing additional incoming port:', err);
        }
      }
      if (portData.outgoing) {
        try {
          portData.outgoing.close();
        } catch (err) {
          console.warn('Error closing additional outgoing port:', err);
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
  sendMessageToConnection(connectionId, address, value, type = 'f') {
    const portData = this.additionalPorts.get(connectionId);
    if (!portData || !portData.outgoing) {
      this.emit('error', new Error(`Additional connection ${connectionId} not available for sending`));
      return false;
    }
    try {
      const message = this.formatOscMessage(address, value, type);
      portData.outgoing.send(message);
      this.emit('messageSent', { address, value, type, connectionId });
      return true;
    } catch (error) {
      this.emit('error', error);
      return false;
    }
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
      this.emit('error', new Error('OSC service not running'));
      return false;
    }
    try {
      const message = this.formatOscMessage(address, value, type);
      this.primaryUdpPort.send(message, this.targetAddress, this.targetPort);
      this.parameters[address] = { value: value, type: type };
      this.emit('messageSent', { address, value, type });
      return true;
    } catch (error) {
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
    return {
      isListening: this.isListening,
      localPort: this.localPort,
      targetPort: this.targetPort,
      targetAddress: this.targetAddress,
      parameterCount: Object.keys(this.parameters).length,
      additionalConnections: this.additionalConnections.length,
      activeAdditionalPorts: this.additionalPorts.size
    };
  }
}
module.exports = OscService;
