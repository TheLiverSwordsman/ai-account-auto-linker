<h1 align="center">
  🧭 Account Auto Linker
</h1>

<p align="center">
  <b>Interactive TUI for Mailstack-backed AWS/Kiro registration and 9router dashboard OAuth login workflows.</b>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-%3E%3D20-339933?logo=node.js&logoColor=white" alt="Node.js >= 20">
  <img src="https://img.shields.io/badge/License-MIT-green" alt="MIT License">
  <img src="https://img.shields.io/badge/UI-Terminal%20TUI-cyan" alt="Terminal TUI">
  <img src="https://img.shields.io/badge/Mail-Mailstack.cc-blue" alt="Mailstack">
  <a href="https://github.com/decolua/9router/"><img src="https://img.shields.io/badge/Dashboard-9router-orange" alt="9router"></a>
</p>

---

## What It Does

Account Auto Linker is a local Node.js automation tool that coordinates:

- **Mailstack inbox discovery** with cached tagging and clean-inbox selection.
- **AWS/Kiro account registration** through the public AWS profile flow.
- **Existing Kiro account login** with Mailstack MFA polling.
- **9router dashboard OAuth authorization** using AWS device-code flow.
- **A keyboard-first TUI** for settings, inbox allow/block lists, worker count, and browser mode.

> [!IMPORTANT]
> Use this project only for accounts and services you own or are authorized to manage. Respect AWS, Kiro, Mailstack, and 9router terms of service. This repository does not grant permission to automate third-party systems without authorization.

---

## Highlights

- 🧭 **Live Settings TUI** — switch tabs with `←/→`, edit in-place with `Space`.
- 📬 **Inbox controls** — allow/block clean Mailstack inboxes and preserve tagged Kiro/AWS inboxes.
- 🧠 **Cache-aware scanning** — `.settings.json` avoids repeatedly scanning known inboxes.
- 🔐 **Config wizard** — prompts for missing Mailstack API key, dashboard URL, and dashboard password.
- ✅ **Validation built in** — checks Mailstack key, dashboard health, and dashboard auth before running.
- 🧾 **Credential management** — local `credentials.json` is ignored and safe examples are included.
- 🧪 **Smoke checks** — `npm test` verifies syntax and project wiring.

---

## Requirements

- Node.js `>=20`
- A **required** Mailstack API key from [`mailstack.cc`](https://mailstack.cc); create one at [`mailstack.cc/dashboard/api-keys`](https://mailstack.cc/dashboard/api-keys)
- A running [9router dashboard](https://github.com/decolua/9router/) instance
- A dashboard password for the 9router API
- Chromium-compatible browser support through Puppeteer

---

## Installation

First install and run [9router](https://github.com/decolua/9router/) so the dashboard API is available. Then clone this repository:

```bash
git clone https://github.com/<your-org>/account-auto-linker.git
cd account-auto-linker
npm install
cp .env.example .env
```

Edit `.env`. A Mailstack API key is required; get one at [`mailstack.cc/dashboard/api-keys`](https://mailstack.cc/dashboard/api-keys):

```dotenv
MAILSTACK_API_KEY=ms_live_your_key_here
DASHBOARD_URL=http://localhost:20128
DASHBOARD_PASSWORD=change-me
KIRO_SIGNUP_URL=https://profile.aws.amazon.com
HEADLESS=false
```

Then run:

```bash
npm run start
```

The first run validates your configuration and prompts for anything missing.

---

## Quick Start

### 1. Open the TUI

```bash
npm run start
```

Choose one of:

- **Login with existing Kiro account** — uses `credentials.json` or `--email/--password`.
- **Full registration** — creates new accounts using clean Mailstack inboxes.
- **Settings** — manages inboxes, workers, and browser mode.

### 2. Configure Settings

Open `Settings` and use the live tab UI:

| Key | Action |
| --- | --- |
| `←` / `→` | Switch between `Inboxes` and `Utilities` tabs |
| `↑` / `↓` | Move inside the active tab |
| `Space` | Toggle the selected inbox or utility option |
| `R` | Refresh Mailstack inboxes in the `Inboxes` tab |
| `Esc` / `Q` | Return to the main menu |

### 3. Run Registration

```bash
npm run register
```

or from the TUI choose **Full registration**.

Before registration starts, the tool asks how many accounts to create. The value cannot exceed the available clean inbox count.

---

## CLI Reference

```bash
node agent/main.js [options]
```

| Option | Description |
| --- | --- |
| `--login`, `-l` | Login with an existing Kiro/AWS account |
| `--register`, `-r` | Run full registration |
| `--dashboard-only`, `-d` | Connect saved accounts to dashboard |
| `--email`, `-e` | Existing account email for login mode |
| `--password`, `-p` | Existing account password for login mode |
| `--mfa`, `-m` | MFA code; omitted means Mailstack polling |
| `--credentials`, `-f` | Use a custom credentials file |
| `--count`, `-n` | Number of accounts to register |
| `--verbose`, `-v` | Show detailed progress |
| `--debug` | Show debug logs and extra diagnostics |

Examples:

```bash
npm run login
node agent/main.js --login --email user@example.com --password 'secret'
node agent/main.js --register --count 3
node agent/main.js --register --debug
```

---

## Local Files

| File | Purpose | Committed? |
| --- | --- | --- |
| `.env` | Local API keys and dashboard credentials | No |
| `.settings.json` | Inbox cache, tags, workers, browser mode | No |
| `credentials.json` | Saved account credentials | No |
| `.cache/` | Screenshots, browser states, debug logs | No |
| `.env.example` | Safe configuration template | Yes |
| `.settings.example.json` | Safe settings example | Yes |
| `credentials.example.json` | Safe credentials example | Yes |

> [!WARNING]
> Never commit `.env`, `.settings.json`, `credentials.json`, `.cache/`, screenshots, or debug logs. They can contain API keys, cookies, personal email addresses, or account passwords.

---

## Architecture

```text
agent/main.js              TUI entrypoint and CLI mode routing
core/KiroAgent.js          Browser/session orchestration
core/signupFlow.js         New AWS/Kiro registration flow
core/awsLoginFlow.js       Existing account login + MFA + OAuth approval
core/dashboardFlow.js      Dashboard-only OAuth connection flow
services/MailstackClient.js Mailstack inbox/message API wrapper
utils/config.js            Interactive configuration wizard and validators
utils/settings.js          Inbox cache, tags, utilities, clean inbox selection
utils/tui.js               Terminal UI widgets and live settings screen
utils/credentials.js       Safe credentials loading/upserting
utils/browserState.js      Browser state snapshots
utils/logger.js            Normal/verbose/debug logging
```

---

## Development

Run syntax and smoke checks:

```bash
npm test
```

Run only syntax checks:

```bash
npm run check
```

Run the smoke check:

```bash
npm run smoke
```

---

## Troubleshooting

### No saved accounts found

Make sure `credentials.json` exists in the project root and contains an array:

```json
[
  {
    "email": "example.account@example.com",
    "password": "replace-with-password",
    "name": "Example User"
  }
]
```

### No available inboxes for registration

Open `Settings → Inboxes`, press `R` to refresh from Mailstack, then allow clean inboxes. Tagged inboxes like `[KIRO]` remain read-only and allowed so the tool does not re-use them for fresh registration.

### Dashboard validation fails

Make sure [9router](https://github.com/decolua/9router/) is installed and running, then check that the API is reachable:

```bash
curl http://localhost:20128/api/health
```

Then confirm `DASHBOARD_URL` and `DASHBOARD_PASSWORD` in `.env`.

### Browser is too noisy

Open `Settings → Utilities` and set browser mode to `Headless`. For debugging, keep it `Headed`.

---

## Roadmap

- [x] Live tabbed settings UI
- [x] Mailstack API key validation
- [x] Dashboard URL/password validation
- [x] Credentials examples and publish-safe ignores
- [x] Multi-account registration count guard
- [x] Worker-count setting
- [ ] Structured unit tests around settings and credentials helpers
- [ ] Optional JSON report output for CI-style runs
- [ ] Provider adapters beyond Mailstack

---

## Security Notes

This project stores sensitive data locally by design. The `.gitignore` is configured to exclude local secrets and runtime artifacts, but you should still review files before publishing.

Recommended pre-push check:

```bash
rg -n "ms_live_[a-f0-9]+|DASHBOARD[_]PASSWORD|auth[_]token|credentials[.]json" . \
  --glob '!node_modules/**' \
  --glob '!package-lock.json'
```

---

## License

Account Auto Linker is licensed under the [MIT License](LICENSE).

---

## Disclaimer

This repository is provided for legitimate account-management and automation workflows only. You are responsible for complying with all applicable laws, service terms, rate limits, and account policies. The maintainers are not responsible for misuse or for service-side changes that affect automation behavior.
