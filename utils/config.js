const fs = require('fs');
const path = require('path');
const tui = require('./tui');
const logger = require('./logger');
const dotenv = require('dotenv');

// Load .env file if it exists
dotenv.config();

class ConfigHelper {
  constructor() {
    this.envPath = path.join(__dirname, '..', '.env');
    this.envExamplePath = path.join(__dirname, '..', '.env.example');
  }

  /**
   * Check all required configuration and prompt user for missing values
   */
  async checkConfiguration() {
    await this.checkMailstackKey();
    await this.checkDashboardUrl();
    await this.checkDashboardPassword();
    await this.checkSignupUrl();

    logger.info('Config', 'Configuration check complete');
  }

  /**
   * Check and configure Mailstack API key
   */
  async checkMailstackKey() {
    if (process.env.MAILSTACK_API_KEY) {
      logger.debug('Config', 'MAILSTACK_API_KEY already configured');
      return;
    }

    tui.warning('MAILSTACK_API_KEY not found in environment');
    tui.step('Mailstack API key is required to receive verification codes');
    tui.substep('You can get your API key from https://mailstack.cc/dashboard');

    let apiKey;
    let isValid = false;

    while (!isValid) {
      apiKey = await tui.input({
        type: 'text',
        message: 'Enter your Mailstack API key:',
        validate: v => v && v.length > 0 ? true : 'API key cannot be empty'
      });

      if (!apiKey) {
        tui.error('API key is required. Exiting...');
        process.exit(1);
      }

      // Validate the API key
      const validation = await this.validateMailstackApiKey(apiKey);

      if (validation.valid) {
        isValid = true;
        tui.success(`API key valid (${validation.elapsed}s) - ${validation.inboxCount} inbox(es) available`);
      } else {
        tui.error(`Invalid API key: ${validation.error}`);
        const retry = await tui.confirm('Would you like to try again?');
        if (!retry) {
          tui.error('Exiting...');
          process.exit(1);
        }
      }
    }

    await this.saveToEnv('MAILSTACK_API_KEY', apiKey);
    process.env.MAILSTACK_API_KEY = apiKey;
    tui.success('MAILSTACK_API_KEY saved to .env');
  }

  /**
   * Validate Mailstack API key by making a test request
   */
  async validateMailstackApiKey(apiKey) {
    const animChars = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    let index = 0;
    let animationInterval;
    const message = 'Testing API key...';

    // Start animation on a new line
    const startAnimation = () => {
      process.stdout.write('\n'); // Move to new line first
      animationInterval = setInterval(() => {
        // Use carriage return to go back to start of line, then clear and rewrite
        process.stdout.write(`\r\x1b[K  ${animChars[index]} ${message}`);
        index = (index + 1) % animChars.length;
      }, 100);
    };

    // Stop animation and replace with result
    const stopAnimation = () => {
      if (animationInterval) clearInterval(animationInterval);
      // Clear the animation line
      process.stdout.write(`\r\x1b[K`);
    };

    const axios = require('axios');

    try {
      startAnimation();
      const startTime = Date.now();
      const response = await axios.get('https://api.mailstack.cc/v1/inboxes', {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      });
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

      const inboxes = response.data.inboxes || response.data.accounts || [];
      stopAnimation();
      return { valid: true, inboxCount: inboxes.length, elapsed };
    } catch (error) {
      let errorMsg;
      if (error.response) {
        if (error.response.status === 401) {
          errorMsg = 'Invalid API key (401 Unauthorized)';
        } else if (error.response.status === 403) {
          errorMsg = 'Access denied (403 Forbidden)';
        } else {
          errorMsg = `Server error: ${error.response.status}`;
        }
      } else if (error.request) {
        errorMsg = 'Network error - cannot reach Mailstack API';
      } else {
        errorMsg = error.message;
      }
      stopAnimation();
      return { valid: false, error: errorMsg };
    }
  }

  /**
   * Check and configure Dashboard URL
   */
  async checkDashboardUrl() {
    if (process.env.DASHBOARD_URL) {
      logger.debug('Config', 'DASHBOARD_URL already configured:', process.env.DASHBOARD_URL);
      return;
    }

    tui.warning('DASHBOARD_URL not found in environment');
    tui.step('Dashboard URL is required to connect to your 9router instance');
    tui.substep('Examples: http://localhost:20128, http://192.168.1.100:20128, https://my-router.com');

    let url;
    let isValid = false;

    while (!isValid) {
      url = await tui.input({
        type: 'text',
        message: 'Enter your 9router dashboard URL:',
        initial: 'http://localhost:20128',
        validate: v => {
          if (!v || v.length === 0) return 'URL cannot be empty';
          if (!v.startsWith('http://') && !v.startsWith('https://')) {
            return 'URL must start with http:// or https://';
          }
          return true;
        }
      });

      if (!url) {
        tui.error('Dashboard URL is required. Exiting...');
        process.exit(1);
      }

      // Validate the URL by testing connection
      const validation = await this.validateDashboardUrl(url);

      if (validation.valid) {
        isValid = true;
        tui.success(`Dashboard URL valid (${validation.elapsed}s) - 9router connected`);
      } else {
        tui.error(`Cannot connect: ${validation.error}`);
        const retry = await tui.confirm('Would you like to try again?');
        if (!retry) {
          tui.error('Exiting...');
          process.exit(1);
        }
      }
    }

    await this.saveToEnv('DASHBOARD_URL', url);
    process.env.DASHBOARD_URL = url;
    tui.success('DASHBOARD_URL saved to .env');
  }

  /**
   * Validate Dashboard URL by testing connection
   */
  async validateDashboardUrl(url) {
    const animChars = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    let index = 0;
    let animationInterval;
    const message = 'Testing connection...';

    const startAnimation = () => {
      process.stdout.write('\n');
      animationInterval = setInterval(() => {
        process.stdout.write(`\r\x1b[K  ${animChars[index]} ${message}`);
        index = (index + 1) % animChars.length;
      }, 100);
    };

    const stopAnimation = () => {
      if (animationInterval) clearInterval(animationInterval);
      process.stdout.write(`\r\x1b[K`);
    };

    const axios = require('axios');

    try {
      startAnimation();
      const startTime = Date.now();

      // Try to connect to the dashboard (use /api/health or just the root)
      const response = await axios.get(`${url}/api/health`, {
        timeout: 5000,
        validateStatus: (status) => status < 500 // Accept any non-5xx status
      });

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
      stopAnimation();

      // If we got any response, the dashboard is reachable
      return { valid: true, elapsed };
    } catch (error) {
      let errorMsg;

      if (error.code === 'ECONNREFUSED') {
        errorMsg = 'Connection refused - is 9router running?';
      } else if (error.code === 'ENOTFOUND') {
        errorMsg = 'Host not found - check the URL';
      } else if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
        errorMsg = 'Connection timeout - server not responding';
      } else if (error.response) {
        // Got a response, even if it's an error status - dashboard is reachable
        const elapsed = ((Date.now() - Date.now()) / 1000).toFixed(2);
        stopAnimation();
        return { valid: true, elapsed };
      } else {
        errorMsg = error.message;
      }

      stopAnimation();
      return { valid: false, error: errorMsg };
    }
  }

  /**
   * Check and configure Dashboard password
   */
  async checkDashboardPassword() {
    if (process.env.DASHBOARD_PASSWORD) {
      logger.debug('Config', 'DASHBOARD_PASSWORD already configured');
      return;
    }

    tui.warning('DASHBOARD_PASSWORD not found in environment');
    tui.step('Dashboard password is required to authenticate with your 9router instance');

    let password;
    let isValid = false;

    while (!isValid) {
      password = await tui.input({
        type: 'password',
        message: 'Enter your dashboard password:',
        validate: v => v && v.length > 0 ? true : 'Password cannot be empty'
      });

      if (!password) {
        tui.error('Dashboard password is required. Exiting...');
        process.exit(1);
      }

      // Validate the password by attempting authentication
      const validation = await this.validateDashboardPassword(password);

      if (validation.valid) {
        isValid = true;
        tui.success(`Password correct (${validation.elapsed}s) - authenticated`);
      } else {
        tui.error(`Authentication failed: ${validation.error}`);
        const retry = await tui.confirm('Would you like to try again?');
        if (!retry) {
          tui.error('Exiting...');
          process.exit(1);
        }
      }
    }

    await this.saveToEnv('DASHBOARD_PASSWORD', password);
    process.env.DASHBOARD_PASSWORD = password;
    tui.success('DASHBOARD_PASSWORD saved to .env');
  }

  /**
   * Validate Dashboard password by attempting authentication
   */
  async validateDashboardPassword(password) {
    const animChars = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    let index = 0;
    let animationInterval;
    const message = 'Testing authentication...';

    const startAnimation = () => {
      process.stdout.write('\n');
      animationInterval = setInterval(() => {
        process.stdout.write(`\r\x1b[K  ${animChars[index]} ${message}`);
        index = (index + 1) % animChars.length;
      }, 100);
    };

    const stopAnimation = () => {
      if (animationInterval) clearInterval(animationInterval);
      process.stdout.write(`\r\x1b[K`);
    };

    const axios = require('axios');
    const dashboardUrl = process.env.DASHBOARD_URL;

    if (!dashboardUrl) {
      return { valid: false, error: 'Dashboard URL not configured' };
    }

    try {
      startAnimation();
      const startTime = Date.now();

      // Attempt to authenticate with the dashboard
      // This assumes the dashboard has an authentication endpoint
      const response = await axios.post(`${dashboardUrl}/api/auth/login`, {
        password: password
      }, {
        timeout: 5000,
        validateStatus: (status) => true // Accept any status to check response
      });

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
      stopAnimation();

      // Check if authentication was successful
      if (response.status === 200 || response.status === 201) {
        return { valid: true, elapsed };
      } else if (response.status === 401 || response.status === 403) {
        return { valid: false, error: 'Invalid password' };
      } else {
        return { valid: false, error: `Unexpected response: ${response.status}` };
      }
    } catch (error) {
      let errorMsg;

      if (error.code === 'ECONNREFUSED') {
        errorMsg = 'Connection refused - is 9router running?';
      } else if (error.code === 'ENOTFOUND') {
        errorMsg = 'Host not found - check the URL';
      } else if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
        errorMsg = 'Connection timeout - server not responding';
      } else if (error.response) {
        if (error.response.status === 401 || error.response.status === 403) {
          errorMsg = 'Invalid password';
        } else {
          errorMsg = `Authentication error: ${error.response.status}`;
        }
      } else {
        errorMsg = error.message;
      }

      stopAnimation();
      return { valid: false, error: errorMsg };
    }
  }

  /**
   * Check and clean up KIRO_SIGNUP_URL
   */
  async checkSignupUrl() {
    const signupUrl = process.env.KIRO_SIGNUP_URL;

    // If URL is empty or contains old workflow pattern, clean it up
    if (!signupUrl || signupUrl.includes('workflowStateHandle')) {
      if (signupUrl && signupUrl.includes('workflowStateHandle')) {
        tui.warning('KIRO_SIGNUP_URL contains old workflow pattern');
        tui.substep('Removing workflow state to allow fresh signup');
      } else if (!signupUrl) {
        logger.debug('Config', 'KIRO_SIGNUP_URL not set, will use default');
        return;
      }

      // Clear the old URL from .env
      await this.saveToEnv('KIRO_SIGNUP_URL', '');
      delete process.env.KIRO_SIGNUP_URL;
      tui.success('KIRO_SIGNUP_URL cleaned up - will use default profile URL');
    }
  }

  /**
   * Save a key-value pair to .env file
   */
  async saveToEnv(key, value) {
    let envContent = '';

    // Read existing .env if it exists
    if (fs.existsSync(this.envPath)) {
      envContent = fs.readFileSync(this.envPath, 'utf8');
    } else if (fs.existsSync(this.envExamplePath)) {
      // Copy from example if no .env exists
      envContent = fs.readFileSync(this.envExamplePath, 'utf8');
      logger.debug('Config', 'Created .env from .env.example');
    }

    // Check if key already exists in content
    const keyRegex = new RegExp(`^${key}=.*$`, 'm');
    if (keyRegex.test(envContent)) {
      // Replace existing value
      envContent = envContent.replace(keyRegex, `${key}=${value}`);
    } else {
      // Append new key-value pair
      envContent += `\n${key}=${value}\n`;
    }

    fs.writeFileSync(this.envPath, envContent);
    logger.debug('Config', `Saved ${key} to ${this.envPath}`);
  }
}

module.exports = new ConfigHelper();
