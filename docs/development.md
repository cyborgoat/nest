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

The Hub service listens on `PORT` (from `.env`, typically `8787`). Configure the desktop app's **Settings → Hub URL** to the address you want it to use, for example `http://127.0.0.1:8787` for local development. Settings is the gear at the bottom of the far-left activity bar; Account is the user icon directly above it. When no URL is configured, the Hub page's **Configure Hub URL in Settings** action opens Settings and focuses that field automatically.

### Claude Agent development notes

- Claude Agent requires the Claude CLI installed and logged in (`claude` on PATH, or a path configured in Settings → Claude Agent). The desktop app spawns one CLI process per turn with `--mcp-config`, `--append-system-prompt`, and an explicit `--model`.
- Step 2 is implemented and acceptance-tested on native Windows. macOS packaging exists, but Claude Agent is not yet a supported macOS runtime; do not infer support from the generic `.dmg` release job.
- On Windows, `npm run tauri dev` can pick up the Git-bundled `link.exe` and fail the Rust build. Install the Visual Studio C++ Build Tools and launch through a VS-enabled environment if that happens.
- The loopback MCP server (`claude_mcp.rs`) binds `127.0.0.1:0` inside the app process; no extra ports need to be opened. Tool calls are authenticated with a per-turn bearer credential.
- Debugging the webview console: start the app with `$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9222"` and run `node scripts/cdp-watch.cjs` to stream console output and exceptions.

The main runtime seams are:

| Module | Responsibility |
|--------|----------------|
| `chat_backends.rs` | Backend descriptors, availability, modes/models, and selection validation. Keep the UI descriptor-driven when adding another Agent. |
| `chat_runtime.rs` | Per-turn backend dispatch, streaming lifecycle, and turn-end reconciliation. |
| `claude_cli.rs` | Windows CLI discovery, process-tree lifecycle, stream-json parsing, session resume, and native tool events. |
| `claude_mcp.rs` | Authenticated loopback MCP adapter for Nest knowledge capabilities. |
| `knowledge_workspace.rs` | Shared permission rules, staging, effective read/list/search view, and turn finalization. |
| `knowledge_review.rs` | Proposal claims, three-way rebase/apply, journaled writes, and recovery. |
| `vault_reconciliation.rs` | Markdown manifest comparison, persisted workspace health, and awaited reindex. |
| `state.rs` | App-wide operation slot shared by chat, probe/save, reindex, Vault switch, and deletion. |

`BackendId` is an open string identifier in persistence and shared types. Unknown historical IDs must round-trip and produce an unavailable descriptor; they must not be coerced to Nest or rejected during session deserialization. A new backend supplies a descriptor and runtime adapter instead of adding Agent-specific branches to the three composer capsules.

The effective knowledge view is `turn-local staged > pending proposal > disk/index`. All protocol adapters must call `KnowledgeWorkspace`; they must not duplicate path, permission, proposal, or overlay rules. Native Claude file operations bypass staging by design, so every successful, failed, or stopped turn must still run Vault reconciliation before releasing the app-wide operation slot.

Claude tool activity has three stable sources: `nest_mcp`, `external_mcp`, and `claude_native`. A tool named `mcp__<server>__<tool>` outside the reserved `mcp__nest__*` namespace is external MCP activity; it must not produce Nest Sources, permissions, staging, or proposals. Ask launches with a strict MCP config, while Agent keeps user/project MCP discovery open and injects the authenticated `nest` server for the reserved name.

The Settings connection test runs a single real headless Claude turn against an isolated temporary pack: it verifies the CLI launches, the loopback MCP server answers, and one `knowledge_list` call succeeds through Claude before the pack is cleaned up. Save and connect reuses an already-successful report for the same CLI path; it only re-tests when no matching report exists. A fake health call without a real CLI turn is not an acceptable replacement.

### Refreshing the bundled tutorial packs

The `getting-started` and `getting-started-zh-cn` packs are compiled into the desktop
binary (`include_dir!` in `default_pack.rs`) and seeded into the vault once per app-data
directory. Normally they are never re-seeded — markers under the app data dir and the
`sync_state` rows both guard against overwriting. To pick up edited pack content while
iterating on the guides:

1. Rebuild so the binary embeds the new files (`npm run tauri dev` recompiles automatically).
2. Restart the app with the reseed flag:

```powershell
$env:NEST_DEV_RESEED = "1"
npm run tauri dev
```

On startup the app deletes both packs' `sync_state` rows and vault folders, then seeds the
embedded copies fresh. Settings, sessions, and other packs are untouched; existing pack
snapshots are reused. The flag only matters at startup — unset it (or start normally)
afterwards. Pack content edits also need a rebuild even without the flag, because the
files are baked into the binary at compile time.

## Environment

| App | File | Variables |
|-----|------|-----------|
| Hub (`apps/hub`) | `apps/hub/.env.example` | `HOST`, `PORT`, `REGISTRY_PATH`, `DEBUG_MODE`, `CORS_ORIGIN`, `DOWNLOAD_TIMEOUT_MS`, `DATABASE_PATH`, `STAGING_PATH`, `MAX_PACK_UPLOAD_BYTES`, `JWT_SECRET`, `MIN_PASSWORD_LENGTH`, optional `SUPERUSER_*` bootstrap values, and optional `DEFAULT_RESET_PASSWORD` (admin "reset password" action) |
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

1. Bump the version in all three source files (they and the generated lockfiles must match, or the workflow fails):
   - `apps/desktop/src-tauri/tauri.conf.json`
   - `apps/desktop/package.json`
   - `apps/desktop/src-tauri/Cargo.toml`
   - `apps/desktop/package-lock.json`
   - `apps/desktop/src-tauri/Cargo.lock`
2. Commit and push the version bump.
3. After the release commit reaches `main`, create and push an annotated tag `v{version}` (for example `git tag -a v1.2.3 -m "Release v1.2.3" && git push origin v1.2.3`).
4. The workflow runs the desktop frontend and Rust checks, creates or reuses draft release `v{version}`, uploads installers from all runners, then publishes the release.

Notes:

- The workflow fails fast unless the tag points to `main` and exactly matches the desktop version (`v{version}`) in all version and lockfiles.
- A published release is immutable to this workflow. Fixes require another version and tag; only an existing draft may be resumed.
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

Chat **Ask** mode has no write tools. **Agent** mode stages permission-checked Markdown edits as pending proposals. The renderer previews pending content, while the Markdown editor owns the explicit Approve/Reject boundary. When changing the tool protocol, keep the Rust permission and concurrent-change checks authoritative and update the persisted file-change contract and diff UI together; see [chat-sessions.md](chat-sessions.md).
