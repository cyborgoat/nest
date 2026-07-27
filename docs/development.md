# Development

## Prerequisites

- Node.js 22+
- Rust (stable) + [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/)

## Run

```bash
# Terminal 1 (optional) — Hub service
cd apps/admin
npm install
npm run build

cd apps/hub
cp .env.example .env   # first time
npm install
npm run start:dev

# Terminal 2 — Desktop
cd apps/desktop
npm install
npm run tauri dev
```

The desktop app can start without the Hub service and will still include a bundled first-run `getting-started` pack.

The Hub service listens on `PORT` (from `.env`, typically `8787`). Configure the desktop app's **Settings → Hub URL** to the address you want it to use, for example `http://127.0.0.1:8787` for local development.

## Environment

| App | File | Variables |
|-----|------|-----------|
| Hub (`apps/hub`) | `apps/hub/.env.example` | `HOST`, `PORT`, `REGISTRY_PATH`, `DEBUG_MODE`, `CORS_ORIGIN`, `DOWNLOAD_TIMEOUT_MS`, `DATABASE_PATH`, `STAGING_PATH`, `MAX_PACK_UPLOAD_BYTES`, `JWT_SECRET`, `MIN_PASSWORD_LENGTH`, and optional `SUPERUSER_*` bootstrap values |
| Desktop | `apps/desktop/.env.example` | `NEST_DEBUG` (logs from the Rust side when set for the process) |
| Desktop Tauri | `apps/desktop/src-tauri/.env.example` | `NEST_DEBUG` |

Hub `DEBUG_MODE=true` (or `1` / `yes` / `on`) enables verbose service logging. Desktop `NEST_DEBUG` remains the Rust-side debug flag.

Hub runtime configuration is strict: missing or invalid required values fail startup, and removed aliases are not accepted. After adopting or creating a superuser, its managed marker persists in SQLite; remove `SUPERUSER_PASSWORD` after the initial account is created.

### Development database reset

The current Hub schema is a clean baseline for the account/publishing feature. It does not migrate databases created by pre-feature development builds. Stop Hub and move or delete the file configured by `DATABASE_PATH` (plus its `-wal` and `-shm` companions) once, then restart. Do not apply this reset procedure to data you need to preserve.

## Sanity checks

```bash
# Desktop UI
cd apps/desktop && npm run lint && npm test && npm run build

# Desktop Rust
cd apps/desktop/src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test

# Admin console
cd apps/admin && npm run lint && npm test && npm run build

# Hub (build also rebuilds the admin console into apps/hub/public/admin)
cd apps/hub && npm run lint && npm test -- --runInBand && npm run build && npm run test:e2e -- --runInBand && npm run validate:registry
```

Hub end-to-end tests use `examples/knowledge-packs` as their only registry fixture source. They copy it to an isolated directory under `/tmp`; generated releases, the test database, staging artifacts, and destructive registry-management checks stay inside those temporary paths and are removed after the suite.

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

The canonical `examples/knowledge-packs/getting-started/1.0.0/` tutorial is
compiled into the desktop binary as its first-run pack. Hub can serve the same
content when the example registry is configured.

Bundled pack behavior:

- Seeded once per app-data directory on first launch
- Recorded in `sync_state` as a normal installed pack
- Active by default
- Deletable by the user
- Not automatically re-seeded after deletion

Library **active** packs are the chat retrieval domain; inactive packs remain browsable. Chat `@` mentions focus files/folders under active packs — see [architecture.md](architecture.md).
