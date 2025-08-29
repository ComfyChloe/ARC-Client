const EventEmitter = require('events');
class ParameterBlacklist extends EventEmitter {
  constructor() {
    super();
    this.blacklistPatterns = [];
  }
  loadBlacklist(patterns = []) {
    this.blacklistPatterns = patterns;
    this.emit('blacklist-updated', this.blacklistPatterns);
  }
  addPattern(pattern) {
    if (!pattern || typeof pattern !== 'string') {
      return false;
    }
    const cleanPattern = pattern.startsWith('/') ? pattern : `/${pattern}`;
    if (!this.blacklistPatterns.includes(cleanPattern)) {
      this.blacklistPatterns.push(cleanPattern);
      this.emit('blacklist-updated', this.blacklistPatterns);
      return true;
    }
    return false;
  }
  removePattern(pattern) {
    const cleanPattern = pattern.startsWith('/') ? pattern : `/${pattern}`;
    const index = this.blacklistPatterns.indexOf(cleanPattern);
    if (index > -1) {
      this.blacklistPatterns.splice(index, 1);
      this.emit('blacklist-updated', this.blacklistPatterns);
      return true;
    }
    return false;
  }
  isBlacklisted(address) {
    if (!address || typeof address !== 'string') {
      return false;
    }
    return this.blacklistPatterns.some(pattern => {
      if (pattern.includes('*')) {
        const regexPattern = pattern
          .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          .replace(/\\\*/g, '.*');
        
        const regex = new RegExp(`^${regexPattern}$`);
        return regex.test(address);
      } else {
        return address === pattern;
      }
    });
  }
  getPatterns() {
    return [...this.blacklistPatterns];
  }
  clear() {
    this.blacklistPatterns = [];
    this.emit('blacklist-updated', this.blacklistPatterns);
  }
}
module.exports = new ParameterBlacklist();
