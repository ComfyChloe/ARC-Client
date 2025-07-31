const osc = require('osc');

class OscUdpService {
  constructor() {
    this.oscUDPPort = null;
    this.targetOscPort = 9000;
    this.targetOscAddress = '127.0.0.1';
  }

  // Initialize OSC UDP service for sending only (no receiving)
  initializeForSendingOnly(onReady) {
    if (this.oscUDPPort) {
      this.oscUDPPort.close();
    }

    // Create OSC UDP port for sending messages only
    this.oscUDPPort = new osc.UDPPort({
      localAddress: "127.0.0.1",
      localPort: 0, // Use any available port for sending
      metadata: true
    });

    this.oscUDPPort.on("ready", () => {
      console.log(`OSC UDP Sender ready - will send to ${this.targetOscAddress}:${this.targetOscPort}`);
      if (onReady) onReady();
    });

    this.oscUDPPort.on("error", (err) => {
      console.error('OSC UDP Sender error:', err);
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

  close() {
    if (this.oscUDPPort) {
      this.oscUDPPort.close();
      this.oscUDPPort = null;
    }
  }
}

module.exports = OscUdpService;
