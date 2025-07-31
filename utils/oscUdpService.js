const osc = require('osc');

class OscUdpService {
  constructor() {
    this.oscUDPPort = null;
    this.assignedOscPort = null;
    this.targetOscPort = 9000;
    this.targetOscAddress = '127.0.0.1';
  }

  findAvailablePort(startPort, callback) {
    const server = require('net').createServer();
    
    server.listen(startPort, '127.0.0.1', () => {
      server.once('close', () => {
        callback(startPort);
      });
      server.close();
    });
    
    server.on('error', () => {
      // Port is busy, try next one
      this.findAvailablePort(startPort + 1, callback);
    });
  }

  createOscUDPPort(port, onReady, onMessage, onError) {
    if (this.oscUDPPort) {
      this.oscUDPPort.close();
    }

    this.assignedOscPort = port;
    
    // Create OSC UDP port for receiving messages
    this.oscUDPPort = new osc.UDPPort({
      localAddress: "127.0.0.1",
      localPort: port,
      metadata: true
    });

    this.oscUDPPort.on("ready", () => {
      console.log(`OSC UDP Server listening on port ${port}`);
      if (onReady) onReady(port);
    });

    this.oscUDPPort.on("message", (oscMsg) => {
      console.log('Received OSC:', oscMsg.address, oscMsg.args);
      
      // Extract value from OSC message
      const value = oscMsg.args && oscMsg.args.length > 0 ? oscMsg.args[0].value : null;
      
      if (onMessage) {
        onMessage({
          address: oscMsg.address,
          value: value,
          type: oscMsg.args && oscMsg.args.length > 0 ? oscMsg.args[0].type : 'f'
        });
      }
    });

    this.oscUDPPort.on("error", (err) => {
      console.error('OSC UDP Server error:', err);
      if (onError) onError(err);
    });

    this.oscUDPPort.open();
  }

  sendOscToVRChat(address, value) {
    if (!this.oscUDPPort) {
      console.warn('OSC UDP port not ready, cannot send message');
      return;
    }
    
    try {
      let oscType = 'f';
      let oscValue = value;
      
      if (typeof value === 'boolean') {
        oscType = value ? 'T' : 'F';
        oscValue = value;
      } else if (typeof value === 'string') {
        oscType = 's';
      } else if (typeof value === 'number') {
        oscType = Number.isInteger(value) ? 'i' : 'f';
      }
      
      const oscMessage = {
        address: address,
        args: [{
          type: oscType,
          value: oscValue
        }]
      };

      this.oscUDPPort.send(oscMessage, this.targetOscAddress, this.targetOscPort);
      console.log(`Sent OSC to VRChat: ${address} = ${value}`);
    } catch (err) {
      console.error('Error sending OSC to VRChat:', err);
    }
  }

  setTargetConfig(address, port) {
    this.targetOscAddress = address;
    this.targetOscPort = port;
  }

  getAssignedPort() {
    return this.assignedOscPort;
  }

  close() {
    if (this.oscUDPPort) {
      this.oscUDPPort.close();
      this.oscUDPPort = null;
    }
  }
}

module.exports = OscUdpService;
