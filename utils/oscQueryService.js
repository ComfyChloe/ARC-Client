const express = require('express');
const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');
const debug = require('./debugger');
class OscQueryService {
  constructor() {
    this.httpServer = null;
    this.httpPort = 0;
    this.assignedOscPort = null;
    this.oscQueryData = {
      DESCRIPTION: 'ARC-OSC Client',
      FULL_PATH: '/',
      ACCESS: 0,
      CONTENTS: {}
    };
    this.logDir = path.join(__dirname, '..', 'logs');
    const unixTimestamp = Math.floor(Date.now() / 1000);
    this.logFile = path.join(this.logDir, `${unixTimestamp}_oscquery.log`);
    this.ensureLogDirectory();
  }
  ensureLogDirectory() {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
    this.cleanOldLogFiles();
  }
  cleanOldLogFiles() {
    try {
      const files = fs.readdirSync(this.logDir);
      const oscQueryLogs = files.filter(f => f.match(/^\d+_oscquery\.log$/))
        .map(f => ({
          name: f,
          path: path.join(this.logDir, f),
          timestamp: parseInt(f.split('_')[0])
        }))
        .sort((a, b) => b.timestamp - a.timestamp);

      // Keep only the 10 most recent OSC Query log files
      if (oscQueryLogs.length > 10) {
        const filesToDelete = oscQueryLogs.slice(10);
        filesToDelete.forEach(file => {
          try {
            fs.unlinkSync(file.path);
            this.log(`Cleaned up old OSC Query log: ${file.name}`);
          } catch (err) {
            this.log(`Failed to delete old log file ${file.name}: ${err.message}`, 'error');
          }
        });
      }
    } catch (err) {
      this.log(`Failed to clean old log files: ${err.message}`, 'error');
    }
  }
  log(message, data = null) {
    const timestamp = Math.floor(Date.now() / 1000); // Unix timestamp
    const dateStr = new Date().toISOString();
    let logEntry = `[${timestamp}] [${dateStr}] ${message}`;
    if (data) {
      logEntry += ` | Data: ${JSON.stringify(data)}`;
    }
    console.log(logEntry);
    try {
      fs.appendFileSync(this.logFile, logEntry + '\n');
    } catch (err) {
      console.error('Failed to write to OSC Query log file:', err);
    }
  }
  // Find an available OSC port dynamically
  findAvailableOscPort(startPort = 9011, callback) {
    const server = net.createServer();
    server.listen(startPort, '127.0.0.1', () => {
      server.once('close', () => {
        callback(startPort);
      });
      server.close();
    });
    server.on('error', () => {
      // Port is busy, try next one
      this.findAvailableOscPort(startPort + 1, callback);
    });
  }
  start(callback) {
    const app = express();
    this.httpPort = Math.floor(Math.random() * (58000 - 11000 + 1)) + 11000;
    this.findAvailableOscPort(9011, (oscPort) => {
      this.assignedOscPort = oscPort;
      this.log(`Assigned OSC UDP port: ${oscPort} (for receiving OSC data from VRChat)`);
      this.setupHttpServer(app, callback);
    });
  }
  setupHttpServer(app, callback) {
    // CORS middleware
    app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
      if (req.method === 'OPTIONS') {
        res.sendStatus(200);
      } else {
        next();
      }
    });
    app.get('/', (req, res) => {
      debug.oscQueryRequested('/', req.ip || req.connection.remoteAddress);
      const response = {
        ...this.oscQueryData,
        OSC_PORT: this.assignedOscPort,
        OSC_TRANSPORT: 'UDP'
      };
      res.json(response);
    });
    // Dynamic endpoint handler for any OSC path
    app.get('*', (req, res) => {
      debug.oscQueryRequested(req.path, req.ip || req.connection.remoteAddress);
      
      const path = req.path;
      const pathData = this.getOscQueryPath(path);
      if (pathData) {
        res.json(pathData);
      } else {
        res.status(404).json({ error: 'Path not found' });
      }
    });
    // POST endpoint for setting values
    app.post('*', express.json(), (req, res) => {
      const path = req.path;
      const value = req.body.value;
      if (value !== undefined) {
        // Emit event for OSC message sending
        this.emit('sendOsc', { address: path, value: value });
        // Update our data structure
        this.updateOscQueryParameter(path, value);
        res.json({ success: true });
      } else {
        res.status(400).json({ error: 'No value provided' });
      }
    });
    this.httpServer = app.listen(this.httpPort, '127.0.0.1', () => {
      this.log(`OSC Query HTTP Server started on port ${this.httpPort} (for VRChat discovery)`);
      this.log(`OSC Query advertising OSC UDP port ${this.assignedOscPort} (where VRChat will send data)`);
      // Initialize common VRChat parameters
      this.initializeVRChatParameters();
      if (callback) callback({
        httpPort: this.httpPort,
        oscPort: this.assignedOscPort
      });
    });
    this.httpServer.on('error', (err) => {
      this.log('OSC Query HTTP Server error: ' + err.message, 'error');
      this.emit('error', err);
    });
  }
  stop() {
    if (this.httpServer) {
      this.httpServer.close();
      this.httpServer = null;
    }
  }
  getAssignedOscPort() {
    return this.assignedOscPort;
  }

  getHttpPort() {
    return this.httpPort;
  }

  // Update OSC Query parameter in data structure
  updateOscQueryParameter(address, value, oscType = 'f') {
    const pathParts = address.split('/').filter(part => part.length > 0);
    let current = this.oscQueryData.CONTENTS;
    // Navigate/create the path structure
    for (let i = 0; i < pathParts.length - 1; i++) {
      const part = pathParts[i];
      if (!current[part]) {
        current[part] = {
          DESCRIPTION: `Container: ${part}`,
          FULL_PATH: '/' + pathParts.slice(0, i + 1).join('/'),
          ACCESS: 0,
          CONTENTS: {}
        };
      }
      current = current[part].CONTENTS;
    }
    // Set the final parameter
    const paramName = pathParts[pathParts.length - 1];
    if (paramName) {
      let typeInfo = this.getTypeInfo(value, oscType);
      current[paramName] = {
        DESCRIPTION: `Parameter: ${address}`,
        FULL_PATH: address,
        ACCESS: 3, // Read/Write
        TYPE: typeInfo.type,
        VALUE: [value]
      };
      if (typeInfo.range) {
        current[paramName].RANGE = typeInfo.range;
      }
    }
  }
  // Get type information for OSC Query
  getTypeInfo(value, oscType) {
    if (typeof value === 'boolean' || oscType === 'T' || oscType === 'F') {
      return { type: 'T', range: [{ MIN: false, MAX: true }] };
    } else if (typeof value === 'number') {
      if (Number.isInteger(value) || oscType === 'i') {
        return { type: 'i', range: [{ MIN: -2147483648, MAX: 2147483647 }] };
      } else {
        return { type: 'f', range: [{ MIN: -1.0, MAX: 1.0 }] };
      }
    } else if (typeof value === 'string' || oscType === 's') {
      return { type: 's' };
    }
    return { type: 'f', range: [{ MIN: -1.0, MAX: 1.0 }] };
  }
  getOscQueryPath(requestPath) {
    if (requestPath === '/') {
      return {
        ...this.oscQueryData,
        OSC_PORT: this.assignedOscPort,
        OSC_TRANSPORT: 'UDP'
      };
    }
    const pathParts = requestPath.split('/').filter(part => part.length > 0);
    let current = this.oscQueryData.CONTENTS;
    for (const part of pathParts) {
      if (current[part]) {
        current = current[part];
        if (current.CONTENTS) {
          current = current.CONTENTS;
        } else {
          return current;
        }
      } else {
        return null;
      }
    }
    return current;
  }
  initializeVRChatParameters() {
    const commonParams = [
      { path: '/avatar/parameters/VRCEmote', value: 0, type: 'i' },
      { path: '/avatar/parameters/GestureLeft', value: 0, type: 'i' },
      { path: '/avatar/parameters/GestureRight', value: 0, type: 'i' },
      { path: '/avatar/parameters/LocomotionMode', value: 0, type: 'i' },
      { path: '/avatar/parameters/Viseme', value: 0, type: 'i' },
      { path: '/avatar/parameters/Voice', value: 0.0, type: 'f' },
      { path: '/avatar/parameters/InStation', value: false, type: 'T' },
      { path: '/avatar/parameters/Seated', value: false, type: 'T' },
      { path: '/avatar/parameters/AFK', value: false, type: 'T' },
      { path: '/avatar/parameters/Upright', value: 1.0, type: 'f' },
      { path: '/avatar/parameters/AngularY', value: 0.0, type: 'f' },
      { path: '/avatar/parameters/VelocityX', value: 0.0, type: 'f' },
      { path: '/avatar/parameters/VelocityY', value: 0.0, type: 'f' },
      { path: '/avatar/parameters/VelocityZ', value: 0.0, type: 'f' }
    ];

    commonParams.forEach(param => {
      this.updateOscQueryParameter(param.path, param.value, param.type);
    });
    
    this.log('Initialized common VRChat parameters');
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
}

module.exports = OscQueryService;
