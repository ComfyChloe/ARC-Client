const path = require('path');
const fs = require('fs');
const { app } = require('electron');
class Logger {
  constructor() {
    this.logDir = path.join(app.getPath('userData'), 'logs');
    this.ensureLogDirectory();
  }
  ensureLogDirectory() {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }
  logError(error) {
    const logFile = path.join(this.logDir, `${Date.now()}_error.log`);
    const errorDetails = typeof error === 'string' ? { error } : { error: error.message };
    fs.writeFileSync(logFile, JSON.stringify(errorDetails, null, 2));
    return errorDetails;
  }
  handleOscError(err) {
    const errorDetails = this.logError(err);
    return { status: 'error', error: errorDetails.error };
  }
}
module.exports = new Logger();