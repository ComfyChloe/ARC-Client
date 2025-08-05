const io = require('socket.io-client');

class WebSocketService {
  constructor() {
    this.socket = null;
    this.isConnected = false;
    this.isAuthenticated = false;
    this.listeners = {};
  }

  connect(serverUrl) {
    if (this.socket) {
      this.socket.disconnect();
    }

    this.socket = io(`${serverUrl}/osc`, {
      withCredentials: true,
      transports: ['websocket', 'polling']
    });

    this.setupSocketHandlers();
    return this.socket;
  }

  setupSocketHandlers() {
    this.socket.on('connect', () => {
      console.log('Connected to ARC-OSC Server');
      this.isConnected = true;
      this.emit('server-connection', { status: 'connected' });
    });

    this.socket.on('disconnect', () => {
      console.log('Disconnected from ARC-OSC Server');
      this.isConnected = false;
      this.isAuthenticated = false;
      this.emit('server-connection', { status: 'disconnected' });
    });

    this.socket.on('auth-required', () => {
      this.emit('auth-required');
    });

    this.socket.on('auth-success', (data) => {
      console.log('Authentication successful:', data);
      this.isAuthenticated = true;
      this.emit('auth-success', data);
    });

    this.socket.on('auth-failed', (data) => {
      console.log('Authentication failed:', data);
      this.isAuthenticated = false;
      this.emit('auth-failed', data);
    });

    this.socket.on('parameter-update', (data) => {
      console.log('Parameter update:', data);
      this.emit('parameter-update', data);
    });

    this.socket.on('user-avatar-info', (data) => {
      console.log('User avatar info:', data);
      this.emit('user-avatar-info', data);
    });

    this.socket.on('error', (error) => {
      console.error('Server error:', error);
      this.emit('server-error', error);
    });

    this.socket.on('heartbeat', (data) => {
      // Respond to server heartbeat
      this.socket.emit('heartbeat-response', data);
    });
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.isConnected = false;
      this.isAuthenticated = false;
    }
  }

  authenticate(credentials) {
    if (this.socket && this.isConnected) {
      this.socket.emit('authenticate', credentials);
    } else {
      console.warn('Cannot authenticate: not connected to server');
    }
  }

  sendOscMessage(oscData) {
    if (this.socket && this.isConnected) {
      this.socket.emit('osc-message', oscData);
    } else {
      console.warn('Cannot send OSC message: not connected to server');
    }
  }

  getUserAvatar() {
    if (this.socket && this.isConnected) {
      this.socket.emit('get-user-avatar');
    }
  }

  setUserAvatar(avatarData) {
    if (this.socket && this.isConnected) {
      this.socket.emit('set-user-avatar', avatarData);
    }
  }

  getParameters() {
    if (this.socket && this.isConnected) {
      this.socket.emit('get-parameters');
    }
  }

  // Simple event emitter
  emit(event, data) {
    if (this.listeners && this.listeners[event]) {
      this.listeners[event].forEach(callback => callback(data));
    }
  }

  on(event, callback) {
    if (!this.listeners) this.listeners = {};
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(callback);
  }

  removeListener(event, callback) {
    if (this.listeners && this.listeners[event]) {
      const index = this.listeners[event].indexOf(callback);
      if (index > -1) {
        this.listeners[event].splice(index, 1);
      }
    }
  }

  removeAllListeners(event) {
    if (this.listeners && this.listeners[event]) {
      this.listeners[event] = [];
    }
  }

  getConnectionStatus() {
    return {
      isConnected: this.isConnected,
      isAuthenticated: this.isAuthenticated
    };
  }
}

module.exports = WebSocketService;
