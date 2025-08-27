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
    // Clean up the pattern - ensure it starts with /
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
      // Handle wildcard patterns
      if (pattern.includes('*')) {
        // Convert wildcard pattern to regex
        const regexPattern = pattern
          .replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // Escape regex special chars
          .replace(/\\\*/g, '.*'); // Convert * to .*
        
        const regex = new RegExp(`^${regexPattern}$`);
        return regex.test(address);
      } else {
        // Exact match
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
