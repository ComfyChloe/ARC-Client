const debug = require('../utils/debugger');
const configManager = require('../utils/configManager');

/**
 * Default configuration for OSCLeash
 */
const DefaultConfig = {
  RunDeadzone: 0.70,
  WalkDeadzone: 0.15,
  StrengthMultiplier: 1.2,
  UpDownCompensation: 1.0,
  UpDownDeadzone: 0.5,
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
      this.RunDeadzone = configJson.RunDeadzone ?? DefaultConfig.RunDeadzone;
      this.WalkDeadzone = configJson.WalkDeadzone ?? DefaultConfig.WalkDeadzone;
      this.StrengthMultiplier = configJson.StrengthMultiplier ?? DefaultConfig.StrengthMultiplier;
      this.UpDownCompensation = configJson.UpDownCompensation ?? DefaultConfig.UpDownCompensation;
      this.UpDownDeadzone = configJson.UpDownDeadzone ?? DefaultConfig.UpDownDeadzone;
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
    debug.info(`  Using OSC-Query for receiving, legacy OSC for sending`);
    debug.info(`  Leash name(s): ${this.Leashes.join(', ')}`);
    debug.info(`  Strength Multiplier: ${this.StrengthMultiplier}`);
    debug.info(`  Delays: ${this.ActiveDelay}ms & ${this.InactiveDelay}ms`);
    debug.info(`  Running Deadzone: ${(this.RunDeadzone * 100).toFixed(0)}% stretch`);
    debug.info(`  Walking Deadzone: ${(this.WalkDeadzone * 100).toFixed(0)}% stretch`);
    debug.info(`  Up/Down Compensation: ${this.UpDownCompensation} & ${(this.UpDownDeadzone * 100).toFixed(0)}% Max Angle`);
  }

  toJSON() {
    return {
      RunDeadzone: this.RunDeadzone,
      WalkDeadzone: this.WalkDeadzone,
      StrengthMultiplier: this.StrengthMultiplier,
      UpDownCompensation: this.UpDownCompensation,
      UpDownDeadzone: this.UpDownDeadzone,
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
    // Booleans for thread logic - ALWAYS start in idle state
    this.Grabbed = false;
    this.wasGrabbed = false;
    this.Posed = false;
    this.Active = false;
    //debug.info(`Leash ${this.Name} initialized - Grabbed: ${this.Grabbed}, Active: ${this.Active}`);
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
  }
}
/**
 * OSC Package Controller - Handles OSC message routing
 */
class OSCPackageController {
  constructor(leashCollection, oscQuery, oscService, addonInstance = null) {
    if (!leashCollection || leashCollection.length === 0) {
      throw new Error("Leash collection empty within Package manager.");
    }
    this.leashes = leashCollection;
    this.oscQuery = oscQuery;
    this.oscService = oscService;
    this.addonInstance = addonInstance;
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
      debug.info(`Registering OSC listener for grab detection: ${grabbedAddress}`);
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
    if (this.oscQuery) {
      // Create a wrapper callback that filters OSC-Query messages by address
      const wrappedCallback = (oscData) => {
        if (oscData.address === address) {
          callback(oscData.value);
        }
      };
      this.oscQuery.on('osc-message', wrappedCallback);
      this.listeners.set(address, wrappedCallback);
    }
  }
  updateGrabbed(currLeash, value) {
    const wasGrabbed = currLeash.Grabbed;
    // Ensure we properly interpret the boolean value from OSC
    const isGrabbed = Boolean(value);
    currLeash.Grabbed = isGrabbed;
    // Track that this leash has been discovered
    if (this.addonInstance && this.addonInstance.discoveredLeashes) {
      this.addonInstance.discoveredLeashes.add(currLeash.Name);
    }
    if (currLeash.Grabbed && !wasGrabbed) {
      // Leash was just grabbed - start monitoring
      // debug.info(`${currLeash.Name} grabbed - starting active monitoring`);
      currLeash.wasGrabbed = true;
      let threadInProgress = false;
      for (const leash of this.leashes) {
        if (leash.Name !== currLeash.Name && leash.Active) {
          threadInProgress = true;
        }
      }
      if (!threadInProgress && this.onLeashActivate) {
        currLeash.Active = true;
        this.onLeashActivate(currLeash);
      }
    } else if (!currLeash.Grabbed && wasGrabbed) {
      // Leash was just released - stop monitoring
      // debug.info(`${currLeash.Name} released - stopping active monitoring`);
      currLeash.wasGrabbed = false;
      
      if (this.onLeashDeactivate) {
        this.onLeashDeactivate(currLeash);
      }
    }
  }
  removeAllListeners() {
    if (this.oscQuery) {
      for (const [address, callback] of this.listeners) {
        this.oscQuery.off('osc-message', callback);
      }
    }
    this.listeners.clear();
  }
}
/**
 * OSC Leash Program - Main processing logic
 */
class OSCLeashProgram {
  constructor(oscQuery, oscService, addonInstance = null) {
    this.oscQuery = oscQuery;
    this.oscService = oscService;
    this.addonInstance = addonInstance;
    this.running = false;
    this.activeIntervals = new Map(); // Track active polling intervals
  }
  resetProgram() {
    this.running = false;
    // Clear all active intervals
    for (const [leashName, intervalId] of this.activeIntervals) {
      clearInterval(intervalId);
      // debug.info(`Stopped monitoring thread for ${leashName}`);
    }
    this.activeIntervals.clear();
  }
  updateProgram(runBool) {
    this.running = runBool;
  }
  // Start active polling when leash is grabbed
  startLeashMonitoring(leash) {
    if (this.activeIntervals.has(leash.Name)) {
      return; // Already monitoring this leash
    }
    // Validate that leash is actually grabbed before starting monitoring
    if (!leash.Grabbed) {
      debug.warn(`Attempted to start monitoring ${leash.Name} but it's not grabbed! Ignoring.`);
      return;
    }
    // debug.info(`Starting active monitoring thread for ${leash.Name} (Grabbed: ${leash.Grabbed})`);
    const intervalId = setInterval(() => {
      this.processLeashMovement(leash);
    }, leash.settings.ActiveDelay);
    this.activeIntervals.set(leash.Name, intervalId);
  }
  // Stop active polling when leash is released
  stopLeashMonitoring(leash) {
    const intervalId = this.activeIntervals.get(leash.Name);
    if (intervalId) {
      clearInterval(intervalId);
      this.activeIntervals.delete(leash.Name);
      // debug.info(`Stopped monitoring thread for ${leash.Name}`);
      // Send stop signals (only if OSC is available)
      try {
        if (this.oscService && this.oscService.isListening) {
          this.leashOutput(0.0, 0.0, 0, leash.settings);
        }
      } catch (error) {
        debug.warn(`OSCLeash: Could not send stop signals: ${error.message}`);
      }
      // Reset leash state
      leash.Active = false;
      leash.resetMovement();
    }
  }
  processLeashMovement(leash) {
    // Only process if leash is grabbed and active
    if (!leash.Grabbed || !leash.Active) {
      debug.info(`Stopping movement processing - Grabbed: ${leash.Grabbed}, Active: ${leash.Active}`);
      this.stopLeashMonitoring(leash);
      return;
    }
    // Check if OSC service is still available and listening
    if (!this.oscService || !this.oscService.isListening) {
      debug.info(`Stopping movement processing - OSC service not available`);
      this.stopLeashMonitoring(leash);
      return;
    }
    // Double-check that we should actually be processing
    if (!leash.Grabbed) {
      debug.warn(`Process called but leash ${leash.Name} is not grabbed! Stopping monitoring.`);
      this.stopLeashMonitoring(leash);
      return;
    }
    if (!leash.settings.Logging) {
      // In browser context, we'd clear console, but in Node we just log status
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

    // Process movement based on stretch
    let runType = 0;
    if (leash.Stretch > leash.settings.RunDeadzone) {
      // Running
      runType = 1;
      this.leashOutput(VerticalOutput, HorizontalOutput, 1, leash.settings);
    } else if (leash.Stretch > leash.settings.WalkDeadzone) {
      // Walking
      runType = 0;
      this.leashOutput(VerticalOutput, HorizontalOutput, 0, leash.settings);
    } else {
      // Not stretched enough to move
      this.leashOutput(0.0, 0.0, 0, leash.settings);
    }

    // Send real-time movement data to frontend
    this.notifyMovementUpdate(leash, VerticalOutput, HorizontalOutput, 0, runType);
  }

  notifyMovementUpdate(leash, vertical, horizontal, run) {
    // Send movement data via callback for real-time display
    if (typeof this.addonInstance?.onMovementUpdate === 'function') {
      this.addonInstance.onMovementUpdate({
        vertical: vertical,
        horizontal: horizontal,
        run: run,
        physboneData: {
          stretch: leash.Stretch,
          grabbed: leash.Grabbed,
          zPos: leash.Z_Positive,
          zNeg: leash.Z_Negative,
          xPos: leash.X_Positive,
          xNeg: leash.X_Negative,
          yPos: leash.Y_Positive,
          yNeg: leash.Y_Negative
        }
      });
    }
  }
  // Legacy method for compatibility - now just starts monitoring
  async leashRun(leash) {
    if (!leash.Active) {
      return;
    }
    // Start monitoring this leash
    this.startLeashMonitoring(leash);
  }
  leashOutput(vert, hori, runType, settings) {
    if (!this.oscService) {
      debug.warn('OSCLeash: OSC service not available');
      return;
    }
    // Check if OSC service is actually running before sending
    if (!this.oscService.isListening) {
      debug.warn('OSCLeash: OSC service not listening - skipping output');
      return;
    }
    // Send OSC messages to VRChat
    try {
      this.oscService.sendMessage('/input/Vertical', vert, 'f');
      this.oscService.sendMessage('/input/Horizontal', hori, 'f');
      this.oscService.sendMessage('/input/Run', runType, 'i');
    } catch (error) {
      debug.error(`OSCLeash: Error sending OSC messages: ${error.message}`);
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
    this.oscQuery = null;
    this.oscService = null;
    this.config = this.loadConfig();
    this.settings = new OSCLeashConfig(this.config);
    this.leashes = [];
    this.discoveredLeashes = new Set(); // Track which leashes have been detected
    this.packageController = null;
    this.program = null;
    this.onStatusChange = null; // Callback for status changes
    this.onMovementUpdate = null; // Callback for movement updates
    
    debug.info('OSCLeash addon initialized');
  }
  /**
   * Set callback for status changes (enabled/disabled)
   * @param {Function} callback - Called with status object
   */
  setStatusChangeCallback(callback) {
    this.onStatusChange = callback;
  }
  /**
   * Set callback for movement updates
   * @param {Function} callback - Called with movement data
   */
  setMovementCallback(callback) {
    this.onMovementUpdate = callback;
  }
  /**
   * Notify listeners of status change
   */
  notifyStatusChange() {
    if (typeof this.onStatusChange === 'function') {
      this.onStatusChange(this.getStatus());
    }
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

  start(oscQuery = null, oscService = null) {
    if (!oscQuery) {
      debug.logError('Cannot start OSCLeash: No OSC-Query service provided');
      return false;
    }
    if (!oscService) {
      debug.logError('Cannot start OSCLeash: No OSC service provided for sending');
      return false;
    }

    if (this.enabled) {
      debug.warn('OSCLeash addon already running');
      return true;
    }

    this.oscQuery = oscQuery;
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
      this.program = new OSCLeashProgram(this.oscQuery, this.oscService, this);

      // Create package controller
      this.packageController = new OSCPackageController(this.leashes, this.oscQuery, this.oscService, this);
      this.packageController.onLeashActivate = (leash) => {
        this.program.leashRun(leash);
      };
      this.packageController.onLeashDeactivate = (leash) => {
        this.program.stopLeashMonitoring(leash);
      };
      this.packageController.listen();

      // Do NOT automatically set leash as active - wait for OSC grab detection
      // this.leashes[0].Active = true; // REMOVED - leashes should only be active when grabbed
      
      debug.info('OSCLeash initialized - all leashes in idle state, waiting for grab detection via OSC-Query...');
      this.settings.printInfo();
      debug.info('OSCLeash addon started, awaiting input...');
      this.notifyStatusChange(); // Notify UI of status change
      return true;
    } catch (error) {
      debug.logError(`Failed to start OSCLeash: ${error.message}`);
      this.enabled = false;
      this.notifyStatusChange(); // Notify UI of failure
      return false;
    }
  }

  stop() {
    if (!this.enabled) {
      return;
    }

    this.enabled = false;

    // Stop all monitoring threads
    if (this.program) {
      this.program.resetProgram();
    }

    // Stop all active leashes
    for (const leash of this.leashes) {
      leash.Active = false;
      leash.Grabbed = false;
      leash.resetMovement();
    }

    // Send stop signals only if OSC is available
    try {
      if (this.program && this.oscService && this.oscService.isListening) {
        this.program.leashOutput(0.0, 0.0, 0, this.settings);
      }
    } catch (error) {
      debug.warn(`OSCLeash: Could not send stop signals during shutdown: ${error.message}`);
    }

    // Remove listeners
    if (this.packageController) {
      this.packageController.removeAllListeners();
      this.packageController = null;
    }

    this.program = null;
    this.leashes = [];
    this.discoveredLeashes.clear(); // Clear discovered leashes when stopping

    debug.info('OSCLeash addon stopped');
    this.notifyStatusChange(); // Notify UI of status change
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
      if (wasEnabled && this.oscQuery && this.oscService) {
        this.start(this.oscQuery, this.oscService);
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
    // Return all discovered leashes, not just grabbed ones
    const discoveredLeashes = this.leashes.filter(l => 
      this.discoveredLeashes.has(l.Name)
    ).map(l => ({
      name: l.Name,
      stretch: l.Stretch,
      grabbed: l.Grabbed,
      // Include all movement data for display
      zPos: l.Z_Positive,
      zNeg: l.Z_Negative,
      xPos: l.X_Positive,
      xNeg: l.X_Negative,
      yPos: l.Y_Positive,
      yNeg: l.Y_Negative
    }));
    // Keep activeLeashes for backward compatibility
    const activeLeashes = this.leashes.filter(l => l.Grabbed).map(l => ({
      name: l.Name,
      stretch: l.Stretch,
      grabbed: l.Grabbed,
      // Include all movement data for display
      zPos: l.Z_Positive,
      zNeg: l.Z_Negative,
      xPos: l.X_Positive,
      xNeg: l.X_Negative,
      yPos: l.Y_Positive,
      yNeg: l.Y_Negative
    }));

    // Calculate current movement output if any leash is active
    let movementData = { vertical: 0, horizontal: 0, run: 0 };
    
    if (activeLeashes.length > 0 && this.program) {
      const activeLeash = this.leashes.find(l => l.Grabbed && l.Active);
      if (activeLeash) {
        // Calculate movement based on current leash state (similar to processLeashMovement)
        const outputMultiplier = activeLeash.Stretch * this.settings.StrengthMultiplier;
        const vertical = this.clamp((activeLeash.Z_Positive - activeLeash.Z_Negative) * outputMultiplier);
        const horizontal = this.clamp((activeLeash.X_Positive - activeLeash.X_Negative) * outputMultiplier);
        
        // Apply up/down deadzone
        const Y_Combined = activeLeash.Y_Positive + activeLeash.Y_Negative;
        if (Y_Combined >= this.settings.UpDownDeadzone) {
          movementData.vertical = 0;
          movementData.horizontal = 0;
        } else {
          movementData.vertical = vertical;
          movementData.horizontal = horizontal;
        }
        
        // Determine run state
        if (activeLeash.Stretch > this.settings.RunDeadzone) {
          movementData.run = 1; // Running
        } else if (activeLeash.Stretch > this.settings.WalkDeadzone) {
          movementData.run = 0; // Walking
        } else {
          movementData.run = 0; // Not moving
        }
      }
    }

    return {
      enabled: this.enabled,
      leashCount: this.leashes.length,
      activeLeashes: activeLeashes,
      discoveredLeashes: discoveredLeashes,
      movementData: movementData,
      config: this.settings.toJSON()
    };
  }

  clamp(n) {
    return Math.max(-1.0, Math.min(n, 1.0));
  }
}

module.exports = OSCLeashAddon;
