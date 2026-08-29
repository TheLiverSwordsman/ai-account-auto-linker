const fs = require('fs');
const path = require('path');
const tui = require('./tui');
const logger = require('./logger');
const MailstackClient = require('../services/MailstackClient');
const { InboxDeadError } = MailstackClient;

class Settings {
  constructor() {
    this.settingsPath = path.join(__dirname, '..', '.settings.json');
  }

  getInboxEmail(inbox) {
    return inbox.email || inbox.address || inbox.mailbox || 'unknown';
  }

  hasTag(inbox, tag) {
    return (inbox.tags || []).some(item => String(item).toLowerCase() === tag.toLowerCase());
  }

  isActiveInbox(inbox) {
    return inbox.status === 'active' || inbox.status === 'polling' || inbox.status === 'available';
  }

  isRegistrationCandidate(inbox) {
    return inbox.allowed !== false && this.isActiveInbox(inbox) && !this.hasTag(inbox, 'kiro') && !inbox.dead;
  }

  /**
   * Load settings from file or return defaults
   */
  load() {
    if (fs.existsSync(this.settingsPath)) {
      try {
        const data = fs.readFileSync(this.settingsPath, 'utf8');
        const settings = JSON.parse(data);
        logger.debug('Settings', 'Loaded from file');
        return settings;
      } catch (e) {
        logger.warn('Settings', 'Failed to load settings, using defaults:', e.message);
        return this.getDefaultSettings();
      }
    }
    logger.debug('Settings', 'No settings file found, using defaults');
    return this.getDefaultSettings();
  }

  /**
   * Get default settings
   */
  getDefaultSettings() {
    return {
      inboxes: [],
      utilities: {
        workers: 1,
        headless: false
      },
      lastModified: null
    };
  }

  /**
   * Save settings to file
   */
  saveSettings(settings) {
    const merged = {
      ...this.getDefaultSettings(),
      ...settings,
      utilities: {
        ...this.getDefaultSettings().utilities,
        ...(settings.utilities || {})
      },
      lastModified: new Date().toISOString()
    };
    fs.writeFileSync(this.settingsPath, JSON.stringify(merged, null, 2));
    logger.info('Settings', `Saved settings to ${this.settingsPath}`);
    return merged;
  }

  save(inboxes) {
    const current = this.load();
    const settings = {
      ...current,
      inboxes,
      lastModified: new Date().toISOString()
    };
    this.saveSettings(settings);
    logger.info('Settings', `Saved ${inboxes.length} inbox(es) to ${this.settingsPath}`);
  }

  getUtilities() {
    const settings = this.load();
    return {
      ...this.getDefaultSettings().utilities,
      ...(settings.utilities || {})
    };
  }

  saveUtilities(utilities) {
    const current = this.load();
    return this.saveSettings({
      ...current,
      utilities: {
        ...this.getDefaultSettings().utilities,
        ...(current.utilities || {}),
        ...utilities
      }
    }).utilities;
  }

  /**
   * Fetch inboxes from Mailstack and merge with settings
   */
  async fetchAndMergeInboxes() {
    if (!process.env.MAILSTACK_API_KEY) {
      throw new Error('MAILSTACK_API_KEY not configured');
    }

    const mailstack = new MailstackClient(process.env.MAILSTACK_API_KEY);

    // Show progress for fetching accounts
    tui.showProgress('Fetching accounts...');
    const remoteInboxes = await mailstack.getInboxes();
    tui.clearProgress();

    logger.debug('Settings', `Raw inbox structure: ${JSON.stringify(remoteInboxes[0] || {}, null, 2)}`);

    const settings = this.load();
    const existingInboxes = settings.inboxes || [];

    // Separate inboxes into cache hits and misses
    const toScan = [];
    const cacheResults = [];

    for (let i = 0; i < remoteInboxes.length; i++) {
      const remoteInbox = remoteInboxes[i];
      const email = this.getInboxEmail(remoteInbox);
      const existing = existingInboxes.find(e => e.email === email);

      if (existing?.dead) {
        // Skip dead inboxes — they're permanently removed from active pool
        cacheResults.push({
          index: i,
          email,
          tags: [],
          lastScanned: existing.deadAt,
          fromCache: true,
          dead: true
        });
        logger.debug('Settings', `Skipping dead inbox ${email}`);
      } else if (existing && (existing.allowed === false || this.hasTag(existing, 'kiro') || (existing.tags && existing.tags.length > 0))) {
        // Cache hit / intentionally skipped. Disabled or Kiro-tagged inboxes should not be checked.
        cacheResults.push({
          index: i,
          email,
          tags: existing.tags || [],
          lastScanned: existing.lastScanned,
          fromCache: true
        });
        logger.debug('Settings', `Skipping scan for ${email} — allowed: ${existing.allowed !== false}, tags: [${(existing.tags || []).join(', ')}]`);
      } else {
        // Cache miss - needs scanning
        toScan.push({
          index: i,
          email,
          remoteInbox
        });
      }
    }

    // Scan in parallel with progress indicator
    const scanResults = [];
    if (toScan.length > 0) {
      let completed = 0;
      const total = toScan.length;

      // Create scanning promises with timeout and progress
      const scanPromises = toScan.map(async (item) => {
        try {
          // Show progress
          tui.showProgress(`Fetching account "${item.email}" (${completed}/${total})`);

          // Scan with timeout. 429 backoff may wait longer than a normal request.
          const tags = await Promise.race([
            this.scanInboxForTags(mailstack, item.email),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Scan timeout')), 60000)
            )
          ]);

          completed++;
          tui.showProgress(`Fetching account "${item.email}" (${completed}/${total})`);

          return {
            index: item.index,
            email: item.email,
            tags,
            lastScanned: new Date().toISOString(),
            fromCache: false
          };
        } catch (error) {
          completed++;

          // Check if this is a 410 (inbox dead) error
          if (error instanceof InboxDeadError) {
            logger.warn('Settings', `💀 ${item.email}: account dead (410), marking as dead`);
            this.markInboxDead(item.email);
            return null; // Exclude from results
          }

          logger.warn('Settings', `Could not scan inbox ${item.email}: ${error.message}`);

          // Fall back to cache if available
          const existing = existingInboxes.find(e => e.email === item.email);
          if (existing && existing.tags) {
            return {
              index: item.index,
              email: item.email,
              tags: existing.tags,
              lastScanned: existing.lastScanned,
              fromCache: true
            };
          }

          // No cache available
          return {
            index: item.index,
            email: item.email,
            tags: [],
            lastScanned: null,
            fromCache: false
          };
        }
      });

      // Wait for all scans to complete
      const results = await Promise.allSettled(scanPromises);
      tui.clearProgress();

      // Extract successful results (null = dead inbox, already marked)
      for (const result of results) {
        if (result.status === 'fulfilled' && result.value !== null) {
          scanResults.push(result.value);
        }
      }
    }

    // Merge all results back into inbox data
    const allResults = [...cacheResults, ...scanResults];
    const mergedInboxes = [];

    // Re-read settings in case markInboxDead wrote during scan
    const freshSettings = this.load();
    const freshInboxes = freshSettings.inboxes || [];

    for (let i = 0; i < remoteInboxes.length; i++) {
      const remoteInbox = remoteInboxes[i];
      const email = this.getInboxEmail(remoteInbox);
      const existing = existingInboxes.find(e => e.email === email);
      const fresh = freshInboxes.find(e => e.email === email);
      const result = allResults.find(r => r.index === i);

      // Preserve dead status — either from freshly-marked or previously saved
      if (fresh?.dead || existing?.dead) {
        mergedInboxes.push({
          email: email,
          domain: remoteInbox.domain || email.split('@')[1] || 'unknown',
          status: remoteInbox.status || 'unknown',
          allowed: false,
          tags: [],
          lastScanned: fresh?.deadAt || existing?.deadAt || null,
          createdAt: existing?.createdAt || new Date().toISOString(),
          dead: true,
          deadAt: fresh?.deadAt || existing?.deadAt || new Date().toISOString()
        });
        continue;
      }

      const inboxData = {
        email: email,
        domain: remoteInbox.domain || email.split('@')[1] || 'unknown',
        status: remoteInbox.status || 'unknown',
        allowed: existing ? existing.allowed : true,
        tags: result ? result.tags : [],
        lastScanned: result ? result.lastScanned : null,
        createdAt: existing?.createdAt || new Date().toISOString()
      };

      mergedInboxes.push(inboxData);
    }

    // Save merged inboxes
    this.save(mergedInboxes);
    logger.info('Settings', `Fetched and merged ${mergedInboxes.length} inbox(es) from Mailstack`);

    return mergedInboxes;
  }

  /**
   * Scan inbox for Kiro/AWS emails and return tags
   */
  async scanInboxForTags(mailstack, email) {
    try {
      const messages = await mailstack.getMessages(email, 50);
      const tags = new Set();

      // Keywords with specific tag mapping
      const keywords = [
        // Specific patterns first - these should be tagged as "kiro"
        { pattern: 'signin.aws', tag: 'kiro' },
        { pattern: 'verification-code kiro', tag: 'kiro' },

        // General patterns - these get their own tags
        { pattern: 'kiro', tag: 'kiro' },
        { pattern: 'aws signin', tag: 'aws-signin' }
      ];

      for (const msg of messages) {
        const subject = (msg.subject || '').toLowerCase();
        const from = (msg.from || '').toLowerCase();
        const fromName = (msg.from_name || '').toLowerCase();
        const body = (msg.body || '').toLowerCase();
        const allText = `${subject} ${from} ${fromName} ${body}`;

        for (const { pattern, tag } of keywords) {
          if (allText.includes(pattern)) {
            tags.add(tag);
          }
        }
      }

      return Array.from(tags);
    } catch (error) {
      if (error instanceof InboxDeadError) {
        throw error; // Re-throw 410 — inbox is dead, don't mark as skipped
      }
      logger.warn('Settings', `Could not scan inbox ${email} for tags: ${error.message}`);
      return [];
    }
  }

  /**
   * Get all inboxes with their settings
   */
  getInboxes() {
    const settings = this.load();
    return settings.inboxes || [];
  }

  /**
   * Get allowed inboxes
   */
  getAllowedInboxes() {
    const inboxes = this.getInboxes();
    return inboxes.filter(i => i.allowed !== false);
  }

  getRegistrationCandidates() {
    return this.getInboxes().filter(inbox => this.isRegistrationCandidate(inbox));
  }

  /**
   * Get blocked inboxes
   */
  getBlockedInboxes() {
    const inboxes = this.getInboxes();
    return inboxes.filter(i => !i.allowed);
  }

  /**
   * Toggle inbox allowed status
   */
  toggleInbox(email) {
    const inboxes = this.getInboxes();
    const inbox = inboxes.find(i => i.email === email);
    if (inbox) {
      inbox.allowed = !inbox.allowed;
      this.save(inboxes);
      logger.info('Settings', `Toggled inbox ${email} to ${inbox.allowed ? 'allowed' : 'blocked'}`);
      return inbox.allowed;
    }
    return null;
  }

  markInboxTagged(email, tag) {
    const inboxes = this.getInboxes();
    const inbox = inboxes.find(i => i.email === email);
    if (!inbox) return null;

    const tags = new Set(inbox.tags || []);
    tags.add(tag);
    inbox.tags = Array.from(tags);
    inbox.lastScanned = new Date().toISOString();
    this.save(inboxes);
    return inbox;
  }

  markInboxDead(email) {
    const inboxes = this.getInboxes();
    const inbox = inboxes.find(i => i.email === email);
    if (!inbox) return null;

    inbox.dead = true;
    inbox.deadAt = new Date().toISOString();
    this.save(inboxes);
    logger.info('Settings', `Marked inbox ${email} as dead (HTTP 410)`);
    return inbox;
  }

  /**
   * Check if inbox is allowed
   */
  isInboxAllowed(email) {
    const inboxes = this.getInboxes();
    const inbox = inboxes.find(i => i.email === email);
    return inbox ? inbox.allowed : false;
  }

  /**
   * Select a clean inbox (allowed + active + no AWS emails)
   */
  async selectCleanInbox(options = {}) {
    if (!process.env.MAILSTACK_API_KEY) {
      throw new Error('MAILSTACK_API_KEY not configured');
    }

    const mailstack = new MailstackClient(process.env.MAILSTACK_API_KEY);
    const excludedEmails = new Set(options.excludeEmails || []);
    const allowedInboxes = this.getInboxes().filter(inbox =>
      this.isRegistrationCandidate(inbox) && !excludedEmails.has(inbox.email)
    );

    if (allowedInboxes.length === 0) {
      throw new Error('No allowed inboxes available. Check settings.');
    }

    logger.info('Settings', `Checking ${allowedInboxes.length} allowed clean candidate inbox(es) for cleanliness...`);

    // Check only allowed, active, non-Kiro-tagged inboxes.
    for (const inbox of allowedInboxes) {
      try {
        const messages = await mailstack.getMessages(inbox.email, 50);

        const hasBadEmails = messages.some(msg => {
          const subject = (msg.subject || '').toLowerCase();
          const from = (msg.from || '').toLowerCase();
          const fromName = (msg.from_name || '').toLowerCase();
          const allText = `${subject} ${from} ${fromName}`;

          return [
            '.aws', 'signin.aws', 'kiro', 'amazonaws',
            'aws.amazon', 'kiro.dev', 'aws console'
          ].some(kw => allText.includes(kw));
        });

        if (hasBadEmails) {
          logger.info('Settings', `${inbox.email} has previous .aws/kiro emails, skipping`);
          continue;
        }

        logger.success('Settings', `${inbox.email} - clean inbox selected`);
        return inbox;
      } catch (error) {
        if (error instanceof InboxDeadError) {
          logger.error('Settings', `${inbox.email} - account dead (410), marking as dead`);
          this.markInboxDead(inbox.email);
        } else {
          logger.warn('Settings', `Could not check inbox ${inbox.email}: ${error.message}`);
        }
        continue;
      }
    }

    throw new Error('No clean allowed inboxes available');
  }
}

module.exports = new Settings();
