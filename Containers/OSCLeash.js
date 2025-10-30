const debug = require('../utils/debugger');
const configManager = require('../utils/configManager');

/**
 * Default configuration for OSCLeash
 */
const DefaultConfig = {
  IP: "127.0.0.1",
  ListeningPort: 9001,
  SendingPort: 9000,
  RunDeadzone: 0.70,
  WalkDeadzone: 0.15,
  StrengthMultiplier: 1.2,
  UpDownCompensation: 1.0,
  UpDownDeadzone: 0.5,
  TurningEnabled: false,
  TurningMultiplier: 0.80,
  TurningDeadzone: 0.15,
  TurningGoal: 90,
  ActiveDelay: 20, // milliseconds
  InactiveDelay: 500, // milliseconds
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
};

/**
 * Configuration Settings Manager
 */
class OSCLeashConfig {
  constructor(configData = null) {
    this.setSettings(configData || DefaultConfig);
  }

  setSettings(configJson) {
    try {
      this.IP = configJson.IP || DefaultConfig.IP;
      this.ListeningPort = configJson.ListeningPort || DefaultConfig.ListeningPort;
      this.SendingPort = configJson.SendingPort || DefaultConfig.SendingPort;
      this.RunDeadzone = configJson.RunDeadzone ?? DefaultConfig.RunDeadzone;
      this.WalkDeadzone = configJson.WalkDeadzone ?? DefaultConfig.WalkDeadzone;
      this.StrengthMultiplier = configJson.StrengthMultiplier ?? DefaultConfig.StrengthMultiplier;
      this.UpDownCompensation = configJson.UpDownCompensation ?? DefaultConfig.UpDownCompensation;
      this.UpDownDeadzone = configJson.UpDownDeadzone ?? DefaultConfig.UpDownDeadzone;
      this.TurningEnabled = configJson.TurningEnabled ?? DefaultConfig.TurningEnabled;
      this.TurningMultiplier = configJson.TurningMultiplier ?? DefaultConfig.TurningMultiplier;
      this.TurningDeadzone = configJson.TurningDeadzone ?? DefaultConfig.TurningDeadzone;
      this.TurningGoal = (configJson.TurningGoal ?? DefaultConfig.TurningGoal) / 180;
      this.ActiveDelay = configJson.ActiveDelay ?? DefaultConfig.ActiveDelay;
      this.InactiveDelay = configJson.InactiveDelay ?? DefaultConfig.InactiveDelay;
      this.Logging = configJson.Logging ?? DefaultConfig.Logging;
      this.Leashes = configJson.PhysboneParameters || DefaultConfig.PhysboneParameters;
      this.DirectionalParameters = configJson.DirectionalParameters || DefaultConfig.DirectionalParameters;
    } catch (error) {
      debug.logError(`OSCLeash: Malformed config, using defaults: ${error.message}`);
      this.setSettings(DefaultConfig);
    }
  }

  printInfo() {
    debug.info('OSCLeash Settings:');
    if (this.Logging) {
      debug.info('  Logging is enabled');
    }
    debug.info(`  IP: ${this.IP === "127.0.0.1" ? "Localhost" : this.IP}`);
    debug.info(`  Listening on port ${this.ListeningPort}`);
    debug.info(`  Sending on port ${this.SendingPort}`);
    debug.info(`  Leash name(s): ${this.Leashes.join(', ')}`);
    debug.info(`  Strength Multiplier: ${this.StrengthMultiplier}`);
    debug.info(`  Delays: ${this.ActiveDelay}ms & ${this.InactiveDelay}ms`);
    debug.info(`  Running Deadzone: ${(this.RunDeadzone * 100).toFixed(0)}% stretch`);
    debug.info(`  Walking Deadzone: ${(this.WalkDeadzone * 100).toFixed(0)}% stretch`);
    debug.info(`  Up/Down Compensation: ${this.UpDownCompensation} & ${(this.UpDownDeadzone * 100).toFixed(0)}% Max Angle`);
    if (this.TurningEnabled) {
      debug.info('  Turning is enabled:');
      debug.info(`    - Multiplier: ${this.TurningMultiplier}`);
      debug.info(`    - Deadzone: ${this.TurningDeadzone}`);
      debug.info(`    - Goal: ${(this.TurningGoal * 180).toFixed(0)}°`);
    }
  }

  toJSON() {
    return {
      IP: this.IP,
      ListeningPort: this.ListeningPort,
      SendingPort: this.SendingPort,
      RunDeadzone: this.RunDeadzone,
      WalkDeadzone: this.WalkDeadzone,
      StrengthMultiplier: this.StrengthMultiplier,
      UpDownCompensation: this.UpDownCompensation,
      UpDownDeadzone: this.UpDownDeadzone,
      TurningEnabled: this.TurningEnabled,
      TurningMultiplier: this.TurningMultiplier,
      TurningDeadzone: this.TurningDeadzone,
      TurningGoal: this.TurningGoal * 180,
      ActiveDelay: this.ActiveDelay,
      InactiveDelay: this.InactiveDelay,
      Logging: this.Logging,
      PhysboneParameters: this.Leashes,
      DirectionalParameters: this.DirectionalParameters
    };
  }
}

/**
 * Leash Data Structure
 */
class Leash {
  constructor(paraName, contacts, settings) {
    this.Name = paraName;
    this.settings = settings;

    this.Stretch = 0;

    this.Z_Positive = 0;
    this.Z_Negative = 0;
    this.X_Positive = 0;
    this.X_Negative = 0;
    this.Y_Positive = 0;
    this.Y_Negative = 0;

    this.turningSpeed = 0;

    // Booleans for thread logic
    this.Grabbed = false;
    this.wasGrabbed = false;
    this.Posed = false;
    this.Active = false;

    if (settings.TurningEnabled) {
      this.LeashDirection = paraName.split("_").pop();
    }

    this.Z_Positive_ParamName = contacts.Z_Positive_Param;
    this.Z_Negative_ParamName = contacts.Z_Negative_Param;
    this.X_Positive_ParamName = contacts.X_Positive_Param;
    this.X_Negative_ParamName = contacts.X_Negative_Param;
    this.Y_Positive_ParamName = contacts.Y_Positive_Param;
    this.Y_Negative_ParamName = contacts.Y_Negative_Param;
  }

  resetMovement() {
    this.Z_Positive = 0;
    this.Z_Negative = 0;
    this.X_Positive = 0;
    this.X_Negative = 0;
    this.Y_Positive = 0;
    this.Y_Negative = 0;
  }

  printDirections() {
    const z = `Z: ${this.Z_Positive.toFixed(2)},${this.Z_Negative.toFixed(2)}`;
    const x = `X: ${this.X_Positive.toFixed(2)},${this.X_Negative.toFixed(2)}`;
    const y = `Y: ${this.Y_Positive.toFixed(2)},${this.Y_Negative.toFixed(2)}`;
    debug.info(`  ${z} | ${x} | ${y}`);
  }
}

/**
 * OSC Package Controller - Handles OSC message routing
 */
class OSCPackageController {
  constructor(leashCollection, oscService) {
    if (!leashCollection || leashCollection.length === 0) {
      throw new Error("Leash collection empty within Package manager.");
    }
    this.leashes = leashCollection;
    this.oscService = oscService;
    this.listeners = new Map();
  }

  listen() {
    // Register listeners for all leashes
    this.listenLeash(this.leashes);
    this.listenParam(this.leashes[0]);
  }

  listenLeash(leashCollection) {
    for (const leash of leashCollection) {
      // Physbone Stretch Value
      const stretchAddress = `/avatar/parameters/${leash.Name}_Stretch`;
      this.registerListener(stretchAddress, (value) => {
        leash.Stretch = value;
      });

      // Physbone Grab Status
      const grabbedAddress = `/avatar/parameters/${leash.Name}_IsGrabbed`;
      this.registerListener(grabbedAddress, (value) => {
        this.updateGrabbed(leash, value);
      });

      // Optional: Physbone Pose Status
      // const posedAddress = `/avatar/parameters/${leash.Name}_IsPosed`;
      // this.registerListener(posedAddress, (value) => {
      //   leash.Posed = value;
      // });
    }
  }

  listenParam(leash) {
    // Z axis
    this.registerListener(`/avatar/parameters/${leash.Z_Positive_ParamName}`, (value) => {
      for (const l of this.leashes) l.Z_Positive = value;
    });
    this.registerListener(`/avatar/parameters/${leash.Z_Negative_ParamName}`, (value) => {
      for (const l of this.leashes) l.Z_Negative = value;
    });

    // X axis
    this.registerListener(`/avatar/parameters/${leash.X_Positive_ParamName}`, (value) => {
      for (const l of this.leashes) l.X_Positive = value;
    });
    this.registerListener(`/avatar/parameters/${leash.X_Negative_ParamName}`, (value) => {
      for (const l of this.leashes) l.X_Negative = value;
    });

    // Y axis
    this.registerListener(`/avatar/parameters/${leash.Y_Positive_ParamName}`, (value) => {
      for (const l of this.leashes) l.Y_Positive = value;
    });
    this.registerListener(`/avatar/parameters/${leash.Y_Negative_ParamName}`, (value) => {
      for (const l of this.leashes) l.Y_Negative = value;
    });
  }

  registerListener(address, callback) {
    if (this.oscService && this.oscService.registerOSCLeashListener) {
      this.oscService.registerOSCLeashListener(address, callback);
      this.listeners.set(address, callback);
    }
  }

  updateGrabbed(currLeash, value) {
    currLeash.Grabbed = value;

    let threadInProgress = false;
    if (currLeash.Grabbed) {
      for (const leash of this.leashes) {
        if (leash.Name !== currLeash.Name && leash.Active) {
          threadInProgress = true;
        }
      }

      if (!threadInProgress && this.onLeashActivate) {
        currLeash.Active = true;
        this.onLeashActivate(currLeash);
      }
    }
  }

  removeAllListeners() {
    if (this.oscService && this.oscService.unregisterOSCLeashListener) {
      for (const [address, callback] of this.listeners) {
        this.oscService.unregisterOSCLeashListener(address, callback);
      }
    }
    this.listeners.clear();
  }
}

/**
 * OSC Leash Program - Main processing logic
 */
class OSCLeashProgram {
  constructor(oscService) {
    this.oscService = oscService;
    this.running = false;
  }

  resetProgram() {
    this.running = false;
  }

  updateProgram(runBool) {
    this.running = runBool;
  }

  async leashRun(leash, counter = 0) {
    if (counter === 0 && this.running || !leash.Active) {
      return;
    }

    if (counter < 0) {
      counter = 1;
    }

    if (!leash.settings.Logging) {
      // In browser context, we'd clear console, but in Node we just log status
      debug.info('OSCLeash is Running');
    } else {
      leash.printDirections();
    }

    // Movement Math
    const outputMultiplier = leash.Stretch * leash.settings.StrengthMultiplier;
    let VerticalOutput = this.clamp((leash.Z_Positive - leash.Z_Negative) * outputMultiplier);
    let HorizontalOutput = this.clamp((leash.X_Positive - leash.X_Negative) * outputMultiplier);

    const Y_Combined = leash.Y_Positive + leash.Y_Negative;
    
    // Up/Down Deadzone - stops movement if pulled too high or low
    if (Y_Combined >= leash.settings.UpDownDeadzone) {
      VerticalOutput = 0.0;
      HorizontalOutput = 0.0;
    }

    // Up/Down Compensation
    if (leash.settings.UpDownCompensation !== 0) {
      const Y_Modifier = this.clamp(1.0 - (Y_Combined * leash.settings.UpDownCompensation));
      if (Y_Modifier !== 0.0) {
        VerticalOutput /= Y_Modifier;
        HorizontalOutput /= Y_Modifier;
      }
    }

    // Turning Math
    let TurningSpeed = 0.0;
    if (leash.settings.TurningEnabled && leash.Stretch > leash.settings.TurningDeadzone) {
      TurningSpeed = leash.settings.TurningMultiplier;

      switch (leash.LeashDirection) {
        case "North":
          if (leash.Z_Positive < leash.settings.TurningGoal) {
            TurningSpeed *= HorizontalOutput;
            if (leash.X_Positive > leash.X_Negative) {
              TurningSpeed += leash.Z_Negative; // Right
            } else {
              TurningSpeed -= leash.Z_Negative; // Left
            }
          } else {
            TurningSpeed = 0.0;
          }
          break;
        case "South":
          if (leash.Z_Negative < leash.settings.TurningGoal) {
            TurningSpeed *= -HorizontalOutput;
            if (leash.X_Positive > leash.X_Negative) {
              TurningSpeed -= leash.Z_Positive; // Left
            } else {
              TurningSpeed += leash.Z_Positive; // Right
            }
          } else {
            TurningSpeed = 0.0;
          }
          break;
        case "East":
          if (leash.X_Positive < leash.settings.TurningGoal) {
            TurningSpeed *= VerticalOutput;
            if (leash.Z_Positive > leash.Z_Negative) {
              TurningSpeed += leash.X_Negative; // Right
            } else {
              TurningSpeed -= leash.X_Negative; // Left
            }
          } else {
            TurningSpeed = 0.0;
          }
          break;
        case "West":
          if (leash.X_Negative < leash.settings.TurningGoal) {
            TurningSpeed *= -VerticalOutput;
            if (leash.Z_Positive > leash.Z_Negative) {
              TurningSpeed -= leash.X_Positive; // Left
            } else {
              TurningSpeed += leash.X_Positive; // Right
            }
          } else {
            TurningSpeed = 0.0;
          }
          break;
      }

      TurningSpeed = this.clamp(TurningSpeed);
    }

    // Leash is grabbed
    if (leash.Grabbed) {
      this.updateProgram(true);

      if (leash.settings.Logging) {
        if (leash.wasGrabbed === false) {
          debug.info(`${leash.Name} grabbed`);
          leash.wasGrabbed = true;
        }
      } else {
        debug.info(`${leash.Name} is grabbed`);
      }

      if (leash.Stretch > leash.settings.RunDeadzone) {
        // Running
        this.leashOutput(VerticalOutput, HorizontalOutput, TurningSpeed, 1, leash.settings);
      } else if (leash.Stretch > leash.settings.WalkDeadzone) {
        // Walking
        this.leashOutput(VerticalOutput, HorizontalOutput, TurningSpeed, 0, leash.settings);
      } else {
        // Not stretched enough to move
        this.leashOutput(0.0, 0.0, 0.0, 0, leash.settings);
      }

      await this.delay(leash.settings.ActiveDelay);
      this.leashRun(leash, counter + 1);
    } else if (leash.Grabbed !== leash.wasGrabbed) {
      if (leash.settings.Logging) {
        debug.info(`${leash.Name} dropped`);
      } else {
        debug.info(`${leash.Name} dropped`);
      }

      leash.Active = false;
      leash.resetMovement();

      // Very important stop message - fires twice to ensure VRC receives it
      for (let i = 0; i < 2; i++) {
        await this.delay(leash.settings.ActiveDelay);
        this.leashOutput(0.0, 0.0, 0.0, 0, leash.settings);
      }

      leash.wasGrabbed = false;
      this.resetProgram();
    } else {
      // Only used at the start
      if (!leash.settings.Logging) {
        debug.info('Waiting for Initial Input');
      }

      leash.Active = false;
      this.leashOutput(0.0, 0.0, 0.0, 0, leash.settings);
      this.resetProgram();

      await this.delay(leash.settings.InactiveDelay);
    }
  }

  leashOutput(vert, hori, turn, runType, settings) {
    if (!this.oscService) {
      debug.warn('OSCLeash: OSC service not available');
      return;
    }

    // Send OSC messages to VRChat
    this.oscService.sendMessage('/input/Vertical', vert, 'f');
    this.oscService.sendMessage('/input/Horizontal', hori, 'f');
    
    if (settings.TurningEnabled) {
      this.oscService.sendMessage('/input/LookHorizontal', turn, 'f');
    }
    
    this.oscService.sendMessage('/input/Run', runType, 'i');

    if (!settings.TurningEnabled) {
      debug.info(`  Vert: ${vert.toFixed(2)} | Hori: ${hori.toFixed(2)} | Run: ${runType}`);
    } else {
      debug.info(`  Vert: ${vert.toFixed(2)} | Hori: ${hori.toFixed(2)} | Run: ${runType} | Turn: ${turn.toFixed(2)}`);
    }
  }

  clamp(n) {
    return Math.max(-1.0, Math.min(n, 1.0));
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * OSCLeash Addon - Main container class
 */
class OSCLeashAddon {
  constructor() {
    this.enabled = false;
    this.oscService = null;
    this.config = this.loadConfig();
    this.settings = new OSCLeashConfig(this.config);
    this.leashes = [];
    this.packageController = null;
    this.program = null;
    
    debug.info('OSCLeash addon initialized');
  }

  loadConfig() {
    try {
      const oscLeashConfig = configManager.getOSCLeashConfig();
      if (oscLeashConfig) {
        debug.info('OSCLeash config loaded from config manager');
        return oscLeashConfig;
      }
    } catch (error) {
      debug.logError(`Failed to load OSCLeash config: ${error.message}`);
    }
    return { ...DefaultConfig };
  }

  saveConfig() {
    try {
      const config = this.settings.toJSON();
      configManager.updateOSCLeashConfig(config);
      debug.info('OSCLeash config saved via config manager');
      return true;
    } catch (error) {
      debug.logError(`Failed to save OSCLeash config: ${error.message}`);
      return false;
    }
  }

  isEnabled() {
    return this.enabled;
  }

  start(oscService = null) {
    if (!oscService) {
      debug.logError('Cannot start OSCLeash: No OSC service provided');
      return false;
    }

    if (this.enabled) {
      debug.warn('OSCLeash addon already running');
      return true;
    }

    this.oscService = oscService;
    this.enabled = true;

    try {
      // Create leashes
      this.leashes = [];
      for (const leashName of this.settings.Leashes) {
        const leash = new Leash(leashName, this.settings.DirectionalParameters, this.settings);
        this.leashes.push(leash);
      }

      if (this.leashes.length === 0) {
        throw new Error("No leashes configured. Please update config.");
      }

      // Create program
      this.program = new OSCLeashProgram(this.oscService);

      // Create package controller
      this.packageController = new OSCPackageController(this.leashes, this.oscService);
      this.packageController.onLeashActivate = (leash) => {
        this.program.leashRun(leash);
      };
      this.packageController.listen();

      // Initialize first leash as active
      this.leashes[0].Active = true;

      this.settings.printInfo();
      debug.info('OSCLeash addon started, awaiting input...');
      return true;
    } catch (error) {
      debug.logError(`Failed to start OSCLeash: ${error.message}`);
      this.enabled = false;
      return false;
    }
  }

  stop() {
    if (!this.enabled) {
      return;
    }

    this.enabled = false;

    // Stop all active leashes
    for (const leash of this.leashes) {
      leash.Active = false;
      leash.Grabbed = false;
      leash.resetMovement();
    }

    // Send stop signals
    if (this.program && this.oscService) {
      this.program.leashOutput(0.0, 0.0, 0.0, 0, this.settings);
    }

    // Remove listeners
    if (this.packageController) {
      this.packageController.removeAllListeners();
      this.packageController = null;
    }

    this.program = null;
    this.leashes = [];

    debug.info('OSCLeash addon stopped');
  }

  updateConfig(newConfig) {
    try {
      const wasEnabled = this.enabled;
      
      // Stop if running
      if (wasEnabled) {
        this.stop();
      }

      // Update settings
      this.settings.setSettings(newConfig);
      this.config = this.settings.toJSON();
      this.saveConfig();

      // Restart if it was enabled
      if (wasEnabled && this.oscService) {
        this.start(this.oscService);
      }

      debug.info('OSCLeash config updated');
      return true;
    } catch (error) {
      debug.logError(`Failed to update OSCLeash config: ${error.message}`);
      return false;
    }
  }

  getConfig() {
    return this.settings.toJSON();
  }

  getStatus() {
    const activeLeashes = this.leashes.filter(l => l.Grabbed).map(l => ({
      name: l.Name,
      stretch: l.Stretch,
      grabbed: l.Grabbed
    }));

    return {
      enabled: this.enabled,
      leashCount: this.leashes.length,
      activeLeashes: activeLeashes,
      config: this.settings.toJSON()
    };
  }
}

module.exports = OSCLeashAddon;
