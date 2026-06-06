# Security Policy

## Sensitive Local Files

The following files can contain secrets or personal data and must never be committed:

- `.env`
- `.settings.json`
- `credentials.json`
- `.cache/`
- screenshots and debug logs

## Reporting Issues

If you find a security issue, please report it privately to the maintainer before opening a public issue.

## Pre-Publish Check

Run:

```bash
npm test
rg -n 'ms_live_[a-f0-9]+|auth[_]token|DASHBOARD[_]PASSWORD|credentials[.]json' . \
  --glob '!node_modules/**' \
  --glob '!.cache/**' \
  --glob '!package-lock.json'
```

Any real keys, cookies, passwords, or personal inbox addresses should be removed before publishing.
