const fs = require('fs');
const path = require('path');

class BrowserState {
  constructor(agent) { this.agent = agent; }

  async captureBrowserState() {
    try {
      const cookies = await this.agent.page.cookies();
      const storage = await this.agent.page.evaluate(() => {
        const localStorage = {}, sessionStorage = {};
        for (let i = 0; i < window.localStorage.length; i++) {
          const key = window.localStorage.key(i);
          localStorage[key] = window.localStorage.getItem(key);
        }
        for (let i = 0; i < window.sessionStorage.length; i++) {
          const key = window.sessionStorage.key(i);
          sessionStorage[key] = window.sessionStorage.getItem(key);
        }
        return { localStorage, sessionStorage };
      });
      return { timestamp: new Date().toISOString(), url: this.agent.page.url(), cookies, ...storage };
    } catch (error) {
      return { timestamp: new Date().toISOString(), error: error.message };
    }
  }

  async saveBrowserState() {
    try {
      const allPages = await this.agent.browser.pages();
      const allCookies = [];
      for (const page of allPages) allCookies.push(...await page.cookies());

      const uniqueCookies = [];
      const seen = new Set();
      for (const cookie of allCookies) {
        const key = `${cookie.domain}-${cookie.name}`;
        if (!seen.has(key)) { seen.add(key); uniqueCookies.push(cookie); }
      }

      let storage = { localStorage: {}, sessionStorage: {} };
      const currentUrl = this.agent.page.url();
      if (currentUrl && !currentUrl.startsWith('about:')) {
        try {
          storage = await this.agent.page.evaluate(() => {
            const ls = {}, ss = {};
            try { for (let i = 0; i < window.localStorage.length; i++) { const key = window.localStorage.key(i); ls[key] = window.localStorage.getItem(key); } } catch (e) {}
            try { for (let i = 0; i < window.sessionStorage.length; i++) { const key = window.sessionStorage.key(i); ss[key] = window.sessionStorage.getItem(key); } } catch (e) {}
            return { localStorage: ls, sessionStorage: ss };
          });
        } catch (e) {}
      }

      const browserState = { timestamp: new Date().toISOString(), url: currentUrl, cookies: uniqueCookies, ...storage };
      const cacheDir = path.join(__dirname, '..', '.cache');
      if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
      const statePath = path.join(cacheDir, `dashboard_state_${Date.now()}.json`);
      fs.writeFileSync(statePath, JSON.stringify(browserState, null, 2));
      console.log(`   💾 Browser state saved: ${statePath}`);
      return browserState;
    } catch (error) {
      console.error('   ⚠️  Failed to save browser state:', error.message);
      throw error;
    }
  }

  async waitForAwsWindowClose(timeout = 30000) {
    return new Promise((resolve) => {
      let closed = false;
      const checkClosed = () => {
        if (closed) return;
        if (this.agent.page.isClosed()) { closed = true; resolve(); return; }
        setTimeout(checkClosed, 500);
      };
      setTimeout(() => { if (!closed) { closed = true; resolve(); } }, timeout);
      checkClosed();
    });
  }
}

module.exports = { BrowserState };
