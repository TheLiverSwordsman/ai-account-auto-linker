#!/usr/bin/env node
/**
 * Lightweight smoke check for local project wiring.
 *
 * This file intentionally does not contain real credentials. For an end-to-end
 * browser run, use `npm run start`, configure `.env`, and select an account in
 * the interactive TUI.
 */

const { loadSavedCredentials } = require('./utils/cli');
const settings = require('./utils/settings');

function main() {
  const accounts = loadSavedCredentials();
  const utilities = settings.getUtilities();

  console.log('Account Auto Linker smoke check');
  console.log(`- Saved accounts: ${accounts.length}`);
  console.log(`- Workers: ${utilities.workers}`);
  console.log(`- Browser mode: ${utilities.headless ? 'headless' : 'headed'}`);
  console.log('✓ Project wiring loaded successfully');
}

main();
