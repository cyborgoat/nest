# Development

## Prerequisites

- Node.js 20+
- Rust (stable) + [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/)

## Run

```bash
# Terminal 1 (optional) — Knowledge Hub
cd apps/hub
cp .env.example .env   # first time
npm install
npm run start:dev

# Terminal 2 — Desktop
cd apps/desktop
npm install
npm run tauri dev
```

The desktop app can start without the Hub and will still include a bundled first-run `getting-started` pack.

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

## Releases

`.github/workflows/release.yml` builds unsigned installers — macOS `.dmg` (Apple Silicon + Intel) and Windows `.msi`/NSIS `.exe` — for a `v*` tag and publishes the GitHub Release for that tag when all builds succeed.

To cut a release:

1. Bump the version in all three files (they must match, the workflow fails otherwise):
   - `apps/desktop/src-tauri/tauri.conf.json`
   - `apps/desktop/package.json`
   - `apps/desktop/src-tauri/Cargo.toml`
2. Commit and push the version bump.
3. Create and push tag `v{version}` (for example `git tag v1.2.3 && git push origin v1.2.3`).
4. The workflow creates or reuses release `v{version}`, uploads installers from all runners, then publishes the release.

Notes:

- The workflow fails fast if the pushed tag does not exactly match the desktop version (`v{version}`) from the three version files.
- The workflow can also be run manually from **Actions → Release → Run workflow** for testing.
- Builds are unsigned: macOS users need right-click → Open (or `xattr -dr com.apple.quarantine`) on first launch; Windows shows a SmartScreen prompt.

## Examples

`examples/knowledge-packs` is a PyPI-style registry: `{pack-id}/{semver}/pack.json`. The Hub discovers releases by scanning those folders and serves ZIP downloads (`{id}-{version}.zip`). Validate with:

```bash
node scripts/validate-pack-registry.mjs
```

The desktop app does not use Hub examples as an offline fallback for Hub connectivity. Instead, it ships an embedded first-run `getting-started` pack from `apps/desktop/src-tauri/resources/default-packs/getting-started/1.0.0/`.

Bundled pack behavior:

- Seeded once per app-data directory on first launch
- Recorded in `sync_state` as a normal installed pack
- Active by default
- Deletable by the user
- Not automatically re-seeded after deletion

Library **active** packs are the chat retrieval domain; inactive packs remain browsable. Chat `@` mentions focus files/folders under active packs — see [architecture.md](architecture.md).
