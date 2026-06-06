/**
 * Utilities for human-like interaction simulation.
 * Provides mouse movement, clicking, typing, scrolling, and visual overlays.
 */

class HumanInput {
  /**
   * @param {object} page - Puppeteer page instance
   * @param {object} [state] - Shared state object with lastMousePosition
   */
  constructor(page, state = {}) {
    this.page = page;
    this.state = state;
  }

  get lastMousePosition() {
    return this.state.lastMousePosition || null;
  }

  set lastMousePosition(pos) {
    this.state.lastMousePosition = pos;
  }

  // ─── Mouse Position ─────────────────────────────────────────────

  _getCurrentMousePos() {
    if (this.lastMousePosition) return this.lastMousePosition;
    const startX = 120 + Math.random() * 200;
    const startY = 80 + Math.random() * 150;
    this.lastMousePosition = { x: startX, y: startY };
    return this.lastMousePosition;
  }

  // ─── Human Mouse Movement ───────────────────────────────────────

  async humanMouseMove(x, y) {
    const currentPos = this._getCurrentMousePos();
    const distance = Math.sqrt((x - currentPos.x) ** 2 + (y - currentPos.y) ** 2);

    if (distance < 1.5) {
      const nx = x + (Math.random() - 0.5) * 1.2;
      const ny = y + (Math.random() - 0.5) * 1.2;
      await this.page.mouse.move(nx, ny);
      this.lastMousePosition = { x: nx, y: ny };
      return;
    }

    const speedFactor = 0.6 + Math.random() * 0.8;
    const baseSpeed = (200 + distance * 1.5) * speedFactor;
    const duration = Math.max(250, Math.min(1500, (distance / baseSpeed) * 1000));

    const stepPx = 3 + Math.random() * 5;
    const steps = Math.max(20, Math.min(100, Math.floor(distance / stepPx)));

    const dx = x - currentPos.x;
    const dy = y - currentPos.y;
    const perpX = -dy / distance;
    const perpY = dx / distance;

    const curveSign = Math.random() > 0.5 ? 1 : -1;
    const curveIntensity = Math.min(0.25, 0.03 + (distance / 2500));
    const curveOffset = distance * curveIntensity * curveSign * (0.5 + Math.random() * 1.0);

    const cp1Frac = 0.2 + Math.random() * 0.15;
    const cp2Frac = 0.6 + Math.random() * 0.2;
    const cp1x = currentPos.x + dx * cp1Frac + perpX * curveOffset;
    const cp1y = currentPos.y + dy * cp1Frac + perpY * curveOffset;
    const cp2x = currentPos.x + dx * cp2Frac + perpX * curveOffset * 0.3;
    const cp2y = currentPos.y + dy * cp2Frac + perpY * curveOffset * 0.3;

    const shouldOvershoot = Math.random() > 0.6 && distance > 80;
    const overshootPx = shouldOvershoot ? (5 + Math.random() * (distance * 0.06)) : 0;
    const overshootAngle = Math.atan2(dy, dx) + (Math.random() - 0.5) * 0.4;
    const targetX = shouldOvershoot ? x + Math.cos(overshootAngle) * overshootPx : x;
    const targetY = shouldOvershoot ? y + Math.sin(overshootAngle) * overshootPx : y;

    const bezier = (t, p0, p1, p2, p3) => {
      const mt = 1 - t;
      return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3;
    };

    let tremorPhaseX = Math.random() * Math.PI * 2;
    let tremorPhaseY = Math.random() * Math.PI * 2;
    const tremorFreq = 0.12 + Math.random() * 0.15;
    const tremorAmp = 0.4 + Math.random() * 0.8;

    const microPauseAt = Math.random() > 0.6 ? (0.25 + Math.random() * 0.5) : -1;
    const microPauseDuration = 40 + Math.random() * 100;

    for (let i = 0; i <= steps; i++) {
      const rawProgress = i / steps;
      const t = rawProgress;
      const easedProgress = 6 * t ** 5 - 15 * t ** 4 + 10 * t ** 3;

      let moveX = bezier(easedProgress, currentPos.x, cp1x, cp2x, targetX);
      let moveY = bezier(easedProgress, currentPos.y, cp1y, cp2y, targetY);

      tremorPhaseX += tremorFreq * (0.9 + Math.random() * 0.2);
      tremorPhaseY += tremorFreq * 1.3 * (0.9 + Math.random() * 0.2);
      if (i > 3 && i < steps - 3) {
        const tremorScale = 0.7 + Math.random() * 0.6;
        moveX += Math.sin(tremorPhaseX) * tremorAmp * tremorScale;
        moveY += Math.cos(tremorPhaseY) * tremorAmp * tremorScale;
      }

      await this.page.mouse.move(moveX, moveY);
      this.lastMousePosition = { x: moveX, y: moveY };

      const baseDelay = duration / steps;
      const jitterMs = (Math.random() - 0.5) * baseDelay * 0.5;
      let stepDelay = Math.max(8, baseDelay + jitterMs);

      if (microPauseAt > 0 && Math.abs(rawProgress - microPauseAt) < (1.5 / steps)) {
        stepDelay += microPauseDuration;
      }

      await new Promise(r => setTimeout(r, stepDelay));
    }

    if (shouldOvershoot) {
      await new Promise(r => setTimeout(r, 60 + Math.random() * 80));
      const corrSteps = 5 + Math.floor(Math.random() * 5);
      for (let i = 1; i <= corrSteps; i++) {
        const cProgress = i / corrSteps;
        const cEased = 1 - Math.pow(1 - cProgress, 2.5);
        const corrX = targetX + (x - targetX) * cEased + Math.sin(tremorPhaseX + i) * 0.5;
        const corrY = targetY + (y - targetY) * cEased + Math.cos(tremorPhaseY + i) * 0.5;
        await this.page.mouse.move(corrX, corrY);
        this.lastMousePosition = { x: corrX, y: corrY };
        await new Promise(r => setTimeout(r, 20 + Math.random() * 35));
      }
    }

    const finalX = x + (Math.random() - 0.5) * 0.8;
    const finalY = y + (Math.random() - 0.5) * 0.8;
    await this.page.mouse.move(finalX, finalY);
    this.lastMousePosition = { x: finalX, y: finalY };
    await new Promise(r => setTimeout(r, 15 + Math.random() * 40));
  }

  // ─── Clicking ───────────────────────────────────────────────────

  async humanClickPoint(x, y, options = {}) {
    const { prePause = true, postPause = true, jitter = 0, button = 'left' } = options;
    try {
      if (prePause) await this.randomPause(180, 320);

      const targetX = x + (jitter ? (Math.random() - 0.5) * jitter : 0);
      const targetY = y + (jitter ? (Math.random() - 0.5) * jitter : 0);

      await this.humanMouseMove(targetX, targetY);
      await new Promise(r => setTimeout(r, 40 + Math.random() * 80));

      await this.page.mouse.down({ button });
      await new Promise(r => setTimeout(r, 30 + Math.random() * 70));
      await this.page.mouse.up({ button });

      if (postPause) await this.randomPause(120, 260);
      return true;
    } catch (e) {
      console.log(`   ⚠️  Point click failed: ${e.message}`);
      return false;
    }
  }

  async humanClick(selector) {
    try {
      await this.randomPause(300, 600);

      const element = await this.page.$(selector);
      if (!element) {
        console.log(`   ⚠️  Element not found: ${selector}`);
        return false;
      }

      const box = await element.boundingBox();
      if (!box) {
        console.log(`   ⚠️  Element not visible: ${selector}`);
        return false;
      }

      const paddingX = Math.min(12, Math.max(3, box.width * 0.18));
      const paddingY = Math.min(10, Math.max(3, box.height * 0.18));
      const usableWidth = Math.max(1, box.width - paddingX * 2);
      const usableHeight = Math.max(1, box.height - paddingY * 2);

      const clickX = box.x + paddingX + Math.random() * usableWidth;
      const clickY = box.y + paddingY + Math.random() * usableHeight;

      return await this.humanClickPoint(clickX, clickY, { prePause: false, jitter: 0 });
    } catch (e) {
      console.log(`   ⚠️  Click failed: ${e.message}`);
      return false;
    }
  }

  async humanClickElement(element) {
    try {
      await this.randomPause(200, 400);
      await element.click();
      await this.randomPause(100, 300);
      return true;
    } catch (e) {
      console.log(`   ⚠️  Click element failed: ${e.message}`);
      return false;
    }
  }

  // ─── Typing ─────────────────────────────────────────────────────

  async humanTypeElement(element, text) {
    try {
      await element.click();
      await this.randomPause(400, 800);

      const isMac = process.platform === 'darwin';
      await this.page.keyboard.down(isMac ? 'Meta' : 'Control');
      await this.page.keyboard.press('a');
      await this.page.keyboard.up(isMac ? 'Meta' : 'Control');
      await this.randomPause(100, 200);
      await this.page.keyboard.press('Backspace');
      await this.randomPause(200, 400);

      for (let i = 0; i < text.length; i++) {
        await this.page.keyboard.type(text[i]);

        let delay;
        if (Math.random() > 0.92) {
          delay = Math.random() * 1500 + 800;
        } else if (Math.random() > 0.80) {
          delay = Math.random() * 250 + 150;
        } else {
          delay = 300 + (Math.random() - 0.5) * 160;
        }
        await new Promise(r => setTimeout(r, delay));
      }

      await this.randomPause(200, 400);

      await this.page.evaluate(() => {
        if (document.activeElement && typeof document.activeElement.blur === 'function') {
          document.activeElement.blur();
        }
      }).catch(() => {});

      return true;
    } catch (e) {
      console.log(`   ⚠️  Type element failed: ${e.message}`);
      return false;
    }
  }

  async humanType(selector, text) {
    try {
      await this.page.focus(selector);
      await this.randomPause(400, 800);

      await this.humanBackspaceClear(selector);
      await this.randomPause(300, 600);

      for (let i = 0; i < text.length; i++) {
        await this.page.keyboard.type(text[i]);

        let delay;
        if (Math.random() > 0.92) {
          delay = Math.random() * 1500 + 800;
        } else if (Math.random() > 0.80) {
          delay = Math.random() * 250 + 150;
        } else {
          delay = 300 + (Math.random() - 0.5) * 160;
        }
        await new Promise(r => setTimeout(r, delay));
      }

      await this.randomPause(200, 400);

      await this.page.evaluate(() => {
        if (document.activeElement && typeof document.activeElement.blur === 'function') {
          document.activeElement.blur();
        }
      }).catch(() => {});

      return true;
    } catch (e) {
      console.log(`   ⚠️  Type failed: ${e.message}`);
      return false;
    }
  }

  async humanBackspaceClear(selector) {
    try {
      await this.page.focus(selector);
      await this.randomPause(200, 400);

      const isMac = process.platform === 'darwin';
      await this.page.keyboard.down(isMac ? 'Meta' : 'Control');
      await this.page.keyboard.press('a');
      await this.page.keyboard.up(isMac ? 'Meta' : 'Control');
      await this.randomPause(100, 200);

      await this.page.keyboard.press('Backspace');
      await this.randomPause(150, 300);

      for (let i = 0; i < 3; i++) {
        await this.page.keyboard.press('Backspace');
        await this.randomPause(50, 100);
      }
    } catch (e) {
      console.log(`   ⚠️  Backspace clear failed: ${e.message}`);
    }
  }

  // ─── Scrolling ──────────────────────────────────────────────────

  async naturalScroll(direction = 'down', amount = null) {
    const scrollAmount = amount || Math.floor(Math.random() * 150) + 80;
    const steps = Math.floor(Math.random() * 8) + 12;
    const pos = this._getCurrentMousePos();
    const wiggleX = (Math.random() - 0.5) * 15;

    for (let i = 0; i < steps; i++) {
      const progress = i / steps;
      const easeProgress = progress < 0.5
        ? 2 * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 2) / 2;

      const stepAmount = (scrollAmount / steps) * (1 + Math.sin(easeProgress * Math.PI) * 0.3);
      const variance = (Math.random() - 0.5) * 6;

      await this.page.evaluate((amt, dir) => {
        window.scrollBy({
          top: dir === 'down' ? amt : -amt,
          left: 0,
          behavior: 'auto'
        });
      }, stepAmount + variance, direction);

      if (Math.random() > 0.6) {
        const newX = pos.x + wiggleX * Math.sin(progress * Math.PI) + (Math.random() - 0.5) * 3;
        const newY = pos.y + (Math.random() - 0.5) * 2;
        await this.page.mouse.move(newX, newY);
        this.lastMousePosition = { x: newX, y: newY };
      }

      const delay = Math.random() * 18 + 14 + (progress * 25);
      await new Promise(r => setTimeout(r, delay));
    }

    await new Promise(r => setTimeout(r, Math.random() * 180 + 80));
  }

  // ─── Idle / Wander ──────────────────────────────────────────────

  async randomMouseWander() {
    const viewport = await this.page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight
    })).catch(() => ({ width: 1280, height: 720 }));

    const wanderCount = 2 + Math.floor(Math.random() * 2);

    for (let i = 0; i < wanderCount; i++) {
      const isBigJump = Math.random() > 0.8;
      const rangeX = isBigJump ? 250 : 80;
      const rangeY = isBigJump ? 180 : 60;

      const curPos = this._getCurrentMousePos();
      const offsetX = (Math.random() - 0.4) * rangeX;
      const offsetY = (Math.random() - 0.3) * rangeY;

      const targetX = Math.max(40, Math.min(curPos.x + offsetX, viewport.width - 40));
      const targetY = Math.max(40, Math.min(curPos.y + offsetY, viewport.height - 40));

      await this.humanMouseMove(targetX, targetY);
      await new Promise(r => setTimeout(r, 60 + Math.random() * 120));
    }
  }

  async idleMicroDrift() {
    const pos = this._getCurrentMousePos();
    const driftX = pos.x + (Math.random() - 0.5) * 6;
    const driftY = pos.y + (Math.random() - 0.5) * 4;
    const driftSteps = 2 + Math.floor(Math.random() * 3);
    for (let i = 1; i <= driftSteps; i++) {
      const frac = i / driftSteps;
      const mx = pos.x + (driftX - pos.x) * frac;
      const my = pos.y + (driftY - pos.y) * frac;
      await this.page.mouse.move(mx, my);
      this.lastMousePosition = { x: mx, y: my };
      await new Promise(r => setTimeout(r, 40 + Math.random() * 40));
    }
  }

  async randomPause(min = 200, max = 600) {
    const delay = Math.floor(Math.random() * (max - min)) + min;

    if (delay > 400) {
      if (Math.random() > 0.5) await this.idleMicroDrift();
      if (delay > 800 && Math.random() > 0.7) await this.randomMouseWander();
    } else if (delay > 200 && Math.random() > 0.7) {
      await this.idleMicroDrift();
    }

    await new Promise(r => setTimeout(r, delay));
  }

  // ─── Visual Overlay ─────────────────────────────────────────────

  async setupVisualMouseTracking() {
    let startX = 120 + Math.random() * 200;
    let startY = 80 + Math.random() * 150;
    if (this.lastMousePosition) {
      startX = this.lastMousePosition.x;
      startY = this.lastMousePosition.y;
    }

    await this.page.evaluateOnNewDocument((INITIAL_X, INITIAL_Y) => {
      const ensureOverlay = () => {
        let cursor = document.getElementById('puppeteer-mouse-pointer');
        if (!cursor) {
          cursor = document.createElement('div');
          cursor.id = 'puppeteer-mouse-pointer';
          cursor.style.cssText = `
            position: fixed; width: 20px; height: 20px;
            border: 2px solid red; border-radius: 50%;
            background: rgba(255, 0, 0, 0.3);
            pointer-events: none; z-index: 10000;
            transition: none;
            transform: translate(-50%, -50%);
            will-change: left, top; backface-visibility: hidden;
          `;
          document.body.appendChild(cursor);
        }

        let overlay = document.getElementById('puppeteer-action-overlay');
        if (!overlay) {
          overlay = document.createElement('div');
          overlay.id = 'puppeteer-action-overlay';
          overlay.style.cssText = `
            position: fixed; top: 20px; right: 20px;
            background: rgba(0, 0, 0, 0.85); color: #00ff00;
            padding: 15px 20px; border-radius: 8px;
            font-family: 'Courier New', monospace; font-size: 14px;
            z-index: 10001; min-width: 300px; max-width: 400px;
            pointer-events: none; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
          `;
          overlay.innerHTML = `
            <div style="font-weight: bold; margin-bottom: 10px; color: #ffff00;">🤖 Bot Status</div>
            <div id="action-step" style="margin-bottom: 5px;">Step: <span style="color: #00ffff;">Ready</span></div>
            <div id="action-current" style="margin-bottom: 5px;">Action: <span style="color: #ffffff;">Idle</span></div>
            <div id="action-target" style="color: #aaaaaa; font-size: 12px;">Target: None</div>
          `;
          document.body.appendChild(overlay);
        }

        if (typeof window.__puppeteerMouseX !== 'number') window.__puppeteerMouseX = INITIAL_X;
        if (typeof window.__puppeteerMouseY !== 'number') window.__puppeteerMouseY = INITIAL_Y;

        if (!window.__puppeteerCursorUpdaterInstalled) {
          window.__puppeteerCursorUpdaterInstalled = true;
          setInterval(() => {
            const liveCursor = document.getElementById('puppeteer-mouse-pointer');
            if (!liveCursor) return;
            liveCursor.style.left = `${window.__puppeteerMouseX}px`;
            liveCursor.style.top = `${window.__puppeteerMouseY}px`;
          }, 32);
        }

        window.__updateActionOverlay = (step, action, target) => {
          const stepEl = document.getElementById('action-step');
          const actionEl = document.getElementById('action-current');
          const targetEl = document.getElementById('action-target');
          if (stepEl) stepEl.innerHTML = `Step: <span style="color: #00ffff;">${step}</span>`;
          if (actionEl) actionEl.innerHTML = `Action: <span style="color: #ffffff;">${action}</span>`;
          if (targetEl) targetEl.innerHTML = `Target: ${target}`;
        };

        window.__showPuppeteerClickDebug = (x, y, label = 'CLICK') => {
          const marker = document.createElement('div');
          marker.style.cssText = `
            position: fixed; left: ${x}px; top: ${y}px;
            width: 22px; height: 22px;
            border: 3px solid #00ff7f; border-radius: 50%;
            background: rgba(0, 255, 127, 0.18);
            transform: translate(-50%, -50%);
            pointer-events: none; z-index: 10002;
            box-shadow: 0 0 12px rgba(0, 255, 127, 0.75);
          `;
          const tag = document.createElement('div');
          tag.textContent = `${label} @ ${Math.round(x)},${Math.round(y)}`;
          tag.style.cssText = `
            position: fixed; left: ${x + 16}px; top: ${y + 16}px;
            background: rgba(0, 0, 0, 0.88); color: #00ff7f;
            border: 1px solid rgba(0, 255, 127, 0.65); border-radius: 999px;
            padding: 4px 8px; font: 12px/1.2 'Courier New', monospace;
            pointer-events: none; z-index: 10003; white-space: nowrap;
          `;
          document.body.appendChild(marker);
          document.body.appendChild(tag);
          setTimeout(() => {
            marker.style.opacity = '0'; tag.style.opacity = '0';
            marker.style.transition = 'opacity 0.3s'; tag.style.transition = 'opacity 0.3s';
            setTimeout(() => { marker.remove(); tag.remove(); }, 300);
          }, 1500);
        };
      };

      document.addEventListener('DOMContentLoaded', ensureOverlay);
      window.addEventListener('load', ensureOverlay);
    }, startX, startY);

    await this.ensureVisualOverlay(startX, startY);

    const syncCursor = async (x, y) => {
      this.lastMousePosition = { x, y };
      await this.page.evaluate((nextX, nextY) => {
        window.__puppeteerMouseX = nextX;
        window.__puppeteerMouseY = nextY;
      }, x, y).catch(() => {});
    };

    const originalMouseMove = this.page.mouse.move.bind(this.page.mouse);
    this.page.mouse.move = async (x, y, options) => {
      await syncCursor(x, y);
      const result = await originalMouseMove(x, y, options);
      await syncCursor(x, y);
      return result;
    };

    const originalMouseClick = this.page.mouse.click.bind(this.page.mouse);
    this.page.mouse.click = async (x, y, options) => {
      await syncCursor(x, y);
      const result = await originalMouseClick(x, y, options);
      await syncCursor(x, y);
      return result;
    };

    this.page.__visualMouseTrackingInstalled = true;

    if (!this.lastMousePosition) {
      this.lastMousePosition = { x: startX, y: startY };
    }
  }

  async ensureVisualOverlay(customStartX, customStartY) {
    if (!this.page) return;

    let startX = customStartX;
    let startY = customStartY;

    if (startX === undefined || startY === undefined) {
      startX = 120 + Math.random() * 200;
      startY = 80 + Math.random() * 150;
      if (this.lastMousePosition) {
        startX = this.lastMousePosition.x;
        startY = this.lastMousePosition.y;
      }
    }

    await this.page.evaluate((INITIAL_X, INITIAL_Y) => {
      const ensureOverlay = () => {
        let cursor = document.getElementById('puppeteer-mouse-pointer');
        if (!cursor) {
          cursor = document.createElement('div');
          cursor.id = 'puppeteer-mouse-pointer';
          cursor.style.cssText = `
            position: fixed; width: 20px; height: 20px;
            border: 2px solid red; border-radius: 50%;
            background: rgba(255, 0, 0, 0.3);
            pointer-events: none; z-index: 10000;
            transition: none;
            transform: translate(-50%, -50%);
          `;
          document.body.appendChild(cursor);
        }

        let overlay = document.getElementById('puppeteer-action-overlay');
        if (!overlay) {
          overlay = document.createElement('div');
          overlay.id = 'puppeteer-action-overlay';
          overlay.style.cssText = `
            position: fixed; top: 20px; right: 20px;
            background: rgba(0, 0, 0, 0.85); color: #00ff00;
            padding: 15px 20px; border-radius: 8px;
            font-family: 'Courier New', monospace; font-size: 14px;
            z-index: 10001; min-width: 300px; max-width: 400px;
            pointer-events: none; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
          `;
          overlay.innerHTML = `
            <div style="font-weight: bold; margin-bottom: 10px; color: #ffff00;">🤖 Bot Status</div>
            <div id="action-step" style="margin-bottom: 5px;">Step: <span style="color: #00ffff;">Ready</span></div>
            <div id="action-current" style="margin-bottom: 5px;">Action: <span style="color: #ffffff;">Idle</span></div>
            <div id="action-target" style="color: #aaaaaa; font-size: 12px;">Target: None</div>
          `;
          document.body.appendChild(overlay);
        }

        if (typeof window.__puppeteerMouseX !== 'number') window.__puppeteerMouseX = INITIAL_X;
        if (typeof window.__puppeteerMouseY !== 'number') window.__puppeteerMouseY = INITIAL_Y;

        if (!window.__puppeteerCursorUpdaterInstalled) {
          window.__puppeteerCursorUpdaterInstalled = true;
          setInterval(() => {
            const liveCursor = document.getElementById('puppeteer-mouse-pointer');
            if (!liveCursor) return;
            liveCursor.style.left = `${window.__puppeteerMouseX}px`;
            liveCursor.style.top = `${window.__puppeteerMouseY}px`;
          }, 32);
        }

        window.__updateActionOverlay = (step, action, target) => {
          const stepEl = document.getElementById('action-step');
          const actionEl = document.getElementById('action-current');
          const targetEl = document.getElementById('action-target');
          if (stepEl) stepEl.innerHTML = `Step: <span style="color: #00ffff;">${step}</span>`;
          if (actionEl) actionEl.innerHTML = `Action: <span style="color: #ffffff;">${action}</span>`;
          if (targetEl) targetEl.innerHTML = `Target: ${target}`;
        };
      };

      window.__ensurePuppeteerOverlay = ensureOverlay;
      ensureOverlay();
    }, startX, startY).catch(() => {});
  }

  async updateOverlay(step, action, target = 'N/A') {
    try {
      await this.page.evaluate((s, a, t) => {
        if (window.__updateActionOverlay) window.__updateActionOverlay(s, a, t);
      }, step, action, target);
    } catch (e) {}
  }
}

module.exports = { HumanInput };
