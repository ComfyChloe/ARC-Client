const io = require('socket.io-client');
const debug = require('./debugger');
class WebSocketService {
  constructor() {
    this.socket = null;
    this.config = null;
    this.oscClient = null;
    this.sendToRendererCallback = null;
  }
  initialize(config, sendToRendererCallback, oscClient) {
    this.config = config;
    this.sendToRendererCallback = sendToRendererCallback;
    this.oscClient = oscClient;
  }
  connect() {
    if (this.socket) {
      this.socket.disconnect();
    }
    debug.info('Attempting to connect to ARC-OSC Server', { url: this.config.serverUrl });
    this.socket = io(`${this.config.serverUrl}/osc`, {
      withCredentials: true,
      transports: ['websocket', 'polling']
    });
    this._setupEventHandlers();
  }
  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }
  isConnected() {
    return this.socket && this.socket.connected;
  }
  authenticate(credentials) {
    if (this.socket && this.socket.connected) {
      debug.info('Sending authentication request', { username: credentials.username });
      this.socket.emit('authenticate', credentials);
      return { success: true };
    } else {
      debug.warn('Authentication attempted but not connected to server');
      return { success: false, error: 'Not connected to server' };
    }
  }
  sendOsc(oscData) {
    if (this.socket && this.socket.connected) {
      debug.debug('Sending OSC message to server', oscData);
      this.socket.emit('send-osc', oscData);
    } else {
      debug.warn('OSC send attempted but not connected to server');
      throw new Error('Not connected to server');
    }
  }
  forwardOscMessage(messageData) {
    if (this.socket && this.socket.connected) {
      const enrichedData = {
        ...messageData,
        timestamp: Date.now(),
        source: messageData.connectionId ? 'additional' : 'primary'
      };
      this.socket.emit('osc-message', enrichedData);
    }
  }
  getUserAvatar() {
    if (this.socket && this.socket.connected) {
      this.socket.emit('get-user-avatar');
    }
  }
  getParameters() {
    if (this.socket && this.socket.connected) {
      this.socket.emit('get-parameters');
    }
  }
  setUserAvatar(avatarData) {
    if (this.socket && this.socket.connected) {
      this.socket.emit('set-user-avatar', avatarData);
    }
  }
  _setupEventHandlers() {
    this.socket.on('connect', () => {
      console.log('Connected to ARC-OSC Server');
      debug.info('Successfully connected to ARC-OSC Server');
      this._sendToRenderer('server-connection', { status: 'connected' });
    });
    this.socket.on('disconnect', () => {
      console.log('Disconnected from ARC-OSC Server');
      debug.warn('Disconnected from ARC-OSC Server');
      this._sendToRenderer('server-connection', { status: 'disconnected' });
    });
    this.socket.on('auth-required', () => {
      debug.info('Authentication required by server');
      this._sendToRenderer('auth-required');
    });
    this.socket.on('auth-success', (data) => {
      console.log('Authentication successful:', data);
      debug.info('Authentication successful', data);
      this._sendToRenderer('auth-success', data);
    });
    this.socket.on('auth-failed', (data) => {
      console.log('Authentication failed:', data);
      debug.warn('Authentication failed', data);
      this._sendToRenderer('auth-failed', data);
    });
    this.socket.on('parameter-update', (data) => {
      console.log('Parameter update:', data);
      debug.debug('Parameter update received', data);
      this._sendToRenderer('parameter-update', data);
      if (global.oscService && data.address) {
        try {
          const sendResult = global.oscService.sendMessage(data.address, data.value, data.type || 'f');
          if (sendResult) {
            debug.debug('Sent OSC parameter to VRChat via primary connection', { 
              address: data.address, 
              value: data.value,
              type: data.type || 'f' 
            });
          } else {
            debug.warn('Failed to send OSC parameter to VRChat - sendMessage returned false');
          }
        } catch (error) {
          debug.error('Failed to send to primary OSC connection', error);
        }
      }
      if (!global.oscService && this.oscClient && data.address) {
        try {
          this.oscClient.send(data.address, data.value);
          debug.debug('Sent OSC parameter to VRChat via legacy client', { address: data.address, value: data.value });
        } catch (error) {
          debug.error('Failed to send via legacy OSC client', error);
        }
      }
      if (data.targetConnectionId && global.oscService) {
        try {
          global.oscService.sendMessageToConnection(data.targetConnectionId, data.address, data.value, data.type);
          debug.debug('Sent OSC parameter to additional connection', { 
            connectionId: data.targetConnectionId, 
            address: data.address, 
            value: data.value,
            type: data.type
          });
        } catch (error) {
          debug.error('Failed to send to additional connection', error);
        }
      }
      if (!data.targetConnectionId && global.oscService) {
        try {
          const sentCount = global.oscService.broadcastToAllOutgoing(data.address, data.value, data.type);
          if (sentCount > 0) {
            debug.debug('Broadcasted OSC parameter to outgoing connections', { 
              address: data.address, 
              value: data.value,
              type: data.type,
              sentCount 
            });
          }
        } catch (error) {
          debug.error('Failed to broadcast to outgoing connections', error);
        }
      }
    });
    this.socket.on('user-avatar-info', (data) => {
      console.log('User avatar info:', data);
      debug.info('User avatar info received', data);
      this._sendToRenderer('user-avatar-info', data);
    });
    this.socket.on('error', (error) => {
      console.error('Server error:', error);
      debug.error('Server connection error', error);
      this._sendToRenderer('server-error', error);
    });
    this.socket.on('heartbeat', (data) => {
      this.socket.emit('heartbeat-response', data);
    });
  }
  _sendToRenderer(channel, data) {
    if (this.sendToRendererCallback) {
      this.sendToRendererCallback(channel, data);
    }
  }
  updateOscClient(oscClient) {
    this.oscClient = oscClient;
  }
  updateConfig(config) {
    this.config = config;
  }
  cleanup() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }
}
module.exports = new WebSocketService();
