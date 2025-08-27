const fs = require('fs');
const path = require('path');
class Debugger {
  constructor() {
    const unixTimestamp = Math.floor(Date.now() / 1000);
    try {
            const electron = require('electron');
            this.logDir = electron.app ? path.join(electron.app.getPath('userData'), 'logs') : path.join(__dirname, '..', 'logs');
    } catch (e) {
            this.logDir = path.join(__dirname, '..', 'logs');
    }
        this.logFile = path.join(this.logDir, `${unixTimestamp}_debug.log`);
        this.ensureLogDirectory();
    this.startTime = Date.now();
    this.oscMessageCount = 0;
    this.lastVRChatMessage = null;
    this.vrchatDetected = false;
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
            const debugLogs = files.filter(f => f.match(/^\d+_debug\.log$/))
                .map(f => ({
                    name: f,
                    path: path.join(this.logDir, f),
                    timestamp: parseInt(f.split('_')[0])
        }))
        .sort((a, b) => b.timestamp - a.timestamp);
      if (debugLogs.length > 10) {
        const filesToDelete = debugLogs.slice(10);
        filesToDelete.forEach(file => {
          try {
            fs.unlinkSync(file.path);
            console.log(`Cleaned up old debug log: ${file.name}`);
          } catch (err) {
            console.error(`Failed to delete old log file ${file.name}:`, err);
          }
        });
      }
    } catch (err) {
      console.error('Failed to clean old log files:', err);
    }
  }
  log(level, message, data = null) {
    const timestamp = new Date().toISOString();
    const uptime = Math.round((Date.now() - this.startTime) / 1000);
    let logEntry = `[${timestamp}] [+${uptime}s] [${level.toUpperCase()}] ${message}`;
    if (data) {
      logEntry += `\nData: ${JSON.stringify(data, null, 2)}`;
    }
    console.log(logEntry);
    try {
      fs.appendFileSync(this.logFile, logEntry + '\n');
    } catch (err) {
      console.error('Failed to write to log file:', err);
    }
  }
  info(message, data = null) {
    this.log('info', message, data);
  }
  warn(message, data = null) {
    this.log('warn', message, data);
  }
  error(message, data = null) {
    this.log('error', message, data);
  }
  debug(message, data = null) {
    this.log('debug', message, data);
  }
  oscMessageReceived(address, value, type) {
    this.oscMessageCount++;
    if (!this.vrchatDetected && this.isVRChatOSCMessage(address)) {
      this.vrchatDetected = true;
      this.info('VRChat OSC data flow detected!');
    }
  }
  vrchatServiceFound(service, method) {
    this.info(`VRChat service discovered via ${method}`, service);
  }
  logOscClientInit(targetAddress, targetPort) {
    this.info('OSC Client initialized', {
      targetAddress,
      targetPort
    });
  }
  logOscServiceReady(config) {
    const message = `OSC Server listening on port ${config.localPort}`;
    console.log(message);
    this.oscServiceStarted(config.localPort);
    return message;
  }
  logAdditionalConnections(connections) {
    if (connections.length > 0) {
      this.info('Additional OSC connections configured', {
        count: connections.length,
        connections
      });
    }
  }
  logConnectionCountChange(oldCount, newCount, newConnections) {
    this.info('OSC connection count changed', { 
      oldCount, 
      newCount,
      incoming: newConnections.filter(c => c.type === 'incoming').length,
      outgoing: newConnections.filter(c => c.type === 'outgoing').length
    });
  }
  logConfigUpdate(oldConfig, newConfig, finalConfig) {
    this.info('Configuration updated', { 
      oldConfig, 
      newConfig,
      finalConfig 
    });
  }
  logAdditionalPortReady(data) {
    const connectionName = data.name ? ` (${data.name})` : '';
    this.info(`Additional OSC ${data.type} connection ready${connectionName}`, data);
  }
  logAdditionalPortError(data) {
    const connectionName = data.name ? ` (${data.name})` : '';
    this.error(`Additional OSC ${data.type} connection error${connectionName}`, data);
  }
  logOscServiceStatus(status) {
    this.info('OSC Service status requested', status);
  }
  logOscForwardingChange(enabled) {
    this.info('OSC forwarding setting changed', { enabled });
  }
  logOscServerStateChange(enabled) {
    this.info(`OSC Server ${enabled ? 'enabled' : 'disabled'} by user request`);
  }
  logAppStartup() {
    this.info('ARC-OSC Client starting up');
  }
  logAppShutdown(reason = 'Application shutting down') {
    this.info(`${reason} - cleaning up connections`);
  }
  oscServiceStarted(oscPort) {
    this.info('OSC Services started', {
      oscUdpPort: oscPort,
    });
  }
  connectionTimeout() {
  }
  isVRChatOSCMessage(address) {
    return address.startsWith('/avatar/') || 
           address.includes('VRC') || 
           address.includes('Viseme') ||
           address.includes('Voice') ||
           address.includes('Gesture') ||
           address.includes('Locomotion');
  }
  getStats() {
    return {
      uptime: Math.round((Date.now() - this.startTime) / 1000),
      vrchatDetected: this.vrchatDetected,
      oscMessagesReceived: this.oscMessageCount,
      lastMessage: this.lastVRChatMessage
    };
  }
  clearOldLogs() {
    try {
      if (fs.existsSync(this.logFile)) {
        fs.unlinkSync(this.logFile);
        this.info('Debug log cleared');
      }
    } catch (err) {
      this.error('Failed to clear log file', err);
    }
  }
  logWebSocketConnection(message) {
    this.info(`[WebSocket] ${message}`);
  }
  logWebSocketForwarding(message) {
  }
  logMemoryUsage(memoryInfo) {
    this.warn('Memory usage status', memoryInfo);
  }
  logMemoryCleanup(details) {
    this.info('Memory cleanup performed', details);
  }
}
module.exports = new Debugger();
