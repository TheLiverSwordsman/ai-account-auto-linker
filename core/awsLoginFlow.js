const path = require('path');
const axios = require('axios');
const logger = require('../utils/logger');
const tui = require('../utils/tui');

class AwsLoginFlow {
  constructor(agent) { this.agent = agent; }
  get page() { return this.agent.page; }
  get input() { return this.agent.humanInput; }
  get mailstack() { return this.agent.mailstack; }

  async performAwsLogin(awsEmail, awsPassword, mfaCode) {
    logger.info('AWSLogin', 'Starting AWS Account Login Flow', { email: awsEmail, mfaProvided: !!mfaCode });

    console.log('');
    tui.printBox('AWS Account Login Flow', { width: 44, align: 'center' });
    console.log('');
    console.log(`  Email: ${awsEmail}`);
    console.log(`  MFA:   ${mfaCode ? 'Provided' : 'Will poll Mailstack'}\n`);

    let backgroundPollPromise = null;

    try {
      // Step 1: Get AWS signin URL from dashboard
      logger.stateChange('AWSLogin', 'Init', 'Dashboard Login');
      console.log('[LOGIN 1/7] Getting AWS signin URL from dashboard...');

      logger.apiCall('AWSLogin', 'POST', `${this.agent.dashboardUrl}/api/auth/login`, { password: '***' });
      const loginResponse = await axios.post(`${this.agent.dashboardUrl}/api/auth/login`, {
        password: this.agent.dashboardPassword
      }, { headers: { 'Content-Type': 'application/json' } });

      logger.apiCall('AWSLogin', 'POST', '/api/auth/login', null, { success: loginResponse.data.success });

      if (!loginResponse.data.success) throw new Error('Dashboard login failed');

      const setCookies = loginResponse.headers['set-cookie'];
      const cookieHeader = setCookies ? setCookies.join('; ') : '';
      logger.debug('AWSLogin', 'Dashboard cookies received', { hasCookies: !!setCookies, count: setCookies?.length || 0 });

      logger.apiCall('AWSLogin', 'GET', `${this.agent.dashboardUrl}/api/oauth/kiro/device-code`);
      const deviceCodeResponse = await axios.get(`${this.agent.dashboardUrl}/api/oauth/kiro/device-code`, {
        headers: { 'Cookie': cookieHeader }
      });

      const dd = deviceCodeResponse.data;
      logger.apiCall('AWSLogin', 'GET', '/api/oauth/kiro/device-code', null, dd);

      if (!dd.verification_uri_complete) throw new Error('Failed to get AWS signin URL from dashboard');

      console.log(`   ✓ Got signin URL: ${dd.verification_uri_complete.substring(0, 80)}...`);
      logger.success('AWSLogin', 'Got device code', { deviceCode: dd.device_code?.substring(0, 20) + '...', userCode: dd.user_code });

      // START BACKGROUND POLLING IMMEDIATELY (matches browser behavior)
      console.log('   🔄 Starting background token polling...');
      logger.info('AWSLogin', 'Starting background token polling (20 min timeout)');

      // Start the poller and add immediate diagnostic logging
      backgroundPollPromise = this._backgroundPollForToken(dd, cookieHeader);

      // Add diagnostic logging to confirm poller is running
      backgroundPollPromise.then(
        token => logger.success('AWSLogin', 'Background poller resolved with token'),
        error => logger.error('AWSLogin', 'Background poller rejected', { error: error.message, stack: error.stack })
      );

      logger.info('AWSLogin', 'Background poller promise created and attached');

      // Step 2: Navigate to signin page
      logger.stateChange('AWSLogin', 'Dashboard Login', 'AWS Signin Page');
      console.log('[LOGIN 2/7] Opening AWS signin page...');
      logger.browserAction('AWSLogin', 'Navigating to AWS signin page', { url: dd.verification_uri_complete });
      await this.page.goto(dd.verification_uri_complete, { waitUntil: 'domcontentloaded', timeout: 60000 });
      logger.browserAction('AWSLogin', 'Page loaded');
      await this.input.randomPause(3000, 5000);
      await this._dismissCookieBanner();
      await this.input.randomPause(1000, 2000);

      // Step 3: Enter email
      logger.stateChange('AWSLogin', 'AWS Signin Page', 'Enter Email');
      console.log('[LOGIN 3/7] Entering email...');
      logger.info('AWSLogin', 'Looking for email input field');
      const emailSelector = await this._findInputField([
        'input[id*="formField14"]',
        'input[type="email"]',
        'input[name*="email"]',
        'input[id*="email"]',
        'input[placeholder*="email" i]'
      ], 'email');
      logger.success('AWSLogin', 'Found email input', { selector: emailSelector });

      await this.input.humanClick(emailSelector);
      await this.input.randomPause(400, 800);
      logger.debug('AWSLogin', 'Typing email', { email: awsEmail });
      await this.input.humanType(emailSelector, awsEmail);
      logger.success('AWSLogin', 'Email entered');
      await this.input.randomPause(600, 1000);

      // Click Continue (email → password)
      logger.stateChange('AWSLogin', 'Enter Email', 'Click Continue');
      console.log('[LOGIN 4/7] Clicking Continue after email...');
      logger.info('AWSLogin', 'Looking for Continue button (email → password)');
      await this._clickContinueButton('email → password');
      logger.success('AWSLogin', 'Clicked Continue (email → password)');
      await this.input.randomPause(3000, 5000);

      // Step 5: Enter password
      logger.stateChange('AWSLogin', 'Click Continue', 'Enter Password');
      console.log('[LOGIN 5/7] Entering password...');
      logger.info('AWSLogin', 'Looking for password input field');
      const passwordSelector = await this._findInputField([
        'input[id*="formField37"]',
        'input[type="password"]',
        'input[name*="password"]',
        'input[id*="password"]',
        'input[placeholder*="password" i]'
      ], 'password');
      logger.success('AWSLogin', 'Found password input', { selector: passwordSelector });

      await this.input.humanClick(passwordSelector);
      await this.input.randomPause(400, 800);
      logger.debug('AWSLogin', 'Typing password');
      await this.input.humanType(passwordSelector, awsPassword);
      logger.success('AWSLogin', 'Password entered');
      await this.input.randomPause(600, 1000);

      // Try clicking "Show password" if present
      try {
        const showPasswordLabel = await this.page.$('span[id*="-label"]');
        if (showPasswordLabel) {
          console.log('   ✓ Clicking "Show password" checkbox...');
          logger.info('AWSLogin', 'Clicking "Show password" checkbox');
          await showPasswordLabel.click();
          await new Promise(r => setTimeout(r, 600));
        }
      } catch (e) {
        logger.debug('AWSLogin', 'Show password checkbox not found');
      }

      // Click Continue (password → MFA)
      logger.stateChange('AWSLogin', 'Enter Password', 'Click Continue');
      console.log('[LOGIN 6/7] Clicking Continue after password...');
      logger.info('AWSLogin', 'Looking for Continue button (password → MFA)');
      await this._clickContinueButton('password → MFA');
      logger.success('AWSLogin', 'Clicked Continue (password → MFA)');
      await this.input.randomPause(3000, 5000);

      // Step 6: Enter MFA code
      logger.stateChange('AWSLogin', 'Click Continue', 'Enter MFA');
      console.log('[LOGIN 7/7] Entering MFA code...');
      logger.info('AWSLogin', 'Looking for MFA input field');
      const mfaSelector = await this._findInputField([
        'input[id*="formField55"]',
        'input[name*="mfa"]',
        'input[id*="mfa"]',
        'input[name*="code"]',
        'input[id*="code"]',
        'input[placeholder*="code" i]',
        'input[placeholder*="mfa" i]',
        'input[placeholder*="verification" i]'
      ], 'MFA');
      logger.success('AWSLogin', 'Found MFA input', { selector: mfaSelector });

      // Get MFA code — either provided or auto-poll from Mailstack
      let finalMfaCode = mfaCode;
      if (!finalMfaCode) {
        console.log('   📬 Polling Mailstack for MFA code...');
        logger.info('AWSLogin', 'Polling Mailstack for MFA code', { email: awsEmail, timeout: 120000 });
        finalMfaCode = await this.mailstack.waitForMfaCode(awsEmail, 120000, 3000);
        logger.success('AWSLogin', 'MFA code received from Mailstack', { code: finalMfaCode });
      } else {
        logger.info('AWSLogin', 'Using provided MFA code', { code: finalMfaCode });
      }

      console.log(`   ✓ MFA code: ${finalMfaCode}`);
      await this.input.humanClick(mfaSelector);
      await this.input.randomPause(400, 800);
      logger.debug('AWSLogin', 'Typing MFA code');
      await this.input.humanType(mfaSelector, finalMfaCode);
      logger.success('AWSLogin', 'MFA code entered');
      await this.input.randomPause(600, 1000);

      // Click Continue (MFA → next page)
      logger.stateChange('AWSLogin', 'Enter MFA', 'Click Continue');
      console.log('   Clicking Continue (MFA → next page)...');
      logger.info('AWSLogin', 'Looking for Continue button (MFA → next page)');
      await this._clickContinueButton('MFA → next page');
      logger.success('AWSLogin', 'Clicked Continue (MFA → next page)');
      await this.input.randomPause(4000, 7000);

      // Detect what page we landed on and auto-handle it
      logger.stateChange('AWSLogin', 'Click Continue', 'Post-Login Handling');
      console.log('   🔍 Detecting current page...');
      await this._detectAndHandlePostLoginPage(dd);

      console.log('   💾 Saving browser state...');
      logger.info('AWSLogin', 'Saving browser state');
      await this.agent.saveBrowserState();
      logger.success('AWSLogin', 'Browser state saved');

      // Wait for background polling to finish (dashboard handles token server-side)
      console.log('   ⏳ Waiting for OAuth flow to complete...');
      logger.info('AWSLogin', 'Waiting for OAuth completion');
      await backgroundPollPromise;

      console.log('');
      tui.printBox('✓ AWS Login Complete!', { width: 44, align: 'center' });
      console.log('');
      console.log(`  📧 Email: ${awsEmail}`);
      console.log(`  ✅ Account registered on dashboard\n`);

      logger.success('AWSLogin', 'AWS login completed successfully', { email: awsEmail, deviceCode: dd.device_code?.substring(0, 20) + '...' });
      return { success: true, deviceCode: dd.device_code };

    } catch (error) {
      console.error(`\n[ERROR] AWS Login failed: ${error.message}`);
      logger.error('AWSLogin', 'AWS login failed', { email: awsEmail, error: error.message, stack: error.stack });

      if (process.env.SCREENSHOT_ON_ERROR !== 'false') {
        try {
          const screenshotPath = path.join(__dirname, '..', '.cache', `login_error_${Date.now()}.png`);
          await this.page.screenshot({ path: screenshotPath, fullPage: true });
          console.log(`[DEBUG] Screenshot saved: ${screenshotPath}`);
          logger.debug('AWSLogin', 'Error screenshot saved', { path: screenshotPath });
        } catch (e) {}
      }

      throw error;
    }
  }

  async _backgroundPollForToken(dd, cookieHeader) {
    const interval = 500;
    const maxAttempts = 2400; // 20 minutes at 500ms (matches your HAR: 471 polls over 17 min)
    let attempt = 0;

    logger.info('AWSLogin', 'Background polling loop started', { maxAttempts, interval, deviceCode: dd.device_code?.substring(0, 20), userCode: dd.user_code });
    console.log('   🔄 Background poller initialized');

    // Match the EXACT browser payload structure from HAR
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

    logger.debug('AWSLogin', 'Poll payload constructed', {
      hasDeviceCode: !!pollPayload.deviceCode,
      hasCodeVerifier: !!pollPayload.codeVerifier,
      hasExtraData: !!pollPayload.extraData,
      extraDataKeys: pollPayload.extraData ? Object.keys(pollPayload.extraData) : null
    });

    while (attempt < maxAttempts) {
      try {
        logger.debug('AWSLogin', `Starting poll attempt ${attempt + 1}`, {
          payload_summary: {
            deviceCode: pollPayload.deviceCode?.substring(0, 20) || 'MISSING',
            codeVerifier: pollPayload.codeVerifier?.substring(0, 20) || 'MISSING'
          }
        });

        const pollResponse = await axios.post(
          `${this.agent.dashboardUrl}/api/oauth/kiro/poll`,
          pollPayload,
          {
            headers: { 'Content-Type': 'application/json', 'Cookie': cookieHeader },
            timeout: 10000 // 10s timeout per request
          }
        );

        logger.debug('AWSLogin', `Poll attempt ${attempt + 1} completed`, {
          status: pollResponse.status,
          hasToken: !!pollResponse.data.token,
          responseData: pollResponse.data
        });

        if (pollResponse.data.token) {
          console.log('   ✅ Background polling: Token received!');
          logger.success('AWSLogin', 'Background polling got token', { attempt: attempt + 1 });
          return pollResponse.data.token;
        }

        // Handle pending responses (this is normal!)
        if (pollResponse.data.pending || pollResponse.data.error === 'authorization_pending') {
          // Only log milestones at higher verbosity levels or specific intervals
          const showMilestone = logger.logLevel !== 'normal' && attempt % 40 === 0;

          if (showMilestone) {
            console.log(`   🔄 Background polling attempt ${attempt + 1}... (pending)`);
            logger.info('AWSLogin', `Background polling milestone`, {
              attempt: attempt + 1,
              status: 'pending',
              elapsed: `${(attempt * interval / 1000).toFixed(1)}s`
            });
          } else if (logger.logLevel === 'debug' && attempt % 100 === 0) {
            // For debug mode, show less frequent updates
            logger.debug('AWSLogin', `Poll attempt ${attempt + 1}`, { status: 'pending' });
          }
        }
        // Handle "already redeemed" - OAuth flow completed, stop polling
        else if (pollResponse.data.error === 'invalid_grant' &&
                 pollResponse.data.errorDescription?.toLowerCase().includes('already redeemed')) {
          console.log(`   ✅ Device code already redeemed (attempt ${attempt + 1})`);
          logger.info('AWSLogin', 'Device code already redeemed - OAuth flow completed', {
            attempt: attempt + 1,
            elapsed: `${(attempt * interval / 1000).toFixed(1)}s`
          });
          // Return null to indicate we should check for token in main flow
          return null;
        }
        else if (pollResponse.data.error && !pollResponse.data.pending) {
          // Actual error - not just pending
          logger.warn('AWSLogin', `Poll returned unexpected error`, {
            attempt: attempt + 1,
            error: pollResponse.data.error,
            errorDescription: pollResponse.data.errorDescription
          });
        }
      } catch (error) {
        logger.error('AWSLogin', `Background poll attempt ${attempt + 1} failed`, {
          error: error.message,
          code: error.code,
          status: error.response?.status,
          data: error.response?.data,
          isTimeout: error.code === 'ECONNABORTED'
        });

        if (attempt % 40 === 0) {
          console.log(`   ⚠️  Background poll attempt ${attempt + 1} failed: ${error.message}`);
        }
      }

      attempt++;
      await new Promise(r => setTimeout(r, interval));
    }

    logger.error('AWSLogin', 'Background polling timed out', { attempts: attempt, total: `${(attempt * interval / 1000).toFixed(1)}s` });
    throw new Error('Background token polling timed out after 20 minutes');
  }

  async pollForDashboardToken(dd, cookieHeader) {
    console.log('   ⏳ Polling dashboard for token...');
    const maxAttempts = 60, interval = 500;

    // Match the EXACT browser payload structure from HAR
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
        const pollResponse = await axios.post(
          `${this.agent.dashboardUrl}/api/oauth/kiro/poll`,
          pollPayload,
          { headers: { 'Content-Type': 'application/json', 'Cookie': cookieHeader } }
        );
        if (pollResponse.data.token) {
          console.log('   ✅ Token received!');
          return pollResponse.data.token;
        }
        if (attempt % 5 === 0) console.log(`   ⏱️  Attempt ${attempt + 1}/${maxAttempts}...`);
      } catch (error) {
        if (attempt === maxAttempts - 1) throw new Error('Token polling timed out');
      }
      await new Promise(r => setTimeout(r, interval));
    }
    throw new Error('Failed to obtain token');
  }

  // ─── Shared Page Helpers ────────────────────────────────────────

  async _findInputField(selectors, label) {
    for (const selector of selectors) {
      try {
        const el = await this.page.$(selector);
        if (el) {
          console.log(`   ✓ Found ${label} input: ${selector}`);
          return await this.page.evaluate(el => {
            if (el.id) return `#${el.id}`;
            if (el.name) return `input[name="${el.name}"]`;
            return el.tagName.toLowerCase() + `[type="${el.type || 'text'}"]`;
          }, el);
        }
      } catch (e) {}
    }
    throw new Error(`Could not find ${label} input field`);
  }

  /**
   * Find and click a button by text content (robust approach)
   */
  async _clickButtonByText(searchText, displayName) {
    console.log(`   Looking for "${displayName}" button...`);

    const buttonInfo = await this.page.evaluate((searchText) => {
      const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
      for (const btn of buttons) {
        const text = (btn.innerText || btn.textContent || '').trim();
        if (text.toLowerCase().includes(searchText)) {
          const rect = btn.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            return {
              x: rect.left + rect.width / 2,
              y: rect.top + rect.height / 2,
              text
            };
          }
        }
      }
      return null;
    }, searchText.toLowerCase());

    if (buttonInfo) {
      console.log(`   🖱️  Found "${buttonInfo.text}", clicking...`);
      await this.input.humanClickPoint(buttonInfo.x, buttonInfo.y);
      return true;
    }

    console.log(`   ⚠️  Could not find "${displayName}" by text`);
    return false;
  }

  /**
   * After MFA → completion, detect what page we landed on and handle it automatically
   * Common scenarios:
   * 1. Device authorization page ("Confirm and Continue" → "Allow Access")
   * 2. Already logged in / dashboard URL
   */
  async _detectAndHandlePostLoginPage(dd, cookieHeader) {
    console.log('   🔍 Detecting current page...');

    const pageTitle = await this.page.evaluate(() => document.title).catch(() => '');
    const pageText = await this.page.evaluate(() => document.body.innerText).catch(() => '');
    const pageUrl = this.page.url();

    console.log(`   Page title: ${pageTitle}`);
    console.log(`   Page URL: ${pageUrl.substring(0, 60)}...`);

    // Check for "Confirm and Continue" button (device authorization)
    const hasConfirmButton = await this.page.$('#cli_verification_btn').catch(() => null);

    if (hasConfirmButton) {
      console.log('   🚦 Detected: Device authorization page (Confirm and Continue)');

      // Dismiss cookie banner first — it often blocks clicks on this page
      await this._dismissCookieBanner();
      await new Promise(r => setTimeout(r, 500));

      // Click Confirm and Continue
      console.log('   ⏳ Waiting for "Confirm and Continue"...');
      await this.input.humanClick('#cli_verification_btn');
      await this.input.randomPause(2500, 4000);

      // Dismiss cookie banner again (new page may show it)
      await this._dismissCookieBanner();
      await new Promise(r => setTimeout(r, 500));

      // Wait for Allow Access button and click it
      console.log('   ⏳ Waiting for "Allow Access" button...');
      await new Promise(r => setTimeout(r, 2000)); // Give UI time to render

      console.log('   🔓 Looking for "Allow Access" button...');
      const allowClicked = await this._clickButtonByText('allow access', 'Allow Access');

      if (!allowClicked) {
        // Fallback: try clicking the AWS primary button as last resort
        console.log('   ⚠️  "Allow Access" not found by text, trying AWS primary button...');
        try {
          await this.page.waitForSelector('[class*="awsui_variant-primary"]', { visible: true, timeout: 10000 });
          await this.input.humanClick('[class*="awsui_variant-primary"]');
          await this.input.randomPause(3000, 5000);
          console.log('   ✅ Clicked AWS primary button');
        } catch (e) {
          console.log('   ⚠️  No "Allow Access" button found, proceeding anyway');
        }
      } else {
        await this.input.randomPause(2000, 3000);
        console.log('   ✅ AWS OAuth authorization clicked!');
      }
    } else {
      // Not a device auth page — might be already on dashboard or success page
      const isDashboardPage = pageUrl.includes('/profile') || pageUrl.includes('dashboard') || pageUrl.includes('console');
      const hasWelcomeText = pageText.toLowerCase().includes('welcome') || pageText.toLowerCase().includes('success') || pageText.toLowerCase().includes('account');

      if (isDashboardPage || hasWelcomeText) {
        console.log('   ✅ Detected: Already on dashboard / welcome page');
      } else {
        console.log('   ℹ️  Unknown page state, waiting a bit more...');
        await this.input.randomPause(3000, 5000);
      }
    }
  }

  async _dismissCookieBanner() {
    try {
      const clicked = await this.page.evaluate(() => {
        const phrases = [
          'accept all', 'accept', 'agree', 'allow all', 'ok',
          'zaakceptuj', 'akceptuj', 'zgadzam', 'aceptar'
        ];
        const buttons = Array.from(document.querySelectorAll('button, [role="button"], a'));
        for (const btn of buttons) {
          const text = (btn.innerText || btn.textContent || '').trim().toLowerCase();
          const rect = btn.getBoundingClientRect();
          const isVisible = rect.width > 0 && rect.height > 0 &&
            window.getComputedStyle(btn).display !== 'none' &&
            window.getComputedStyle(btn).visibility !== 'hidden';
          if (isVisible && phrases.some(p => text === p || text.startsWith(p))) {
            btn.click();
            return text;
          }
        }
        const selectors = [
          '#onetrust-accept-btn-handler', '#L2AGLb', '.fc-cta-consent',
          '[data-cookiefirst-action="accept"]',
          'button[id*="accept"]', 'button[class*="accept"]'
        ];
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el) {
            const rect = el.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              el.click();
              return sel;
            }
          }
        }
        return null;
      });
      if (clicked) {
        console.log(`   🍪 Dismissed cookie banner: "${clicked}"`);
        await new Promise(r => setTimeout(r, 1500));
        return true;
      }
    } catch (e) {}
    return false;
  }

  async _clickContinueButton(label) {
    // Dismiss cookie banner first
    await this._dismissCookieBanner();
    await new Promise(r => setTimeout(r, 500));

    const buttonInfo = await this.page.evaluate(() => {
      const candidates = [];

      // Strategy 1: Find buttons/links with "Continue" text
      const allClickable = Array.from(document.querySelectorAll(
        'button, [role="button"], input[type="submit"], a[href]'
      ));
      for (const el of allClickable) {
        const text = (el.innerText || el.textContent || el.value || '').trim();
        if (/continue/i.test(text)) {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            candidates.push({
              x: rect.left + rect.width / 2,
              y: rect.top + rect.height / 2,
              text,
              tag: el.tagName,
              score: text.toLowerCase() === 'continue' ? 10 : 5
            });
          }
        }
      }

      // Strategy 2: AWS UI primary button class
      const awsBtns = document.querySelectorAll('[class*="awsui_variant-primary"]');
      for (const el of awsBtns) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          candidates.push({
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
            text: (el.innerText || '').trim(),
            tag: 'AWS_PRIMARY',
            score: 8
          });
        }
      }

      // Strategy 3: Submit buttons
      const submits = document.querySelectorAll('button[type="submit"], input[type="submit"]');
      for (const el of submits) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          candidates.push({
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
            text: (el.innerText || el.value || '').trim(),
            tag: 'SUBMIT',
            score: 3
          });
        }
      }

      // Return highest-scored candidate
      candidates.sort((a, b) => b.score - a.score);
      return candidates[0] || null;
    });

    if (buttonInfo) {
      console.log(`   🖱️  Clicking: "${buttonInfo.text}" (${buttonInfo.tag}) [${label}]`);
      await this.input.humanClickPoint(buttonInfo.x, buttonInfo.y);
      return true;
    }

    // Fallback: try AWS primary button via CSS selector with humanClick
    try {
      const clicked = await this.input.humanClick('[class*="awsui_variant-primary"]');
      if (clicked) {
        console.log(`   🖱️  Clicked AWS primary button via CSS [${label}]`);
        return true;
      }
    } catch (e) {}

    console.log(`   ⚠️  No Continue button found at step: ${label}`);
    return false;
  }
}

module.exports = { AwsLoginFlow };
