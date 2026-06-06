# Contributing

Thanks for helping improve Account Auto Linker.

## Development Setup

```bash
npm install
cp .env.example .env
npm test
```

## Before Opening a PR

- Run `npm test`.
- Do not commit `.env`, `.settings.json`, `credentials.json`, `.cache/`, screenshots, or logs.
- Keep user-facing terminal output concise unless it is behind `--verbose` or `--debug`.
- Prefer small, focused changes with clear error handling.

## Code Style

This project is CommonJS JavaScript. Keep modules small, avoid hidden global state where possible, and route reusable terminal UI through `utils/tui.js`.
