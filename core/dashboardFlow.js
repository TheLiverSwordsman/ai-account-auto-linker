const axios = require('axios');
const fs = require('fs');
const path = require('path');
const tui = require('../utils/tui');

class DashboardFlow {
  constructor(agent) { this.agent = agent; }
  get page() { return this.agent.page; }
  get input() { return this.agent.humanInput; }

  async registerWithDashboard() {
    console.log('\n[PHASE 2] Connecting to 9router dashboard via AWS OAuth...');
    try {
      console.log('   🔐 Step 1: Authenticating with dashboard API...');
      const loginResponse = await axios.post(`${this.agent.dashboardUrl}/api/auth/login`, {
        password: this.agent.dashboardPassword
      }, { headers: { 'Content-Type': 'application/json' } });

      if (!loginResponse.data.success) throw new Error('Dashboard login failed - API returned success:false');
      const setCookies = loginResponse.headers['set-cookie'];
      if (!setCookies) throw new Error('Dashboard login failed - no cookies received');
      const cookieHeader = setCookies.join('; ');
      console.log('   ✅ Dashboard authenticated');

      console.log('   🔑 Step 2: Requesting device code...');
      const deviceCodeResponse = await axios.get(`${this.agent.dashboardUrl}/api/oauth/kiro/device-code`, {
        headers: { 'Cookie': cookieHeader }
      });
      const dd = deviceCodeResponse.data;
      if (!dd.device_code) throw new Error('Failed to get device code');
      console.log(`   ✅ Device code obtained: ${dd.user_code}`);

      const awsUrl = dd.verification_uri_complete;
      console.log('   🌐 Navigating to AWS OAuth page...');
      await this.page.goto(awsUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await new Promise(r => setTimeout(r, 3000));

      console.log('   ⏳ Waiting for "Confirm and Continue"...');
      await this.page.waitForSelector('#cli_verification_btn', { visible: true, timeout: 15000 });
      console.log('   ✅ Clicking "Confirm and Continue"...');
      await this.input.humanClick('#cli_verification_btn');
      await new Promise(r => setTimeout(r, 3000));

      console.log('   ⏳ Waiting for "Allow Access"...');
      await this.page.waitForSelector('[class*="awsui_variant-primary"]', { visible: true, timeout: 15000 });
      console.log('   🔓 Clicking "Allow Access"...');
      await this.input.humanClick('[class*="awsui_variant-primary"]');
      await new Promise(r => setTimeout(r, 5000));

      await this.agent.saveBrowserState();
      console.log('   ✅ AWS OAuth authorization granted!');

      console.log('   ⏳ Polling for authentication token...');
      const pollBody = {
        deviceCode: dd.device_code, codeVerifier: dd.codeVerifier,
        _clientId: dd._clientId, _clientSecret: dd._clientSecret,
        _region: dd._region, _authMethod: dd._authMethod, _startUrl: dd._startUrl
      };

      const maxAttempts = 60, interval = 3000;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
          const pollResponse = await axios.post(
            `${this.agent.dashboardUrl}/api/oauth/kiro/poll`, pollBody,
            { headers: { 'Content-Type': 'application/json', 'Cookie': cookieHeader } }
          );
          if (pollResponse.data.token) {
            console.log('   ✅ Authentication token received!');
            await this.agent.saveBrowserState();
            return { token: pollResponse.data.token, deviceCode: dd.device_code };
          }
          if (attempt % 5 === 0) console.log(`   ⏱️  Poll attempt ${attempt + 1}/${maxAttempts}...`);
        } catch (error) {
          if (attempt === maxAttempts - 1) throw new Error('Token polling timed out');
        }
        await new Promise(r => setTimeout(r, interval));
      }
      throw new Error('Failed to obtain token');
    } catch (error) {
      console.error('   ❌ Dashboard connection failed:', error.message);
      throw error;
    }
  }

  async runDashboardOnly(credentialsList) {
    console.log('');
    tui.printBox('Dashboard-Only Mode (Connect Saved)', { width: 44, align: 'center' });
    console.log('');
    console.log(`  📋 Found ${credentialsList.length} account(s) to connect\n`);

    this.agent.identity = this.agent.generateIdentity();
    await this.agent.setupBrowser();

    const results = [];
    for (let i = 0; i < credentialsList.length; i++) {
      const account = credentialsList[i];
      console.log(`\n─── Account ${i + 1}/${credentialsList.length}: ${account.email} ───`);
      try {
        const dashboardResult = await this.registerWithDashboard();
        results.push({ email: account.email, success: true, token: dashboardResult.token, deviceCode: dashboardResult.deviceCode });
        console.log(`  ✅ ${account.email} connected successfully`);
        const cacheDir = path.join(__dirname, '..', '.cache');
        if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
        const tokenPath = path.join(cacheDir, `connected_${account.email.replace(/[^a-z0-9]/gi, '_')}_${Date.now()}.json`);
        fs.writeFileSync(tokenPath, JSON.stringify({ ...account, token: dashboardResult.token, deviceCode: dashboardResult.deviceCode, connectedAt: new Date().toISOString() }, null, 2));
        console.log(`  💾 Saved: ${tokenPath}`);
      } catch (error) {
        console.error(`  ❌ ${account.email} failed: ${error.message}`);
        results.push({ email: account.email, success: false, error: error.message });
      }
      if (i < credentialsList.length - 1) await new Promise(r => setTimeout(r, 2000));
    }
    await this.agent.cleanup();

    const connected = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);
    console.log('');
    tui.printBox('Connection Summary', { width: 44, align: 'center' });
    console.log(`  ✅ Connected: ${connected.length}/${results.length}`);
    if (failed.length > 0) failed.forEach(f => console.log(`     - ${f.email}: ${f.error}`));
    console.log('');
    const summaryPath = path.join(__dirname, '..', '.cache', `dashboard_summary_${Date.now()}.json`);
    fs.writeFileSync(summaryPath, JSON.stringify(results, null, 2));
    console.log(`  💾 Summary: ${summaryPath}\n`);
    return { success: failed.length === 0, results };
  }
}

module.exports = { DashboardFlow };
