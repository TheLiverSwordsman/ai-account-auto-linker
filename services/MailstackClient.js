const axios = require('axios');

const BASE_URL = 'https://api.mailstack.cc/v1';

class MailstackClient {
  constructor(apiKey) {
    this.client = axios.create({
      baseURL: BASE_URL,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });
  }

  async getInboxes() {
    const { data } = await this.client.get('/inboxes');
    // API returns { inboxes: [...] } — confirmed via curl
    return data.inboxes || data.accounts || [];
  }

  async getMessages(email, limit = 50) {
    const { data } = await this.client.get(`/inboxes/${encodeURIComponent(email)}/messages`, {
      params: { limit, folder: 'inbox' }
    });
    return data.messages || [];
  }

  async getMessage(email, messageId) {
    const { data } = await this.client.get(`/inboxes/${encodeURIComponent(email)}/messages/${messageId}`);
    return data.message;
  }

  /**
   * Select a clean inbox — one that has NO previous .aws/kiro/amazonaws emails.
   * Accepts "active", "polling", and "available" statuses.
   */
  async selectCleanInbox() {
    const inboxes = await this.getInboxes();

    const activeInboxes = inboxes.filter(i =>
      i.status === 'active' || i.status === 'polling' || i.status === 'available'
    );

    if (activeInboxes.length === 0) {
      throw new Error('No active Mailstack inboxes available');
    }

    console.log(`   📬 Found ${activeInboxes.length} active inbox(es), checking cleanliness...`);

    for (const inbox of activeInboxes) {
      try {
        const messages = await this.getMessages(inbox.email, 50);

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
          console.log(`   ❌ ${inbox.email} — has previous .aws/kiro emails, skipping`);
          continue;
        }

        console.log(`   ✅ ${inbox.email} — clean inbox selected`);
        return inbox;
      } catch (error) {
        console.log(`   ⚠️  Could not check inbox ${inbox.email}: ${error.message}`);
        continue;
      }
    }

    throw new Error('No clean inboxes available — all active inboxes have previous .aws/kiro emails');
  }

  async waitForVerificationCode(email, subjectMatch, timeoutMs = 120000, pollIntervalMs = 5000) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      try {
        const messages = await this.getMessages(email, 10);
        const verificationEmail = messages.find(msg =>
          msg.subject.toLowerCase().includes(subjectMatch.toLowerCase()) &&
          msg.unread
        );

        if (verificationEmail) {
          const fullMessage = await this.getMessage(email, verificationEmail.id);
          const code = this.extractCode(fullMessage);

          if (code) {
            await this.markAsRead(email, verificationEmail.id);
            return code;
          }
        }
      } catch (error) {
        console.log('   Polling error (will retry):', error.message);
      }

      await this.sleep(pollIntervalMs);
    }

    throw new Error(`Verification email not received within ${timeoutMs}ms`);
  }

  /**
   * Poll for an MFA/OTP code email — used for AWS login MFA step.
   * Looks for recent unread emails with OTP/MFA patterns.
   * @param {string} email - inbox email to poll
   * @param {number} timeoutMs - max wait time (default 120s)
   * @param {number} pollIntervalMs - poll interval (default 3s, faster than verification)
   * @param {string|null} afterTimestamp - only consider emails received after this ISO timestamp
   */
  async waitForMfaCode(email, timeoutMs = 120000, pollIntervalMs = 3000, afterTimestamp = null) {
    const startTime = Date.now();
    console.log(`   📬 Polling Mailstack for MFA code (timeout: ${timeoutMs / 1000}s)...`);

    while (Date.now() - startTime < timeoutMs) {
      try {
        const messages = await this.getMessages(email, 10);

        for (const msg of messages) {
          // Skip read messages
          if (!msg.unread) continue;

          // Skip if older than our cutoff
          if (afterTimestamp && msg.received_at && new Date(msg.received_at) < new Date(afterTimestamp)) continue;

          const subject = (msg.subject || '').toLowerCase();
          const from = (msg.from || '').toLowerCase();
          const fromName = (msg.from_name || '').toLowerCase();
          const allMeta = `${subject} ${from} ${fromName}`;

          // Check if it looks like an MFA/OTP email
          const isMfaEmail = [
            'verification', 'verify', 'code', 'otp', 'mfa', 'one-time',
            'one time', 'security code', 'sign-in', 'sign in', 'login',
            'authentication', 'auth code', 'passcode'
          ].some(kw => allMeta.includes(kw));

          if (!isMfaEmail) continue;

          console.log(`   📨 Found candidate MFA email: "${msg.subject}"`);
          const fullMessage = await this.getMessage(email, msg.id);
          const code = this.extractMfaCode(fullMessage);

          if (code) {
            await this.markAsRead(email, msg.id);
            console.log(`   ✅ MFA code extracted: ${code}`);
            return code;
          }
        }
      } catch (error) {
        console.log('   ⚠️  MFA poll error (will retry):', error.message);
      }

      await this.sleep(pollIntervalMs);
    }

    throw new Error(`MFA code email not received within ${timeoutMs}ms`);
  }

  extractCode(message) {
    const body = message.body || '';
    const html = message.html || '';
    const content = message.content || '';

    const textToSearch = `${body} ${html} ${content}`;

    // AWS-specific patterns FIRST (most reliable)
    const awsPatterns = [
      /class="code"[^>]*>(\d{4,8})</i,
      /Verification code:\s*(\d{4,8})/i,
      /verification.*?(\d{6})/is
    ];

    for (const pattern of awsPatterns) {
      const match = textToSearch.match(pattern);
      if (match && match[1]) {
        console.log(`   📧 Extracted code using AWS pattern: ${match[1]}`);
        return match[1];
      }
    }

    // Generic patterns (fallback)
    const genericPatterns = [
      /code[:\s]+(\d{4,8})/i,
      /pin[:\s]+(\d{4,8})/i,
      /otp[:\s]+(\d{4,8})/i
    ];

    for (const pattern of genericPatterns) {
      const match = textToSearch.match(pattern);
      if (match && match[1]) {
        console.log(`   📧 Extracted code using generic pattern: ${match[1]}`);
        return match[1];
      }
    }

    return null;
  }

  /**
   * Extract MFA/OTP code from email — prioritizes OTP patterns common in AWS MFA emails.
   */
  extractMfaCode(message) {
    const body = message.body || '';
    const html = message.html || '';
    const content = message.content || '';
    const textToSearch = `${body} ${html} ${content}`;

    // AWS MFA specific patterns (high confidence)
    const mfaPatterns = [
      // "Your one-time password is 123456"
      /one[- ]time\s*(?:password|passcode|code)\s*(?:is\s*)?(\d{4,8})/i,
      // "Your verification code is 123456"
      /verification\s*code\s*(?:is\s*)?(\d{4,8})/i,
      // "Your code: 123456" or "Code: 123456"
      /(?:your\s+)?code[:\s]+(\d{4,8})/i,
      // "OTP: 123456" or "Passcode: 123456"
      /(?:otp|passcode|pin|mfa)[:\s]+(\d{4,8})/i,
      // "Security code: 123456"
      /security\s*code[:\s]+(\d{4,8})/i,
      // "sign-in code: 123456"
      /sign[- ]?in\s*code[:\s]+(\d{4,8})/i,
      // class="code" in HTML (AWS uses this)
      /class="code"[^>]*>(\d{4,8})</i,
      // Large bold number standalone (common in MFA emails)
      />(\d{6})</,
      // Generic: find a standalone 6-digit number
      /\b(\d{6})\b/
    ];

    for (const pattern of mfaPatterns) {
      const match = textToSearch.match(pattern);
      if (match && match[1]) {
        console.log(`   🔢 MFA code extracted: ${match[1]}`);
        return match[1];
      }
    }

    console.log('   ⚠️  Could not extract MFA code from email');
    return null;
  }

  async markAsRead(email, messageId) {
    await this.client.put(`/inboxes/${encodeURIComponent(email)}/messages/${messageId}/read`);
  }

  async deleteMessage(email, messageId) {
    await this.client.delete(`/inboxes/${encodeURIComponent(email)}/messages/${messageId}`);
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = MailstackClient;
