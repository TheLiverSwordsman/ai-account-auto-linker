# Account Auto Linker Tutorial

This tutorial walks through a clean first-time setup, configuring inboxes, and running a full registration.

## 1. Install

Install and run [9router](https://github.com/decolua/9router/) first, then install this project:

```bash
npm install
cp .env.example .env
```

## 2. Configure `.env`

Set these values. `MAILSTACK_API_KEY` is required; get it from [`mailstack.cc/dashboard/api-keys`](https://mailstack.cc/dashboard/api-keys):

```dotenv
MAILSTACK_API_KEY=ms_live_your_key_here
DASHBOARD_URL=http://localhost:20128
DASHBOARD_PASSWORD=change-me
KIRO_SIGNUP_URL=https://profile.aws.amazon.com
HEADLESS=false
```

Run the app:

```bash
npm run start
```

The configuration wizard validates:

1. Mailstack API key
2. [9router](https://github.com/decolua/9router/) dashboard URL connectivity
3. Dashboard password authentication

## 3. Configure Inboxes

Open `Settings`.

Use:

- `←/→` to switch tabs
- `R` on `Inboxes` to refresh Mailstack inboxes
- `↑/↓` to select an inbox
- `Space` to allow/block clean inboxes

Tagged inboxes such as `[KIRO]` are read-only. They remain allowed in the UI, but they are not selected for fresh registration.

## 4. Configure Utilities

Switch to `Utilities`.

- Select `Workers`, then press `Space` to cycle `1 → 10 → 1`.
- Select `Browser mode`, then press `Space` to toggle `Headed`/`Headless`.

Use `Headed` when debugging. Use `Headless` for quieter runs.

## 5. Run Full Registration

From the main menu, choose `Full registration`.

The app asks how many accounts to register. It will not allow a number greater than the available clean inbox count.

During each registration, the flow:

1. Authenticates with the 9router dashboard.
2. Requests an AWS/Kiro device code.
3. Opens the AWS profile signup flow.
4. Uses a clean Mailstack inbox.
5. Polls Mailstack for verification codes.
6. Clicks `Confirm and Continue` and `Allow Access` at the end of OAuth.
7. Saves credentials locally in `credentials.json`.
8. Marks the inbox with `[KIRO]` in `.settings.json`.

## 6. Login Existing Accounts

If `credentials.json` contains saved accounts, choose `Login with existing Kiro account`.

You can also run:

```bash
node agent/main.js --login --email example.account@example.com --password 'your-password'
```

If MFA is required, the app can poll Mailstack automatically.

## 7. Verify Before Publishing

Before pushing publicly, run:

```bash
npm test
rg -n "ms_live_[a-f0-9]+|auth[_]token|DASHBOARD[_]PASSWORD|credentials[.]json" . --glob '!node_modules/**'
```

Make sure `.env`, `.settings.json`, `credentials.json`, `.cache/`, screenshots, and logs are not committed.
