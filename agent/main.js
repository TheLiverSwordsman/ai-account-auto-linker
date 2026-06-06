#!/usr/bin/env node
/**
 * Account Auto Linker - Entry point
 *
 * Provides interactive TUI and CLI modes for AWS/Kiro account management.
 */

const { KiroAgent } = require('../core/KiroAgent');
const { parseArgs, loadSavedCredentials } = require('../utils/cli');
const logger = require('../utils/logger');
const tui = require('../utils/tui');
const configHelper = require('../utils/config');
const settings = require('../utils/settings');

async function handleLogin(args) {
  let email = args.email;
  let password = args.password;

  // If no credentials provided, show account picker
  if (!email || !password) {
    const accounts = loadSavedCredentials(args.credentialsFile);

    if (accounts.length === 0) {
      tui.error('No saved accounts found.');
      tui.substep('Run the agent first or provide --email and --password');
      process.exit(1);
    }

    const selected = await tui.selectAccount(accounts);
    if (!selected) {
      tui.warning('Login cancelled');
      process.exit(0);
    }

    email = selected.email;
    password = selected.password;
  }

  tui.step(`Logging in as ${email}`);

  const agent = new KiroAgent();
  try {
    await agent.setupBrowser();
    const result = await agent.performAwsLogin(email, password, args.mfa);

    await agent.cleanup();

    if (result.success) {
      tui.success('Login successful!');
      tui.substep(`Email: ${email}`);
      tui.substep('Account registered on dashboard');
      process.exit(0);
    } else {
      tui.error('Login failed');
      process.exit(1);
    }
  } catch (error) {
    tui.error(`Login failed: ${error.message}`);
    await agent.cleanup();
    process.exit(1);
  }
}

async function handleDashboardOnly(args) {
  const credentialsList = loadSavedCredentials(args.credentialsFile);

  if (credentialsList.length === 0) {
    tui.error('No saved credentials found');
    tui.substep('Run the agent first or specify --credentials <file>');
    process.exit(1);
  }

  tui.step(`Connecting ${credentialsList.length} account(s) to dashboard`);

  const agent = new KiroAgent();
  const result = await agent.runDashboardOnly(credentialsList);

  if (result.success) {
    tui.success('All accounts connected to dashboard');
  } else {
    tui.error('Some accounts failed to connect');
  }

  process.exit(result.success ? 0 : 1);
}

async function handleSettings() {
  await tui.settingsTabs({
    inboxes: settings.getInboxes(),
    utilities: settings.getUtilities(),
    getInboxes: () => settings.getInboxes(),
    getUtilities: () => settings.getUtilities(),
    toggleInbox: email => settings.toggleInbox(email),
    saveUtilities: utilities => settings.saveUtilities(utilities),
    refreshInboxes: () => settings.fetchAndMergeInboxes()
  });
}

async function handleFullRegistration(args = {}) {
  const utilities = settings.getUtilities();
  let candidates = settings.getRegistrationCandidates();

  if (candidates.length === 0) {
    tui.step('Refreshing Mailstack inbox settings');
    await settings.fetchAndMergeInboxes();
    candidates = settings.getRegistrationCandidates();
  }

  if (candidates.length === 0) {
    tui.error('No available inboxes for registration');
    tui.substep('Enable clean inboxes in Settings → Inboxes');
    process.exit(1);
  }

  const requestedCount = Number.isInteger(args.count) && args.count > 0
    ? args.count
    : await tui.registrationCount(candidates.length, 1);
  if (requestedCount > candidates.length) {
    tui.error(`Requested ${requestedCount}, but only ${candidates.length} inbox(es) are available`);
    process.exit(1);
  }

  tui.step(`Starting full registration (${requestedCount} account${requestedCount === 1 ? '' : 's'})`);
  const workerCount = Math.min(Math.max(1, utilities.workers || 1), requestedCount);
  tui.substep(`Workers: ${workerCount}`);
  tui.substep(`Browser: ${utilities.headless ? 'headless' : 'headed'}`);

  tui.step(`Selecting ${requestedCount} clean inbox(es)`);
  const selectedInboxes = [];

  for (let index = 0; index < requestedCount; index++) {
    const inbox = await settings.selectCleanInbox({
      excludeEmails: selectedInboxes.map(item => item.email)
    });
    selectedInboxes.push(inbox);
    tui.substep(`${index + 1}/${requestedCount}: ${inbox.email}`);
  }

  const results = new Array(selectedInboxes.length);
  let nextIndex = 0;

  async function runWorker(workerId) {
    while (nextIndex < selectedInboxes.length) {
      const index = nextIndex++;
      const inbox = selectedInboxes[index];

      tui.divider();
      tui.step(`Worker ${workerId}: registration ${index + 1}/${requestedCount}`);

      const agent = new KiroAgent({ headless: utilities.headless });
      const result = await agent.run({ inbox });
      results[index] = result;

      if (result.success) {
        settings.markInboxTagged(result.credentials.email, 'kiro');
        tui.success(`Registration ${index + 1}/${requestedCount} complete`);
        tui.substep(`Email: ${result.credentials.email}`);
      } else {
        tui.error(`Registration ${index + 1}/${requestedCount} failed: ${result.error}`);
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, (_, index) => runWorker(index + 1)));

  const successful = results.filter(result => result?.success);
  const failed = results.filter(result => !result?.success);

  if (successful.length > 0) {
    tui.success(`Registered ${successful.length}/${requestedCount} account(s)`);
    successful.forEach(result => tui.substep(result.credentials.email));
  } else {
    tui.error('No accounts were registered');
  }

  process.exit(failed.length === 0 && successful.length === requestedCount ? 0 : 1);
}

async function main() {
  // Parse CLI arguments first
  const args = parseArgs();

  // Set log level based on flags
  if (args.debug) {
    logger.setLogLevel('debug');
  } else if (args.verbose) {
    logger.setLogLevel('verbose');
  } else {
    logger.setLogLevel('normal');
  }

  // Initialize logger
  logger.init();
  logger.info('Main', 'Account Auto Linker starting', {
    nodeVersion: process.version,
    pid: process.pid,
    logLevel: logger.logLevel
  });

  // Check and configure required settings interactively if missing
  if (!args.skipConfig) {
    await configHelper.checkConfiguration();
  }

  // Handle Ctrl+C gracefully
  process.on('SIGINT', () => {
    logger.warn('Main', 'Process interrupted by user');
    console.log('\n⚠️  Interrupted');
    process.exit(130);
  });

  logger.info('Main', 'Parsed CLI arguments', { args });

  // If a specific mode is requested via CLI flags, run it directly
  if (args.loginMode) {
    await handleLogin(args);
  } else if (args.dashboardOnly) {
    await handleDashboardOnly(args);
  } else if (args.registerMode) {
    await handleFullRegistration(args);
  } else {
    // Interactive TUI mode
    tui.header();

    let running = true;
    while (running) {
      const action = await tui.mainMenu();

      if (!action || action === 'exit') {
        running = false;
        console.log('\n');
        break;
      }

      tui.divider();

      try {
        if (action === 'login') {
          await handleLogin(args);
        } else if (action === 'register') {
          await handleFullRegistration(args);
        } else if (action === 'settings') {
          await handleSettings();
        }
      } catch (error) {
        tui.error(`Operation failed: ${error.message}`);
        await tui.pause();
      }

      tui.divider();
    }
  }
}

module.exports = { KiroAgent };

if (require.main === module) {
  main();
}
