const osc = require('osc');
const EventEmitter = require('events');
class OscService extends EventEmitter {
  constructor() {
    super();
    this.udpPort = null;
    this.isListening = false;
    this.localPort = null;
    this.targetPort = 9000;
    this.targetAddress = '127.0.0.1';
    this.parameters = {};
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
      this.udpPort = new osc.UDPPort({
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
    this.udpPort.on("ready", () => {
      this.isListening = true;
      this.emit('ready', {
        localPort: this.localPort,
        targetPort: this.targetPort,
        targetAddress: this.targetAddress
      });
    });
    this.udpPort.on("message", (oscMsg) => {
      this.handleIncomingMessage(oscMsg);
    });
    this.udpPort.on("error", (error) => {
      this.emit('error', error);
    });
  }
  start() {
    if (!this.udpPort) {
      this.emit('error', new Error('OSC service not initialized'));
      return false;
    }
    try {
      this.udpPort.open();
      return true;
    } catch (error) {
      this.emit('error', error);
      return false;
    }
  }
  stop() {
    if (this.udpPort && this.isListening) {
      try {
        this.udpPort.close();
        this.isListening = false;
        this.emit('stopped');
        return true;
      } catch (error) {
        this.emit('error', error);
        return false;
      }
    }
    return true;
  }
  sendMessage(address, value, type = 'f') {
    if (!this.udpPort || !this.isListening) {
      this.emit('error', new Error('OSC service not running'));
      return false;
    }
    try {
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
          oscValue = undefined; // OSC true/false don't have values
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
      this.udpPort.send(message, this.targetAddress, this.targetPort);
      this.parameters[address] = { value: value, type: type };
      this.emit('messageSent', { address, value, type });
      return true;
    } catch (error) {
      this.emit('error', error);
      return false;
    }
  }
  handleIncomingMessage(oscMsg) {
    try {
      const address = oscMsg.address;
      let value = null;
      let type = 'unknown';
      if (oscMsg.args && oscMsg.args.length > 0) {
        const arg = oscMsg.args[0];
        value = arg.value;
        type = arg.type;
      } else if (oscMsg.args && oscMsg.args.length === 0) {
        // Handle boolean messages (T/F) which have no args
        type = 'bool';
        value = true; // Assume true if no args but message received
      }
      this.parameters[address] = { value, type };
      this.emit('messageReceived', {
        address: address,
        value: value,
        type: type,
        timestamp: Date.now()
      });
    } catch (error) {
      this.emit('error', error);
    }
  }
  setTargetConfig(targetAddress, targetPort) {
    this.targetAddress = targetAddress;
    this.targetPort = targetPort;
    if (this.udpPort) {
      this.udpPort.options.remoteAddress = targetAddress;
      this.udpPort.options.remotePort = targetPort;
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
      parameterCount: Object.keys(this.parameters).length
    };
  }
}
module.exports = OscService;
