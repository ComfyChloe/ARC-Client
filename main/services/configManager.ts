import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import debug from './debugger'
import { encryptData, decryptData } from './encryption'

interface AppSettings {
  enableWebSocketForwarding: boolean
  hyperateAutostart: boolean
  oscleashAutostart: boolean
  ogbAutostart: boolean
  oscAutostart: boolean
  xsOverlayAutostart: boolean
  theme: string
  lastUsername: string
  savedPassword: string
  snowEnabled: boolean
  [key: string]: unknown
}

interface WindowState {
  width: number
  height: number
  x: number | undefined
  y: number | undefined
  maximized: boolean
}

interface HyperateConfig {
  primaryTracker: string | null
  trackers: string[]
  trackerNames: Record<string, string>
  trackerStates: Record<string, boolean>
  [key: string]: unknown
}

interface DirectionalParameters {
  Z_Positive_Param: string
  Z_Negative_Param: string
  X_Positive_Param: string
  X_Negative_Param: string
  Y_Positive_Param: string
  Y_Negative_Param: string
}

interface OscLeashConfig {
  RunDeadzone: number
  WalkDeadzone: number
  StrengthMultiplier: number
  UpDownCompensation: number
  UpDownDeadzone: number
  ActiveDelay: number
  InactiveDelay: number
  Logging: boolean
  PhysboneParameters: string[]
  DirectionalParameters: DirectionalParameters
  [key: string]: unknown
}

interface VRChatAPIConfig {
  enabled: boolean
  authToken: string | null
  twoFactorToken: string | null
  [key: string]: unknown
}

interface OscGoesbrrrConfig {
  enabled: boolean
  intifaceAddress: string
  intifacePort: number
  intifaceWss: boolean
  devices: unknown[]
  audioEnabled: boolean
  audioMultiplier: number
  maxLevelParam: string | null
  [key: string]: unknown
}

interface AutoStatusSettings {
  cooldownSeconds: number
  timeFormat: string
  alwaysAllowOverride?: boolean
}

interface AutoStatusConfig {
  presets: unknown[]
  schedule: unknown[]
  settings: AutoStatusSettings
  [key: string]: unknown
}

interface XSOverlayConfig {
  enabled: boolean
  autoStart: boolean
  port: number
  notifications: {
    panelConnections: boolean
    avatarChanges: boolean
  }
  notificationTimeout: number
  notificationHeight: number
  notificationOpacity: number
  notificationVolume: number
  notificationAudioPath: string
  [key: string]: unknown
}
interface AppConfig {
  legacyOscPort: number
  targetOscPort: number
  targetOscAddress: string
  oscQueryBindAddress: string
  additionalOscConnections: unknown[]
  websocketServerUrl: string
  logLevel: string
  appSettings: AppSettings
  oscQueryUnsubscriptions: string[]
  windowState: WindowState
  hyperate: HyperateConfig
  oscleash: OscLeashConfig
  vrchatapi: VRChatAPIConfig
  oscgoesbrrr: OscGoesbrrrConfig
  autostatus: AutoStatusConfig
  xsOverlay: XSOverlayConfig
  configVersion: number
  [key: string]: unknown
}

class ConfigManager {
  configFile: string
  defaultConfig: AppConfig
  config: AppConfig
  constructor() {
    this.configFile = path.join(app.getPath('userData'), 'config.json')
    this.defaultConfig = {
      legacyOscPort: 9001,
      targetOscPort: 9000,
      targetOscAddress: '127.0.0.1',
      oscQueryBindAddress: '127.0.0.1',
      additionalOscConnections: [],
      websocketServerUrl: 'wss://arcosc.app:48255',
      logLevel: 'info',
      appSettings: {
        enableWebSocketForwarding: false,
        hyperateAutostart: false,
        oscleashAutostart: false,
        ogbAutostart: false,
        oscAutostart: false,
        xsOverlayAutostart: false,
        theme: 'light',
        lastUsername: '',
        savedPassword: '',
        snowEnabled: false
      },
      oscQueryUnsubscriptions: [],
      windowState: {
        width: 1200,
        height: 800,
        x: undefined,
        y: undefined,
        maximized: false
      },
      // HypeRate configuration
      hyperate: {
        primaryTracker: null,
        trackers: [],
        trackerNames: {},
        trackerStates: {}
      },
      // OSCLeash configuration
      oscleash: {
        RunDeadzone: 0.70,
        WalkDeadzone: 0.15,
        StrengthMultiplier: 1.2,
        UpDownCompensation: 1.0,
        UpDownDeadzone: 0.5,
        ActiveDelay: 20,
        InactiveDelay: 500,
        Logging: false,
        PhysboneParameters: ["Leash"],
        DirectionalParameters: {
          Z_Positive_Param: "Leash_Z+",
          Z_Negative_Param: "Leash_Z-",
          X_Positive_Param: "Leash_X+",
          X_Negative_Param: "Leash_X-",
          Y_Positive_Param: "Leash_Y+",
          Y_Negative_Param: "Leash_Y-"
        }
      },
      // VRChat API configuration
      vrchatapi: {
        enabled: false,
        authToken: null,
        twoFactorToken: null
      },
      // OscGoesBrrr configuration
      oscgoesbrrr: {
        enabled: false,
        intifaceAddress: '127.0.0.1',
        intifacePort: 12345,
        intifaceWss: false,
        devices: [],
        audioEnabled: false,
        audioMultiplier: 1.0,
        maxLevelParam: null
      },
      // AutoStatus configuration
      autostatus: {
        presets: [],
        schedule: [],
        locationRules: [],
        settings: {
          cooldownSeconds: 10,
          timeFormat: '24h',
          alwaysAllowOverride: false,
          returnToInitial: false,
          prioritySource: 'schedule'
        }
      },
      // XS Overlay configuration
      xsOverlay: {
        enabled: false,
        autoStart: false,
        port: 42070,
        notifications: {
          panelConnections: true,
          avatarChanges: true
        },
        notificationTimeout: 5,
        notificationHeight: 175,
        notificationOpacity: 1,
        notificationVolume: 0.7,
        notificationAudioPath: 'default'
      },
      // Version for future migration support
      configVersion: 1
    }
    this.config = { ...this.defaultConfig }
    debug.info(`Config file path: ${this.configFile}`)
    this.loadConfig()
  }
  loadConfig(): AppConfig {
    try {
      if (fs.existsSync(this.configFile)) {
        const data = fs.readFileSync(this.configFile, 'utf8')
        const loadedConfig = JSON.parse(data)
        this.config = { ...this.defaultConfig, ...loadedConfig }
        debug.info(`Config loaded from ${this.configFile}`)
        return this.config
      } else {
        debug.info('No config file found, using default config')
        this.saveConfig()
        return this.config
      }
    } catch (error) {
      debug.logError(`Error loading config: ${(error as Error).message}`)
      return this.defaultConfig
    }
  }
  saveConfig(): boolean {
    try {
      const userDataDir = path.dirname(this.configFile)
      if (!fs.existsSync(userDataDir)) {
        fs.mkdirSync(userDataDir, { recursive: true })
        debug.info(`Created directory: ${userDataDir}`)
      }
      fs.writeFileSync(this.configFile, JSON.stringify(this.config, null, 2), 'utf8')
      debug.info(`Config saved to ${this.configFile}`)
      return true
    } catch (error) {
      debug.logError(`Error saving config: ${(error as Error).message}`)
      return false
    }
  }
  getConfig(): AppConfig {
    return { ...this.config }
  }
  updateConfig(newConfig: Partial<AppConfig>): boolean {
    // Merge new config with existing config
    this.config = { ...this.config, ...newConfig }
    return this.saveConfig()
  }
  getServerConfig(): {
    legacyOscPort: number
    targetOscPort: number
    targetOscAddress: string
    oscQueryBindAddress: string
    additionalOscConnections: unknown[]
    websocketServerUrl: string
    oscQueryUnsubscriptions: string[]
    appSettings: Partial<AppSettings>
  } {
    return {
      legacyOscPort: this.config.legacyOscPort || 9001,
      targetOscPort: this.config.targetOscPort,
      targetOscAddress: this.config.targetOscAddress,
      oscQueryBindAddress: this.config.oscQueryBindAddress || '127.0.0.1',
      additionalOscConnections: this.config.additionalOscConnections || [],
      websocketServerUrl: this.config.websocketServerUrl,
      oscQueryUnsubscriptions: this.config.oscQueryUnsubscriptions || [],
      appSettings: this.config.appSettings || {}
    }
  }
  getAppSettings(): AppSettings {
    return {
      logLevel: this.config.logLevel || 'info',
      enableWebSocketForwarding: this.config.appSettings?.enableWebSocketForwarding || false,
      hyperateAutostart: this.config.appSettings?.hyperateAutostart || false,
      oscleashAutostart: this.config.appSettings?.oscleashAutostart || false,
      ogbAutostart: this.config.appSettings?.ogbAutostart || false,
      oscAutostart: this.config.appSettings?.oscAutostart || false,
      xsOverlayAutostart: this.config.appSettings?.xsOverlayAutostart || false,
      theme: this.config.appSettings?.theme || 'light',
      lastUsername: this.config.appSettings?.lastUsername || '',
      savedPassword: this.config.appSettings?.savedPassword || '',
      snowEnabled: this.config.appSettings?.snowEnabled ?? false
    }
  }
  updateAppSettings(settings: Partial<AppSettings> & { logLevel?: string }): boolean {
    this.config.logLevel = settings.logLevel ?? this.config.logLevel
    if (!this.config.appSettings) {
      this.config.appSettings = {} as AppSettings
    }
    if (settings.enableWebSocketForwarding !== undefined) {
      this.config.appSettings.enableWebSocketForwarding = settings.enableWebSocketForwarding
    }
    if (settings.hyperateAutostart !== undefined) {
      this.config.appSettings.hyperateAutostart = settings.hyperateAutostart
    }
    if (settings.oscleashAutostart !== undefined) {
      this.config.appSettings.oscleashAutostart = settings.oscleashAutostart
    }
    if (settings.ogbAutostart !== undefined) {
      this.config.appSettings.ogbAutostart = settings.ogbAutostart
    }
    if (settings.oscAutostart !== undefined) {
      this.config.appSettings.oscAutostart = settings.oscAutostart
    }
    if (settings.xsOverlayAutostart !== undefined) {
      this.config.appSettings.xsOverlayAutostart = settings.xsOverlayAutostart
    }
    if (settings.theme !== undefined) {
      this.config.appSettings.theme = settings.theme
    }
    if (settings.lastUsername !== undefined) {
      this.config.appSettings.lastUsername = settings.lastUsername
    }
    if (settings.savedPassword !== undefined) {
      this.config.appSettings.savedPassword = settings.savedPassword
    }
    if (settings.snowEnabled !== undefined) {
      this.config.appSettings.snowEnabled = settings.snowEnabled
    }
    debug.info(`Final app settings`)
    const saveResult = this.saveConfig()
    debug.info(`Config save result: ${saveResult}`)
    return saveResult
  }
  getWindowState(): WindowState {
    return {
      width: this.config.windowState?.width || 1200,
      height: this.config.windowState?.height || 800,
      x: this.config.windowState?.x,
      y: this.config.windowState?.y,
      maximized: this.config.windowState?.maximized || false
    }
  }
  updateWindowState(windowState: Partial<WindowState>): boolean {
    if (!this.config.windowState) {
      this.config.windowState = {} as WindowState
    }
    this.config.windowState = {
      ...this.config.windowState,
      ...windowState
    }
    debug.info(`Window state updated: ${JSON.stringify(this.config.windowState)}`)
    return this.saveConfig()
  }
  getSavedPassword(): string {
    const encryptedPassword = this.config.appSettings?.savedPassword || ''
    if (!encryptedPassword) return ''
    
    const decrypted = decryptData(encryptedPassword)
    if (!decrypted) {
      debug.warn('Failed to decrypt saved password, clearing stored value')
      this.setSavedPassword('')
      return ''
    }
    
    return decrypted
  }
  setSavedPassword(password: string): boolean {
    if (!this.config.appSettings) {
      this.config.appSettings = {} as AppSettings
    }
    
    if (!password) {
      this.config.appSettings.savedPassword = ''
      debug.info('Saved password cleared in configuration')
      return this.saveConfig()
    }
    
    const encrypted = encryptData(password)
    if (!encrypted) {
      debug.error('Failed to encrypt password')
      return false
    }
    
    this.config.appSettings.savedPassword = encrypted
    debug.info('Saved password updated (encrypted) in configuration')
    return this.saveConfig()
  }
  getHyperateConfig(): HyperateConfig {
    if (!this.config.hyperate) {
      this.config.hyperate = {
        primaryTracker: null,
        trackers: [],
        trackerNames: {},
        trackerStates: {}
      }
    }
    return { ...this.config.hyperate }
  }
  updateHyperateConfig(hyperateConfig: Partial<HyperateConfig>): boolean {
    if (!this.config.hyperate) {
      this.config.hyperate = {} as HyperateConfig
    }
    this.config.hyperate = {
      ...this.config.hyperate,
      ...hyperateConfig
    }
    debug.info('HypeRate config updated in configuration manager')
    return this.saveConfig()
  }
  getOSCLeashConfig(): OscLeashConfig {
    if (!this.config.oscleash) {
      this.config.oscleash = {
        RunDeadzone: 0.70,
        WalkDeadzone: 0.15,
        StrengthMultiplier: 1.2,
        UpDownCompensation: 1.0,
        UpDownDeadzone: 0.5,
        ActiveDelay: 20,
        InactiveDelay: 500,
        Logging: false,
        PhysboneParameters: ["Leash"],
        DirectionalParameters: {
          Z_Positive_Param: "Leash_Z+",
          Z_Negative_Param: "Leash_Z-",
          X_Positive_Param: "Leash_X+",
          X_Negative_Param: "Leash_X-",
          Y_Positive_Param: "Leash_Y+",
          Y_Negative_Param: "Leash_Y-"
        }
      }
    }
    return { ...this.config.oscleash }
  }
  updateOSCLeashConfig(oscLeashConfig: Partial<OscLeashConfig>): boolean {
    if (!this.config.oscleash) {
      this.config.oscleash = {} as OscLeashConfig
    }
    this.config.oscleash = {
      ...this.config.oscleash,
      ...oscLeashConfig
    }
    debug.info('OSCLeash config updated in configuration manager')
    return this.saveConfig()
  }
  getVRChatAPIConfig(): VRChatAPIConfig {
    if (!this.config.vrchatapi) {
      this.config.vrchatapi = {
        enabled: false,
        authToken: null,
        twoFactorToken: null
      }
    }
    return { ...this.config.vrchatapi }
  }
  updateVRChatAPIConfig(vrchatApiConfig: Partial<VRChatAPIConfig>): boolean {
    if (!this.config.vrchatapi) {
      this.config.vrchatapi = {} as VRChatAPIConfig
    }
    this.config.vrchatapi = {
      ...this.config.vrchatapi,
      ...vrchatApiConfig
    }
    debug.info('VRChat API config updated in configuration manager')
    return this.saveConfig()
  }
  getAutoStatusConfig(): AutoStatusConfig {
    if (!this.config.autostatus) {
      this.config.autostatus = {
        presets: [],
        schedule: [],
        settings: {
          cooldownSeconds: 10,
          timeFormat: '24h'
        }
      }
    }
    return JSON.parse(JSON.stringify(this.config.autostatus))
  }
  updateAutoStatusConfig(autoStatusConfig: Partial<AutoStatusConfig>): boolean {
    if (!this.config.autostatus) {
      this.config.autostatus = {} as AutoStatusConfig
    }
    this.config.autostatus = {
      ...this.config.autostatus,
      ...autoStatusConfig
    }
    debug.info('AutoStatus config updated in configuration manager')
    return this.saveConfig()
  }
  getOgbConfig(): OscGoesbrrrConfig {
    if (!this.config.oscgoesbrrr) {
      this.config.oscgoesbrrr = {
        enabled: false,
        intifaceAddress: '127.0.0.1',
        intifacePort: 12345,
        intifaceWss: false,
        devices: [],
        audioEnabled: false,
        audioMultiplier: 1.0,
        maxLevelParam: null
      }
    }
    return { ...this.config.oscgoesbrrr }
  }
  updateOgbConfig(ogbConfig: Partial<OscGoesbrrrConfig>): boolean {
    if (!this.config.oscgoesbrrr) {
      this.config.oscgoesbrrr = {} as OscGoesbrrrConfig
    }
    this.config.oscgoesbrrr = {
      ...this.config.oscgoesbrrr,
      ...ogbConfig
    }
    debug.info('OscGoesBrrr config updated in configuration manager')
    return this.saveConfig()
  }
}
export default new ConfigManager()