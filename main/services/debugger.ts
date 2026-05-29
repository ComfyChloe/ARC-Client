import fs from 'node:fs'
import path from 'node:path'

// Crash submission notice - appended to all crash logs
const CRASH_NOTICE = `
================================================================================
🚨 CRASH REPORT - PLEASE SUBMIT THIS LOG 🚨
================================================================================
If you encountered a crash, please help us fix it by submitting this log:

1. Join the ARC Discord server and post this log in the #bug-reports channel
2. If you have been in contact with ComfyChloe via Direct Messages regarding
   this issue, please mention that in your report

Your crash report helps improve ARC for everyone. Thank you!
================================================================================
`

interface LogFileInfo {
  name: string
  path: string
  timestamp: number
}

interface OscConfig {
  localPort: number
}

interface AdditionalConnection {
  type: 'incoming' | 'outgoing'
  [key: string]: any
}

class Debugger {
  logDir: string
  logFile: string
  startTime: number
  oscMessageCount: number
  lastVRChatMessage: string | null
  vrchatDetected: boolean

  constructor() {
    const unixTimestamp = Math.floor(Date.now() / 1000)
    try {
            const electron = require('electron')
            this.logDir = electron.app ? path.join(electron.app.getPath('userData'), 'logs') : path.join(__dirname, '..', 'logs')
    } catch {
            this.logDir = path.join(__dirname, '..', 'logs')
    }
        this.logFile = path.join(this.logDir, `${unixTimestamp}_debug.log`)
        this.ensureLogDirectory()
    this.startTime = Date.now()
    this.oscMessageCount = 0
    this.lastVRChatMessage = null
    this.vrchatDetected = false
  }
  ensureLogDirectory(): void {
        if (!fs.existsSync(this.logDir)) {
            fs.mkdirSync(this.logDir, { recursive: true })
    }
        this.cleanOldLogFiles()
  }
  cleanOldLogFiles(): void {
    try {
            const files = fs.readdirSync(this.logDir)
            const debugLogs: LogFileInfo[] = files.filter(f => f.match(/^\d+_debug\.log$/))
                .map(f => ({
                    name: f,
                    path: path.join(this.logDir, f),
                    timestamp: parseInt(f.split('_')[0])
        }))
        .sort((a, b) => b.timestamp - a.timestamp)
      if (debugLogs.length > 10) {
        const filesToDelete = debugLogs.slice(10)
        filesToDelete.forEach(file => {
          try {
            fs.unlinkSync(file.path)
            console.log(`Cleaned up old debug log: ${file.name}`)
          } catch (err) {
            console.error(`Failed to delete old log file ${file.name}:`, err)
          }
        })
      }
    } catch (err) {
      console.error('Failed to clean old log files:', err)
    }
  }
  log(level: string, message: string, data: unknown = null): void {
    const timestamp = new Date().toISOString()
    const uptime = Math.round((Date.now() - this.startTime) / 1000);
    let logEntry = `[${timestamp}] [+${uptime}s] [${level.toUpperCase()}] ${message}`
    if (data) {
      logEntry += `\nData: ${JSON.stringify(data, null, 2)}`
    }
    console.log(logEntry)
    try {
      fs.appendFileSync(this.logFile, logEntry + '\n')
    } catch (err) {
      console.error('Failed to write to log file:', err)
    }
  }
  info(message: string, data: unknown = null): void {
    this.log('info', message, data)
  }
  warn(message: string, data: unknown = null): void {
    this.log('warn', message, data)
  }
  error(message: string, data: unknown = null): void {
    this.log('error', message, data)
  }
  debug(message: string, data: unknown = null): void {
    this.log('debug', message, data)
  }
  oscMessageReceived(address: string, _value: unknown, _type: string): void {
    this.oscMessageCount++
    if (!this.vrchatDetected && this.isVRChatOSCMessage(address)) {
      this.vrchatDetected = true
      this.info('VRChat OSC data flow detected!')
    }
  }
  vrchatServiceFound(service: unknown, method: string): void {
    this.info(`VRChat service discovered via ${method}`, service)
  }
  logOscClientInit(targetAddress: string, targetPort: number): void {
    this.info('OSC Client initialized', {
      targetAddress,
      targetPort
    })
  }
  logOscServiceReady(config: OscConfig): string {
    const message = `OSC Server listening on port ${config.localPort}`
    console.log(message)
    this.oscServiceStarted(config.localPort)
    return message
  }
  logAdditionalConnections(connections: AdditionalConnection[]): void {
    if (connections.length > 0) {
      this.info('Additional OSC connections configured', {
        count: connections.length,
        connections
      })
    }
  }
  logConnectionCountChange(oldCount: number, newCount: number, newConnections: AdditionalConnection[]): void {
    this.info('OSC connection count changed', { 
      oldCount, 
      newCount,
      incoming: newConnections.filter(c => c.type === 'incoming').length,
      outgoing: newConnections.filter(c => c.type === 'outgoing').length
    })
  }
  logConfigUpdate(oldConfig: unknown, newConfig: unknown, finalConfig: unknown): void {
    this.info('Configuration updated', { 
      oldConfig, 
      newConfig,
      finalConfig 
    })
  }
  logAdditionalPortReady(data: { type: string; name?: string; [key: string]: unknown }): void {
    const connectionName = data.name ? ` (${data.name})` : ''
    this.info(`Additional OSC ${data.type} connection ready${connectionName}`, data)
  }
  logAdditionalPortError(data: { type: string; name?: string; [key: string]: unknown }): void {
    const connectionName = data.name ? ` (${data.name})` : ''
    this.error(`Additional OSC ${data.type} connection error${connectionName}`, data)
  }
  logOscServiceStatus(status: unknown): void {
    this.info('OSC Service status requested', status)
  }
  logOscForwardingChange(enabled: boolean): void {
    this.info('OSC forwarding setting changed', { enabled })
  }
  logOscServerStateChange(enabled: boolean): void {
    this.info(`OSC Server ${enabled ? 'enabled' : 'disabled'} by user request`)
  }
  logAppStartup(): void {
    this.info('ARC-OSC Client starting up')
  }
  logAppShutdown(reason = 'Application shutting down'): void {
    this.info(`${reason} - cleaning up connections`)
  }
  oscServiceStarted(oscPort: number): void {
    this.info('OSC Services started', {
      oscUdpPort: oscPort,
    })
  }
  connectionTimeout(): void {
  }
  isVRChatOSCMessage(address: string): boolean {
    return address.startsWith('/avatar/') || 
           address.includes('VRC') || 
           address.includes('Viseme') ||
           address.includes('Voice') ||
           address.includes('Gesture') ||
           address.includes('Locomotion')
  }
  getStats(): { uptime: number; vrchatDetected: boolean; oscMessagesReceived: number; lastMessage: string | null } {
    return {
      uptime: Math.round((Date.now() - this.startTime) / 1000),
      vrchatDetected: this.vrchatDetected,
      oscMessagesReceived: this.oscMessageCount,
      lastMessage: this.lastVRChatMessage
    }
  }
  clearOldLogs(): void {
    try {
      if (fs.existsSync(this.logFile)) {
        fs.unlinkSync(this.logFile)
        this.info('Debug log cleared')
      }
    } catch (err) {
      this.error('Failed to clear log file', err)
    }
  }
  logWebSocketConnection(message: string): void {
    this.info(`[WebSocket] ${message}`)
  }
  logWebSocketForwarding(_message: string): void {
  }
  logMemoryUsage(memoryInfo: unknown): void {
    this.warn('Memory usage status', memoryInfo)
  }
  logMemoryCleanup(details: unknown): void {
    this.info('Memory cleanup performed', details)
  }
  logError(error: Error | string | unknown): { error: string } {
    const err = error as { message?: string; stack?: string }
    const errorMessage = err && err.message ? err.message : String(error)
    const errorStack = err && err.stack ? err.stack : 'No stack trace available'
    this.error(`Error logged: ${errorMessage}`, {
      message: errorMessage,
      stack: errorStack
    })
    return { error: errorMessage }
  }
  
  // Crash and critical error logging
  logRendererCrash(details: { reason?: string; exitCode?: number; signal?: string; [key: string]: unknown }): void {
    this.error('RENDERER PROCESS CRASHED', {
      timestamp: new Date().toISOString(),
      reason: details.reason || 'Unknown',
      exitCode: details.exitCode,
      signal: details.signal,
      ...details
    })
  }
  
  logRendererUnresponsive(details: { duration?: string; [key: string]: unknown }): void {
    this.error('RENDERER PROCESS UNRESPONSIVE', {
      timestamp: new Date().toISOString(),
      duration: details.duration || 'Unknown',
      ...details
    })
  }
  
  logUncaughtException(error: Error & { code?: string }, source = 'main'): void {
    this.error(`UNCAUGHT EXCEPTION (${source})`, {
      timestamp: new Date().toISOString(),
      message: error.message || String(error),
      stack: error.stack || 'No stack trace',
      name: error.name,
      code: error.code,
      source
    })
  }
  
  logUnhandledRejection(reason: unknown, _promise: Promise<unknown>, source = 'main'): void {
    const r = reason as { message?: string; stack?: string }
    this.error(`UNHANDLED PROMISE REJECTION (${source})`, {
      timestamp: new Date().toISOString(),
      reason: r && r.message ? r.message : String(reason),
      stack: r && r.stack ? r.stack : 'No stack trace',
      source
    })
  }
  
  logRendererError(error: { message?: string; stack?: string; filename?: string; lineno?: number; colno?: number }, context: Record<string, unknown> = {}): void {
    this.error('RENDERER ERROR', {
      timestamp: new Date().toISOString(),
      message: error.message || String(error),
      stack: error.stack || 'No stack trace',
      filename: error.filename,
      lineno: error.lineno,
      colno: error.colno,
      ...context
    })
  }
  
  logRendererConsoleError(args: unknown[], context: Record<string, unknown> = {}): void {
    this.error('RENDERER CONSOLE ERROR', {
      timestamp: new Date().toISOString(),
      arguments: args,
      ...context
    })
  }
  
  logCriticalShutdown(reason: string, source: string): void {
    this.error('CRITICAL SHUTDOWN INITIATED', {
      timestamp: new Date().toISOString(),
      reason,
      source,
      uptime: Math.round((Date.now() - this.startTime) / 1000) + 's'
    })
    // Append crash notice to log file
    this.appendCrashNotice()
  }
  
  appendCrashNotice(): void {
    try {
      fs.appendFileSync(this.logFile, CRASH_NOTICE + '\n')
    } catch (err) {
      console.error('Failed to append crash notice:', err)
    }
  }
  
  /**
   * Formats a crash message with full context for error dialogs
   * @param {string} errorType - Type of error (e.g., 'Uncaught Exception', 'Renderer Crash')
   * @param {string} errorMessage - Brief error message
   * @returns {string} Formatted message for display
   */
  formatCrashDialogMessage(errorType: string, errorMessage: string): string {
    return `${errorType}

${errorMessage}

A crash log has been saved. Please submit this log to help us fix the issue:
• Join the ARC Discord and post in #bug-reports
• If you've contacted ComfyChloe via DMs about this, please mention that

Log location:
${this.logFile}`;
  }
  
  /**
   * Gets the current log file path for error dialogs
   * @returns {string} Path to the current log file
   */
  getLogFilePath(): string {
    return this.logFile
  }
  
  /**
   * Consolidated error logging from legacy logger.js
   * Creates a standalone error file (for backwards compatibility)
   * @param {Error|string} error - The error to log
   * @returns {object} Error details object
   */
  logErrorToFile(error: Error | string | unknown): { timestamp: string; message: string; stack: string } {
    const err = error as { message?: string; stack?: string }
    const errorMessage = err && err.message ? err.message : String(error)
    const errorStack = err && err.stack ? err.stack : 'No stack trace available'
    const errorDetails = {
      timestamp: new Date().toISOString(),
      message: errorMessage,
      stack: errorStack
    }
    // Log to main debug log
    this.error(`Error logged: ${errorMessage}`, errorDetails)
    return errorDetails
  }
  
  /**
   * Handles OSC errors with proper logging (from legacy logger.js)
   * @param {Error} err - The OSC error
   * @returns {object} Status object with error details
   */
  handleOscError(err: Error): { status: string; error: string } {
    const errorDetails = this.logErrorToFile(err)
    return { status: 'error', error: errorDetails.message }
  }
}
export default new Debugger()
