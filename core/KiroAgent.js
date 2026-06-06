const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { faker } = require('@faker-js/faker');
const randomUA = require('random-useragent');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');

// Import modular components
const { HumanInput } = require('../utils/humanInput');
const { SignupFlow } = require('../core/signupFlow');
const { AwsLoginFlow } = require('../core/awsLoginFlow');
const { DashboardFlow } = require('../core/dashboardFlow');
const { BrowserState } = require('../utils/browserState');

dotenv.config();
puppeteer.use(StealthPlugin());

const FIRST_NAMES = [
  'alex', 'amelia', 'ava', 'ben', 'chris', 'clara', 'daniel', 'diana',
  'emma', 'ethan', 'eva', 'felix', 'hannah', 'isla', 'jason', 'julia',
  'karen', 'leo', 'lily', 'lucas', 'mia', 'nina', 'oliver', 'paula',
  'ryan', 'sara', 'sebastian', 'sophia', 'thomas', 'zoe'
];

const LAST_NAMES = [
  'anderson', 'bennett', 'carter', 'collins', 'davis', 'edwards', 'fisher',
  'garcia', 'harris', 'jackson', 'king', 'lewis', 'martin', 'miller',
  'nelson', 'owens', 'parker', 'quinn', 'roberts', 'scott', 'taylor',
  'turner', 'walker', 'watson', 'white', 'wilson', 'young'
];

function pickRandom(items) {
  const crypto = require('crypto');
  return items[crypto.randomInt(0, items.length)];
}

class KiroAgent {
  constructor(config = {}) {
    this.signupUrl = config.url || process.env.KIRO_SIGNUP_URL || 'https://profile.aws.amazon.com';
    this.mailstackKey = config.mailstackApiKey || process.env.MAILSTACK_API_KEY;
    this.viewport = {
      width: config.viewportWidth || parseInt(process.env.VIEWPORT_WIDTH) || 870,
      height: config.viewportHeight || parseInt(process.env.VIEWPORT_HEIGHT) || 706
    };
    this.headless = config.headless ?? (process.env.HEADLESS === 'true');
    this.debug = config.debug ?? (process.env.DEBUG === 'true');

    if (!this.mailstackKey) {
      throw new Error('MAILSTACK_API_KEY required — set in .env');
    }

    this.dashboardUrl = config.dashboardUrl || process.env.DASHBOARD_URL || 'http://localhost:20128';
    this.dashboardPassword = config.dashboardPassword || process.env.DASHBOARD_PASSWORD || '123456';

    const MailstackClient = require('../services/MailstackClient');
    this.mailstack = new MailstackClient(this.mailstackKey);
    this.settings = require('../utils/settings');
    const utilities = this.settings.getUtilities();
    this.headless = config.headless ?? utilities.headless ?? (process.env.HEADLESS === 'true');
    this.identity = null;
    this.browser = null;
    this.page = null;
    this.lastMousePosition = null;
    this.email = null;
    this.password = null;
    this.humanInput = null;
  }

  generateIdentity() {
    const firstName = pickRandom(FIRST_NAMES);
    const lastName = pickRandom(LAST_NAMES);
    const fullName = `${firstName.charAt(0).toUpperCase() + firstName.slice(1)} ${lastName.charAt(0).toUpperCase() + lastName.slice(1)}`;
    const username = `${firstName}.${lastName}`;
    const suffix = require('crypto').randomInt(100, 9999);

    return {
      firstName,
      lastName,
      fullName,
      username: `${username}${suffix}`,
      password: this.generatePassword(),
      userAgent: randomUA.getRandom()
    };
  }

  generatePassword() {
    const uppercase = faker.string.alpha({ length: 2, casing: 'upper' });
    const lowercase = faker.string.alpha({ length: 3, casing: 'lower' });
    const numbers = faker.string.numeric(2);
    const specials = '!@#$%^&*';
    const specialChars = Array.from({ length: 2 }, () =>
      specials.charAt(Math.floor(Math.random() * specials.length))
    ).join('');

    let password = uppercase + lowercase + numbers + specialChars;
    const crypto = require('crypto');
    const shuffled = password.split('').sort(() => {
      const rand = crypto.randomInt(0, 1);
      return rand === 0 ? -1 : 1;
    });

    return shuffled.join('');
  }

  async setupBrowser() {
    console.log('[INFO] Launching browser (puppeteer-extra)...');

    if (!this.identity) {
      this.identity = this.generateIdentity();
      this.password = this.identity.password;
    }

    this.browser = await puppeteer.launch({
      headless: this.headless,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled'
      ]
    });

    this.page = await this.browser.newPage();
    await this.page.setViewport(this.viewport);
    await this.page.setUserAgent(this.identity.userAgent);

    // Initialize HumanInput
    this.humanInput = new HumanInput(this.page, this);

    await this.humanInput.setupVisualMouseTracking();
    console.log(`[INFO] Browser ready — UA: ${this.identity.userAgent.slice(0, 60)}...`);
  }

  async fillPasswordBulletproof(element, passwordText, label, maxRetries = 5) {
    for (let r = 0; r < maxRetries; r++) {
      console.log(`   Attempt ${r + 1}/${maxRetries} - Filling ${label} password...`);
      try {
        await this.page.evaluate((el) => {
          el.focus();
          el.select();
        }, element);
        await this.humanInput.randomPause(200, 400);

        for (let i = 0; i < passwordText.length; i++) {
          await this.page.keyboard.type(passwordText[i]);
          await this.humanInput.randomPause(80, 200);
        }
        await this.humanInput.randomPause(300, 600);

        const value = await this.page.evaluate((el) => el.value, element);
        if (value === passwordText) {
          console.log(`   ✓ ${label} password verified! Length: ${value.length}`);
          return true;
        }

        console.log(`   ⚠️  ${label} mismatch, clearing and retrying...`);
        await this.page.evaluate((el) => {
          el.value = '';
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }, element);
        await this.humanInput.randomPause(200, 400);
      } catch (e) {
        console.log(`   ⚠️  Fill method failed: ${e.message}, retrying...`);
      }
      await new Promise(r => setTimeout(r, 500));
    }
    return false;
  }

  async captureBrowserState() {
    const browserState = new BrowserState(this);
    return browserState.captureBrowserState();
  }

  async saveBrowserState() {
    const browserState = new BrowserState(this);
    return browserState.saveBrowserState();
  }

  async getDeviceCode() {
    const axios = require('axios');

    // Login to dashboard
    const loginResponse = await axios.post(`${this.dashboardUrl}/api/auth/login`, {
      password: this.dashboardPassword
    }, { headers: { 'Content-Type': 'application/json' } });

    if (!loginResponse.data.success) {
      throw new Error('Dashboard login failed');
    }

    const setCookies = loginResponse.headers['set-cookie'];
    const cookieHeader = setCookies ? setCookies.join('; ') : '';

    // Get device code
    const deviceCodeResponse = await axios.get(`${this.dashboardUrl}/api/oauth/kiro/device-code`, {
      headers: { 'Cookie': cookieHeader }
    });

    const dd = deviceCodeResponse.data;
    if (!dd.verification_uri_complete) {
      throw new Error('Failed to get device code from dashboard');
    }

    return {
      deviceCode: dd.device_code,
      userCode: dd.user_code,
      verificationUri: dd.verification_uri_complete,
      cookieHeader: cookieHeader,
      deviceCodeData: dd
    };
  }

  async pollForOAuthToken(deviceCodeOrData, cookieHeader) {
    const axios = require('axios');
    const maxAttempts = 2400;
    const interval = 500;

    if (!cookieHeader) {
      throw new Error('Dashboard auth cookie missing; cannot poll OAuth status');
    }

    const dd = typeof deviceCodeOrData === 'string'
      ? { device_code: deviceCodeOrData }
      : deviceCodeOrData;

    if (!dd?.device_code) {
      throw new Error('Device code missing; cannot poll OAuth status');
    }

    const pollPayload = {
      deviceCode: dd.device_code,
      codeVerifier: dd.codeVerifier,
      extraData: {
        _clientId: dd._clientId,
        _clientSecret: dd._clientSecret,
        _region: dd._region,
        _authMethod: dd._authMethod,
        _startUrl: dd._startUrl
      }
    };

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const pollResponse = await axios.post(`${this.dashboardUrl}/api/oauth/kiro/poll`, pollPayload, {
          headers: {
            'Content-Type': 'application/json',
            'Cookie': cookieHeader
          },
          timeout: 10000
        });

        if (pollResponse.data.token || pollResponse.data.access_token) {
          return pollResponse.data.token || pollResponse.data.access_token;
        }

        if (pollResponse.data.pending || pollResponse.data.error === 'authorization_pending') {
          if (this.debug && attempt % 40 === 0) {
            console.log(`   🔄 OAuth polling attempt ${attempt + 1}... (pending)`);
          }
          await new Promise(r => setTimeout(r, interval));
          continue;
        }

        if (pollResponse.data.error === 'slow_down') {
          await new Promise(r => setTimeout(r, interval * 2));
          continue;
        }

        if (pollResponse.data.error === 'invalid_grant' &&
            pollResponse.data.errorDescription?.toLowerCase().includes('already redeemed')) {
          return null;
        }

        if (pollResponse.data.error) {
          if (this.debug) {
            console.log(`   ⚠️  OAuth poll warning: ${pollResponse.data.error}`);
          }
        }
      } catch (error) {
        const errorData = error.response?.data;
        if (errorData?.pending || errorData?.error === 'authorization_pending') {
          await new Promise(r => setTimeout(r, interval));
          continue;
        }
        if (errorData?.error === 'invalid_grant' &&
            errorData.errorDescription?.toLowerCase().includes('already redeemed')) {
          return null;
        }
        if (this.debug && attempt % 40 === 0) {
          console.log(`   ⚠️  OAuth poll attempt ${attempt + 1} failed: ${error.message}`);
        }
      }

      await new Promise(r => setTimeout(r, interval));
    }

    throw new Error('OAuth polling timed out after 20 minutes');
  }

  async run(options = {}) {
    this.identity = this.generateIdentity();
    this.password = this.identity.password;

    console.log('🔍 Selecting clean Mailstack inbox from settings...');
    const cleanInbox = options.inbox || await this.settings.selectCleanInbox({
      excludeEmails: options.excludeEmails || []
    });
    this.email = cleanInbox.email;

    await this.setupBrowser();

    const signupFlow = new SignupFlow(this);
    const result = await signupFlow.run();

    await this.cleanup();
    return result;
  }

  async performAwsLogin(awsEmail, awsPassword, mfaCode) {
    if (!this.browser) await this.setupBrowser();
    const awsLoginFlow = new AwsLoginFlow(this);
    const result = await awsLoginFlow.performAwsLogin(awsEmail, awsPassword, mfaCode);
    return result;
  }

  async registerWithDashboard() {
    const dashboardFlow = new DashboardFlow(this);
    return dashboardFlow.registerWithDashboard();
  }

  async runDashboardOnly(credentialsList) {
    const dashboardFlow = new DashboardFlow(this);
    return dashboardFlow.runDashboardOnly(credentialsList);
  }

  async cleanup() {
    if (this.browser) {
      try { await this.browser.close(); } catch {}
      this.browser = null;
      this.page = null;
    }
  }
}

module.exports = { KiroAgent };
