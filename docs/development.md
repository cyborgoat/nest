# Development

## Prerequisites

- Node.js 20+
- Rust (stable) + [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/)

## Run

```bash
# Terminal 1 — Knowledge Hub
cd apps/hub
cp .env.example .env   # first time
npm install
npm run start:dev

# Terminal 2 — Desktop
cd apps/desktop
npm install
npm run tauri dev
```

Hub defaults to `http://127.0.0.1:8787`. Point desktop Settings → Hub URL there if needed.

## Environment

| App | File | Variables |
|-----|------|-----------|
| Hub | `apps/hub/.env.example` | `PORT`, `FIXTURES_PATH`, `NEST_DEBUG` |
| Desktop | `apps/desktop/.env.example` | `NEST_DEBUG` (logs from the Rust side when set for the process) |
| Desktop Tauri | `apps/desktop/src-tauri/.env.example` | `NEST_DEBUG` |

`NEST_DEBUG=true` (or `1` / `yes` / `on`) enables verbose service logging.

## Sanity checks

```bash
# Desktop UI
cd apps/desktop && npx tsc --noEmit && npm run build

# Desktop Rust
cd apps/desktop/src-tauri && cargo check && cargo test

# Hub
cd apps/hub && npm run build
```

## Fixtures

`fixtures/knowledge` is the Hub catalog source (`packs.json` + pack directories). The desktop app does not ship a built-in demo importer; download packs from Hub (or Hub’s fixture fallback when the remote Hub is offline).
