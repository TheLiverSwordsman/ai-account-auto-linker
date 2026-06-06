const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { DEFAULT_CREDENTIALS_PATH, readCredentialsFile } = require('./credentials');
const tui = require('./tui');

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = { dashboardOnly: false, connectOnly: false, loginMode: false, verbose: false, debug: false, registerMode: false };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dashboard-only' || args[i] === '--d') parsed.dashboardOnly = true;
    if (args[i] === '--connect' || args[i] === '--connect-only' || args[i] === '-c') parsed.connectOnly = true;
    if (args[i] === '--login' || args[i] === '-l') parsed.loginMode = true;
    if (args[i] === '--register' || args[i] === '-r') parsed.registerMode = true;
    if (args[i] === '--verbose' || args[i] === '-v') parsed.verbose = true;
    if (args[i] === '--debug') parsed.debug = true;
    if ((args[i] === '--credentials' || args[i] === '-f') && args[i + 1]) { parsed.credentialsFile = args[i + 1]; i++; }
    if ((args[i] === '--count' || args[i] === '-n') && args[i + 1]) { parsed.count = parseInt(args[i + 1], 10); i++; }
    if ((args[i] === '--email' || args[i] === '-e') && args[i + 1]) { parsed.email = args[i + 1]; i++; }
    if ((args[i] === '--password' || args[i] === '-p') && args[i + 1]) { parsed.password = args[i + 1]; i++; }
    if ((args[i] === '--mfa' || args[i] === '-m') && args[i + 1]) { parsed.mfa = args[i + 1]; i++; }
    if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
Account Auto Linker

Usage: node agent/main.js [options]

Modes:
  (no flags)             Interactive TUI menu
  -l, --login            Login to existing AWS account
  -r, --register         Full registration (new AWS account)
  -d, --dashboard-only   Connect saved accounts to dashboard

Options:
  -e, --email EMAIL      AWS account email
  -p, --password PWD     AWS account password
  -m, --mfa CODE         MFA code (optional — auto-polls if omitted)
  -f, --credentials FILE Use specific credentials file
  -n, --count NUMBER     Number of accounts to register
  -v, --verbose          Show detailed progress
      --debug            Show all debug output
  -h, --help             Show this help message

Examples:
  node agent/main.js                          Interactive TUI
  node agent/main.js --login                  Login (pick account)
  node agent/main.js --login -v               Login with verbose output
  node agent/main.js --login --debug          Login with full debug
  node agent/main.js --register               Full registration
`);
      process.exit(0);
    }
  }
  return parsed;
}

function loadSavedCredentials(credentialsFile) {
  const candidates = [];
  if (credentialsFile) candidates.push(path.resolve(credentialsFile));

  const defaultCreds = DEFAULT_CREDENTIALS_PATH;
  if (fs.existsSync(defaultCreds)) candidates.push(defaultCreds);

  const cacheDir = path.join(__dirname, '..', '.cache');
  if (fs.existsSync(cacheDir)) {
    const files = fs.readdirSync(cacheDir).filter(f => f.endsWith('.json'));
    files.forEach(f => candidates.push(path.join(cacheDir, f)));
  }

  const accounts = [];
  for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) continue;
    try {
      accounts.push(...readCredentialsFile(filePath));
    } catch (e) {}
  }

  const seen = new Set();
  return accounts.filter(a => {
    if (seen.has(a.email)) return false;
    seen.add(a.email);
    return true;
  });
}

function promptAccountPicker(accounts) {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    console.log('');
    tui.printBox('Select AWS Account to Login', { width: 44, align: 'center' });
    console.log('');

    accounts.forEach((acc, i) => {
      const name = acc.name !== 'Unknown' ? ` (${acc.name})` : '';
      console.log(`  [${i + 1}] ${acc.email}${name}`);
      console.log(`      └─ from: ${acc.source}`);
    });

    console.log(`\n  [0] Cancel\n`);

    rl.question('  Pick account number: ', (answer) => {
      rl.close();
      const num = parseInt(answer.trim(), 10);
      if (num === 0 || isNaN(num) || num < 1 || num > accounts.length) {
        reject(new Error('Cancelled or invalid selection'));
      } else {
        resolve(accounts[num - 1]);
      }
    });
  });
}

module.exports = { parseArgs, loadSavedCredentials, promptAccountPicker };
