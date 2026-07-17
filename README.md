# Nest

Local-first desktop knowledge workspace. Browse immutable Markdown knowledge packs and ask questions with retrieval-augmented chat over an OpenAI-compatible LLM.

## Layout

```
apps/desktop      Tauri v2 + React (Nest desktop client)
apps/hub          NestJS Knowledge Hub (catalog + download)
packages/shared   Shared TypeScript types
fixtures/knowledge  Markdown packs served by the Knowledge Hub
docs/             Architecture and development notes
```

## Prerequisites

- Node.js 20+
- Rust (stable) + Tauri [prerequisites](https://v2.tauri.app/start/prerequisites/)

## Desktop app

```bash
cd apps/desktop
npm install
npm run tauri dev
```

### First-run tips

1. Start the Knowledge Hub (`apps/hub`), then open **Hub** in the desktop app. The **Browse** tab lists the remote registry for download; the **Installed** tab manages everything in your vault (upgrade/remove, with origin badges). Use **Import** to add a local pack `.zip` (must include `pack.json`). Indexing runs automatically after download, import, and remove.
2. Configure an OpenAI-compatible **Base URL**, **API key**, and chat model under **Settings**.
3. In **Library**, keep packs **Active** for chat retrieval (use **+/−** to deactivate). Inactive packs stay browsable under a collapsible section.
4. In **Chat**, ask questions over all active packs, or `@`-mention files/folders under active packs to narrow focus.
5. Chat supports **multiple sessions**: tabs for open chats, History for pin/archive/rename/delete. Session titles are generated after the first reply when still untitled.

## Knowledge Hub

[NestJS](https://nestjs.com/) API served on `PORT` (`8787` by default). Configure the desktop app's **Settings → Hub base URL** to point at this service.

```bash
cd apps/hub
cp .env.example .env
npm install
npm run start:dev
```

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Liveness |
| GET | `/packs` | Versioned project catalog |
| GET | `/packs/:id` | Project + versions |
| GET | `/packs/:id/:version` | Release metadata |
| GET | `/packs/:id/download` | Latest ZIP |
| GET | `/packs/:id/:version/download` | Pinned ZIP |

## Releases

Desktop installers (macOS `.dmg` for Apple Silicon + Intel, Windows `.msi`/`.exe`) are built by GitHub Actions from pushed version tags (`v*`). Bump the app version in `apps/desktop` (all three of `src-tauri/tauri.conf.json`, `package.json`, `src-tauri/Cargo.toml`) and push matching tag `v{version}` to build installers and publish release `v{version}` automatically. See [Development → Releases](docs/development.md#releases).

## Documentation

- [Architecture](docs/architecture.md) — vault, RAG, streaming
- [Pack registry](docs/pack-registry.md) — PyPI-style multi-version Hub
- [Chat sessions](docs/chat-sessions.md) — tabs, history, titles
- [Development](docs/development.md) — env vars, sanity checks, releases

## Design notes

- Markdown-only knowledge
- Local vault + SQLite FTS **and** FastEmbed vector RAG via [Rig](https://github.com/0xPlaygrounds/rig) (`rig-fastembed` + `rig-sqlite`)
- Chat uses a Rig agent with multi-turn history and a `vault_search` tool; completions go to your OpenAI-compatible LLM
- Active packs define the default RAG domain; `@` focus paths narrow retrieval further
- Desktop Nest is a download-only client (no publishing)
- Hub auth and multi-tenant cloud are deferred

## Data locations

App data (vault + `nest.db` + vector DB) lives in the OS app data directory for `com.cyborgoat.nest.app`.
