const express = require('express');
const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');
const debug = require('./debugger');

// OSCQuery ACCESS constants as per specification
const ACCESS = {
  NONE: 0,        // No access
  READ_ONLY: 1,   // Read only
  WRITE_ONLY: 2,  // Write only  
  READ_WRITE: 3   // Read and write
};

class OscQueryService {
  constructor() {
    this.httpServer = null;
    this.httpPort = 0; // OSCQuery HTTP server - OS assigned
    this.advertisedOscPort = null; // OSC UDP port we advertise for receiving - OS assigned
    
    // Port allocation strategy per OSCQuery spec:
    // - OSCQuery HTTP: OS-assigned port 0 (automatic) - for serving JSON tree AND receiving OSC data via HTTP POST
    // - OSC UDP port: OS-assigned port 0 (automatic) - advertised in OSCQuery for compliance but NOT used for receiving
    // - OSC UDP sending: Port 9000 (VRChat standard) - handled by OscUdpService
    // 
    // IMPORTANT: We receive OSC data via OSCQuery HTTP POST endpoints, not UDP!
    // The advertised UDP port is purely for OSCQuery spec compliance - no fallback logic needed.
    
    this.oscQueryData = {
      DESCRIPTION: 'ARC-OSC Client - Receives OSC via HTTP, Sends to VRChat:9000',
      FULL_PATH: '/',
      ACCESS: ACCESS.WRITE_ONLY, // We accept OSC data via HTTP POST
      CONTENTS: {}
    };
    // HOST_INFO data as required by OSCQuery spec
    this.hostInfo = {
      NAME: 'ARC-OSC-Client',
      OSC_IP: '127.0.0.1',
      OSC_PORT: null, // Will be set when service starts
      OSC_TRANSPORT: 'UDP',
      EXTENSIONS: {
        ACCESS: true,
        CLIPMODE: false,
        CRITICAL: false,
        DESCRIPTION: true,
        HTML: false,
        LISTEN: false,
        OVERLOADS: false,
        RANGE: true,
        TAGS: false,
        TYPE: true,
        UNIT: false,
        VALUE: true
      }
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
  
  // Find an available HTTP port dynamically (like VRChat OSCQuery library)
  findAvailableHttpPort(callback) {
    const server = require('net').createServer();
    // Bind to port 0 to let OS assign an available port automatically
    server.listen(0, '127.0.0.1', () => {
      const assignedPort = server.address().port;
      server.once('close', () => {
        callback(assignedPort);
      });
      server.close();
    });
    server.on('error', (err) => {
      debug.error('Failed to get available HTTP port from OS', err);
      callback(null); // Return null on failure
    });
  }
  
  // Find an available OSC port dynamically (like VRChat OSCQuery library)
  findAvailableOscPort(callback) {
    const server = require('net').createServer();
    // Bind to port 0 to let OS assign an available port automatically
    server.listen(0, '127.0.0.1', () => {
      const assignedPort = server.address().port;
      server.once('close', () => {
        callback(assignedPort);
      });
      server.close();
    });
    server.on('error', (err) => {
      debug.error('Failed to get available OSC port from OS', err);
      callback(null); // Return null on failure
    });
  }

  
  start(callback) {
    const app = express();
    // Find an available HTTP port for OSCQuery (use OS assignment per OSCQuery spec)
    this.findAvailableHttpPort((httpPort) => {
      if (!httpPort) {
        const error = new Error('Failed to get available HTTP port from OS');
        debug.error('OSCQuery startup failed', error);
        this.emit('error', error);
        return;
      }
      
      this.httpPort = httpPort;
      // Find an available OSC port to advertise for receiving (use OS assignment per OSCQuery spec)
      this.findAvailableOscPort((oscPort) => {
        if (!oscPort) {
          const error = new Error('Failed to get available OSC port from OS');
          debug.error('OSCQuery startup failed', error);
          this.emit('error', error);
          return;
        }
        
        this.advertisedOscPort = oscPort;
        this.log(`OSCQuery HTTP server: port ${httpPort} (OS-assigned)`);
        this.log(`OSC UDP advertised port: ${oscPort} (OS-assigned, for OSCQuery compliance only)`);
        this.log('OSC UDP sending: port 9000 (VRChat standard, handled by OscUdpService)');
        this.log('OSC data reception: via HTTP POST (not UDP)');
        this.setupHttpServer(app, callback);
      });
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

    // Root endpoint - returns the main OSC tree
    app.get('/', (req, res) => {
      debug.oscQueryRequested('/', req.ip || req.connection.remoteAddress);
      
      // Check for HOST_INFO query parameter
      if (req.query.HOST_INFO !== undefined) {
        const hostInfo = {
          ...this.hostInfo,
          OSC_PORT: this.advertisedOscPort
        };
        res.json(hostInfo);
        return;
      }

      // Check for other query parameters (future extension)
      if (req.query.explorer !== undefined) {
        // Could serve an HTML explorer interface here
        res.send('<html><body><h1>OSCQuery Explorer</h1><p>Use the JSON API at the root path for programmatic access.</p></body></html>');
        return;
      }

      const response = {
        ...this.oscQueryData,
        OSC_IP: '127.0.0.1',
        OSC_PORT: this.advertisedOscPort, // Required for VRChat discovery
        OSC_TRANSPORT: 'UDP'
      };
      res.json(response);
    });

    // Dynamic endpoint handler for any OSC path
    app.get('*', (req, res) => {
      debug.oscQueryRequested(req.path, req.ip || req.connection.remoteAddress);
      
      // Handle HOST_INFO query for any path (spec says path is ignored for HOST_INFO)
      if (req.query.HOST_INFO !== undefined) {
        const hostInfo = {
          ...this.hostInfo,
          OSC_PORT: this.advertisedOscPort
        };
        res.json(hostInfo);
        return;
      }
      
      const path = req.path;
      
      // Check for specific attribute queries
      const queryKeys = Object.keys(req.query);
      if (queryKeys.length > 0 && queryKeys[0] !== 'explorer') {
        const attribute = queryKeys[0].toUpperCase();
        const pathData = this.getOscQueryPath(path);
        
        if (!pathData) {
          res.status(404).json({ 
            error: 'OSC address not found',
            path: path 
          });
          return;
        }
        
        // Check if server supports this attribute
        if (this.hostInfo.EXTENSIONS[attribute] === false) {
          res.status(400).json({ 
            error: 'Attribute not supported by server',
            attribute: attribute 
          });
          return;
        }
        
        // Check if attribute exists for this path
        if (pathData[attribute] === undefined) {
          res.status(204).end(); // No content - server received request but inappropriate
          return;
        }
        
        // Return just the requested attribute
        const response = {};
        response[attribute] = pathData[attribute];
        res.json(response);
        return;
      }
      
      // Return full path data
      const pathData = this.getOscQueryPath(path);
      if (pathData) {
        res.json(pathData);
      } else {
        res.status(404).json({ 
          error: 'OSC address not found',
          path: path
        });
      }
    });
    // POST endpoint for receiving OSC data via OSCQuery
    app.post('*', express.json(), (req, res) => {
      const path = req.path;
      const value = req.body.value;
      const type = req.body.type || 'f';
      
      if (value !== undefined) {
        debug.log(`OSC data received via OSCQuery: ${path} = ${value} (${type})`);
        
        // Update our data structure
        this.updateOscQueryParameter(path, value, type);
        
        // Emit event for forwarding to WebSocket and renderer
        this.emit('dataReceived', { 
          address: path, 
          value: value, 
          type: type 
        });
        
        res.json({ success: true });
      } else {
        res.status(400).json({ error: 'No value provided' });
      }
    });
    this.httpServer = app.listen(this.httpPort, '127.0.0.1', () => {
      this.log(`OSC Query HTTP Server started on port ${this.httpPort}`);
      this.log(`Advertising OSC UDP receiving port ${this.advertisedOscPort} for discovery`);
      this.log(`OSCQuery service available at: http://127.0.0.1:${this.httpPort}`);
      this.log(`HOST_INFO available at: http://127.0.0.1:${this.httpPort}?HOST_INFO`);
      this.log('Note: OSC sending to VRChat uses port 9000 (handled separately by OscUdpService)');
      
      // Update host info with the actual port
      this.hostInfo.OSC_PORT = this.advertisedOscPort;
      
      // Initialize common VRChat parameters
      this.initializeVRChatParameters();
      if (callback) callback({
        httpPort: this.httpPort,
        oscPort: this.advertisedOscPort // This is the port we advertise for receiving
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

  getHttpPort() {
    return this.httpPort;
  }

  getAdvertisedOscPort() {
    return this.advertisedOscPort;
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
          ACCESS: ACCESS.WRITE_ONLY, // Containers can accept data to sub-paths via HTTP POST
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
        DESCRIPTION: `OSC Parameter: ${address}`,
        FULL_PATH: address,
        ACCESS: ACCESS.READ_WRITE, // Use constant instead of magic number
        TYPE: typeInfo.type,
        VALUE: [value] // OSCQuery spec requires array format
      };
      
      // Add RANGE if applicable
      if (typeInfo.range) {
        current[paramName].RANGE = typeInfo.range;
      }
    }
  }
  // Get type information for OSC Query
  getTypeInfo(value, oscType) {
    if (typeof value === 'boolean' || oscType === 'T' || oscType === 'F') {
      return { 
        type: 'T',
        range: [{ MIN: false, MAX: true }] 
      };
    } else if (typeof value === 'number') {
      if (Number.isInteger(value) || oscType === 'i') {
        return { 
          type: 'i',
          range: [{ MIN: -2147483648, MAX: 2147483647 }] 
        };
      } else {
        return { 
          type: 'f',
          range: [{ MIN: -1.0, MAX: 1.0 }] 
        };
      }
    } else if (typeof value === 'string' || oscType === 's') {
      return { type: 's' }; // No range for strings
    }
    
    // Default fallback
    return { 
      type: 'f',
      range: [{ MIN: -1.0, MAX: 1.0 }] 
    };
  }
  getOscQueryPath(requestPath) {
    if (requestPath === '/') {
      return {
        ...this.oscQueryData,
        OSC_IP: '127.0.0.1',
        OSC_PORT: this.advertisedOscPort, // Required for VRChat discovery
        OSC_TRANSPORT: 'UDP'
      };
    }
    
    const pathParts = requestPath.split('/').filter(part => part.length > 0);
    let current = this.oscQueryData.CONTENTS;
    
    for (let i = 0; i < pathParts.length; i++) {
      const part = pathParts[i];
      if (current[part]) {
        if (i === pathParts.length - 1) {
          // This is the final part - return the node
          return current[part];
        } else {
          // Navigate deeper if there are more parts
          if (current[part].CONTENTS) {
            current = current[part].CONTENTS;
          } else {
            // This node has no contents but we're not at the end
            return null;
          }
        }
      } else {
        return null;
      }
    }
    
    // If we get here, we're looking at a container
    return {
      DESCRIPTION: `Container at ${requestPath}`,
      FULL_PATH: requestPath,
      ACCESS: ACCESS.WRITE_ONLY, // Containers can accept data to sub-paths via HTTP POST
      CONTENTS: current
    };
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

  // Add endpoint as per OSCQuery spec
  addEndpoint(address, oscType, access, description, value = null) {
    const pathParts = address.split('/').filter(part => part.length > 0);
    let current = this.oscQueryData.CONTENTS;
    
    // Navigate/create the path structure
    for (let i = 0; i < pathParts.length - 1; i++) {
      const part = pathParts[i];
      if (!current[part]) {
        current[part] = {
          DESCRIPTION: `Container: ${part}`,
          FULL_PATH: '/' + pathParts.slice(0, i + 1).join('/'),
          ACCESS: ACCESS.WRITE_ONLY, // Containers can accept data to sub-paths via HTTP POST
          CONTENTS: {}
        };
      }
      current = current[part].CONTENTS;
    }
    
    // Set the final parameter
    const paramName = pathParts[pathParts.length - 1];
    if (paramName) {
      const endpoint = {
        DESCRIPTION: description || `OSC Parameter: ${address}`,
        FULL_PATH: address,
        ACCESS: access,
        TYPE: oscType
      };
      
      // Add value if provided
      if (value !== null) {
        endpoint.VALUE = [value];
      }
      
      // Add range based on type
      if (oscType === 'f') {
        endpoint.RANGE = [{ MIN: -1.0, MAX: 1.0 }];
      } else if (oscType === 'i') {
        endpoint.RANGE = [{ MIN: -2147483648, MAX: 2147483647 }];
      } else if (oscType === 'T') {
        endpoint.RANGE = [{ MIN: false, MAX: true }];
      }
      
      current[paramName] = endpoint;
      this.log(`Added OSCQuery endpoint: ${address} (${oscType})`);
    }
  }

  // Remove endpoint as per OSCQuery spec
  removeEndpoint(address) {
    const pathParts = address.split('/').filter(part => part.length > 0);
    if (pathParts.length === 0) return false;
    
    let current = this.oscQueryData.CONTENTS;
    
    // Navigate to parent container
    for (let i = 0; i < pathParts.length - 1; i++) {
      const part = pathParts[i];
      if (current[part] && current[part].CONTENTS) {
        current = current[part].CONTENTS;
      } else {
        return false; // Path doesn't exist
      }
    }
    
    // Remove the final parameter
    const paramName = pathParts[pathParts.length - 1];
    if (current[paramName]) {
      delete current[paramName];
      this.log(`Removed OSCQuery endpoint: ${address}`);
      return true;
    }
    
    return false;
  }
}

module.exports = OscQueryService;
module.exports.ACCESS = ACCESS;
