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

The Hub service listens on `PORT` (default `8787`). Configure the desktop app's **Settings → Hub base URL** to the address you want it to use, for example `http://127.0.0.1:8787` for local development.

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

`fixtures/knowledge` is a PyPI-style registry: `{pack-id}/{semver}/pack.json`. The Hub discovers releases by scanning those folders and serves ZIP downloads (`{id}-{version}.zip`). Validate with:

```bash
node scripts/validate-pack-registry.mjs
```

The desktop app does not use fixtures as an offline fallback. See [pack-registry.md](pack-registry.md).

Library **active** packs are the chat retrieval domain; inactive packs remain browsable. Chat `@` mentions focus files/folders under active packs — see [architecture.md](architecture.md).
