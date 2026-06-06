const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..');
const DEFAULT_CREDENTIALS_PATH = path.join(PROJECT_ROOT, 'credentials.json');

function parseCredentialsText(raw) {
  const text = String(raw || '').trim();
  if (!text) return [];

  const attempts = [
    text,
    `[${text}]`,
    `[${text.replace(/,\s*$/, '')}]`
  ];

  for (const candidate of attempts) {
    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed)) return parsed;
      if (parsed && typeof parsed === 'object') return [parsed];
    } catch (_) {}
  }

  throw new Error('credentials.json is not valid JSON');
}

function normalizeAccount(account, source = 'credentials.json') {
  if (!account || !account.email || !account.password) return null;

  return {
    ...account,
    email: account.email,
    password: account.password,
    name: account.name || account.fullName || 'Unknown',
    source
  };
}

function readCredentialsFile(filePath = DEFAULT_CREDENTIALS_PATH) {
  if (!fs.existsSync(filePath)) return [];

  const raw = fs.readFileSync(filePath, 'utf8');
  return parseCredentialsText(raw)
    .map(account => normalizeAccount(account, path.basename(filePath)))
    .filter(Boolean);
}

function writeCredentialsFile(accounts, filePath = DEFAULT_CREDENTIALS_PATH) {
  const cleanAccounts = accounts.map(({ source, ...account }) => account);
  fs.writeFileSync(filePath, JSON.stringify(cleanAccounts, null, 2));
}

function upsertCredential(account, filePath = DEFAULT_CREDENTIALS_PATH) {
  const accounts = readCredentialsFile(filePath);
  const normalized = normalizeAccount(account, path.basename(filePath));

  if (!normalized) {
    throw new Error('Cannot save credentials without email and password');
  }

  const withoutExisting = accounts.filter(existing => existing.email !== normalized.email);
  withoutExisting.push(normalized);
  writeCredentialsFile(withoutExisting, filePath);
  return filePath;
}

module.exports = {
  PROJECT_ROOT,
  DEFAULT_CREDENTIALS_PATH,
  parseCredentialsText,
  readCredentialsFile,
  writeCredentialsFile,
  upsertCredential
};
