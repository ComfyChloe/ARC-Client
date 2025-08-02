const fs = require('fs');
const path = require('path');

class Debugger {
  constructor() {
    const unixTimestamp = Math.floor(Date.now() / 1000);
    this.logFile = path.join(__dirname, '..', 'logs', `${unixTimestamp}_debug.log`);
    this.ensureLogDirectory();
    this.startTime = Date.now();
    this.oscMessageCount = 0;
    this.lastVRChatMessage = null;
    this.vrchatDetected = false;
  }
  ensureLogDirectory() {
    const logDir = path.dirname(this.logFile);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    this.cleanOldLogFiles();
  }
  cleanOldLogFiles() {
    try {
      const logDir = path.dirname(this.logFile);
      const files = fs.readdirSync(logDir);
      const debugLogs = files.filter(f => f.match(/^\d+_debug\.log$/))
        .map(f => ({
          name: f,
          path: path.join(logDir, f),
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
    this.lastVRChatMessage = { address, value, type, timestamp: Date.now() };
    if (this.oscMessageCount % 10 === 0 || address.includes('VRCEmote') || address.includes('Voice') || this.oscMessageCount <= 5) {
      this.debug(`OSC Message #${this.oscMessageCount}`, {
        address,
        value,
        type,
        totalReceived: this.oscMessageCount
      });
    }
    if (!this.vrchatDetected && this.isVRChatOSCMessage(address)) {
      this.vrchatDetected = true;
      this.info('VRChat OSC data flow detected!', {
        firstMessage: { address, value, type },
        totalMessages: this.oscMessageCount
      });
    }
  }
  vrchatServiceFound(service, method) {
    this.info(`VRChat service discovered via ${method}`, service);
  }
  oscServiceStarted(oscPort) {
    this.info('OSC Services started', {
      oscUdpPort: oscPort,
      message: 'Waiting for VRChat to discover and connect...'
    });
  }
  connectionTimeout() {
    if (!this.vrchatDetected && this.oscMessageCount === 0) {
      this.warn('No VRChat connection detected', {
        uptime: Math.round((Date.now() - this.startTime) / 1000),
        suggestions: [
          'Check if VRChat OSC is enabled in Settings → OSC',
          'Ensure VRChat is running and in a world',
          'Check Windows Firewall settings',
          'Verify no other OSC applications are using the same ports'
        ]
      });
    }
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
}
module.exports = new Debugger();
