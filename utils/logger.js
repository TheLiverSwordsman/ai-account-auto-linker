const fs = require('fs');
const path = require('path');

class Logger {
  constructor() {
    this.logFile = null;
    this.enabled = true;
    this.startTime = Date.now();
    this.logLevel = 'normal'; // 'normal', 'verbose', 'debug'
  }

  setLogLevel(level) {
    this.logLevel = level;
  }

  init(logFile = null) {
    if (!logFile) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      logFile = path.join(__dirname, '..', '.cache', `debug_${timestamp}.log`);
    }

    this.logFile = logFile;

    // Ensure cache directory exists
    const cacheDir = path.dirname(logFile);
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    // Write header
    const header = `\n${'='.repeat(80)}\nDEBUG LOG STARTED: ${new Date().toISOString()}\n${'='.repeat(80)}\n\n`;
    fs.writeFileSync(logFile, header);

    this.info('Logger', `Debug logging initialized: ${logFile}`);
  }

  _getTimestamp() {
    const now = new Date();
    const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(3);
    return `${now.toISOString()} [+${elapsed}s]`;
  }

  _write(level, component, message, data = null) {
    if (!this.enabled || !this.logFile) return;

    const timestamp = this._getTimestamp();
    let logLine = `[${timestamp}] [${level}] [${component}] ${message}\n`;

    if (data) {
      try {
        const dataStr = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
        logLine += `  DATA: ${dataStr}\n`;
      } catch (e) {
        logLine += `  DATA: [Error serializing: ${e.message}]\n`;
      }
    }

    try {
      fs.appendFileSync(this.logFile, logLine);
    } catch (e) {
      console.error(`[Logger] Failed to write to log file: ${e.message}`);
    }
  }

  info(component, message, data = null) {
    this._write('INFO', component, message, data);
    if (this.logLevel !== 'normal') {
      console.log(`[${component}] ${message}`);
    }
  }

  success(component, message, data = null) {
    this._write('SUCCESS', component, message, data);
    console.log(`✅ ${message}`);
  }

  warn(component, message, data = null) {
    this._write('WARN', component, message, data);
    console.warn(`⚠️  ${message}`);
  }

  error(component, message, data = null) {
    this._write('ERROR', component, message, data);
    console.error(`❌ ${message}`);
  }

  debug(component, message, data = null) {
    this._write('DEBUG', component, message, data);
    if (this.logLevel === 'debug') {
      console.log(`[DEBUG] [${component}] ${message}`);
    }
  }

  // Special methods for specific events
  apiCall(component, method, url, body = null, response = null) {
    this._write('API', component, `${method} ${url}`, { body, response });
    if (this.logLevel !== 'normal') {
      console.log(`[API] ${method} ${url}`);
    }
  }

  browserAction(component, action, details = null) {
    this._write('BROWSER', component, action, details);
    if (this.logLevel === 'debug') {
      console.log(`[BROWSER] ${action}`);
    }
  }

  stateChange(component, from, to, details = null) {
    this._write('STATE', component, `${from} → ${to}`, details);
    if (this.logLevel !== 'normal') {
      console.log(`[${component}] ${from} → ${to}`);
    }
  }
}

// Singleton instance
const logger = new Logger();

module.exports = logger;
