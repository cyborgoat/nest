# Nest

Local-first desktop knowledge workspace. Browse immutable Markdown knowledge packs and ask questions with retrieval-augmented chat over an OpenAI-compatible LLM.

Nest ships with a bundled default knowledge pack (`getting-started`) on first launch so users can learn the app immediately, even before connecting to a remote Hub.

## Layout

```
apps/desktop      Tauri v2 + React (Nest desktop client)
apps/hub          NestJS Hub API (accounts, publishing, registry, messages)
apps/admin        React operations console served by Hub at /admin
packages/shared   Shared TypeScript types
examples/knowledge-packs  Example Markdown packs served by the Hub service
docs/             Architecture and development notes
```

## Prerequisites

- Node.js 22+
- Rust (stable) + Tauri [prerequisites](https://v2.tauri.app/start/prerequisites/)

## Desktop app

```bash
cd apps/desktop
npm install
npm run tauri dev
```

### First-run tips

1. Open **Library** and start with the bundled **Getting Started** pack. It is preinstalled on first run, active by default, and can be removed any time.
2. Configure an OpenAI-compatible **Base URL**, **API key**, and chat model under **Settings**.
3. (Optional) Start the Hub service (`apps/hub`), then open **Hub** in the desktop app. The **Browse** tab lists the remote registry for download; the **Installed** tab manages everything in your local vault. Use **Import** to add a local pack `.zip` (must include `pack.json`). Indexing is queued in the background after download, import, replacement, and removal.
4. In **Library**, keep packs **Active** for chat retrieval (use **+/−** to deactivate). Inactive packs stay browsable under a collapsible section.
5. In **Chat**, ask questions over all active packs, or `@`-mention files/folders under active packs to narrow focus.
6. Chat supports **multiple sessions**: tabs for open chats, History for pin/archive/rename/delete. Session titles are generated after the first reply when still untitled.

### Markdown support in the app

- GitHub Flavored Markdown (tables, task lists, strikethrough, autolinks)
- Fenced code blocks with syntax highlighting (common languages)
- Mermaid diagrams via fenced `mermaid` blocks
- Relative and absolute image references, including inline SVG

## Hub service

[NestJS](https://nestjs.com/) API served on `HOST`/`PORT` from `.env` (see `apps/hub/.env.example`). Configure the desktop app's **Settings → Hub URL** to point at this service.

```bash
cd apps/admin
npm install
npm run build

cd apps/hub
cp .env.example .env
npm install
npm run start:dev
```

Public catalog and download routes remain anonymous. Accounts are only needed to publish or access restricted packs. See the complete [Hub API reference](docs/hub-api.md).

## Releases

Desktop installers (macOS `.dmg` for Apple Silicon + Intel, Windows `.msi`/`.exe`) are built by GitHub Actions from pushed version tags (`v*`). Bump the app version in `apps/desktop` (all three of `src-tauri/tauri.conf.json`, `package.json`, `src-tauri/Cargo.toml`) and push matching tag `v{version}` to build installers and publish release `v{version}` automatically. See [Development → Releases](docs/development.md#releases).

## Documentation

- [Architecture](docs/architecture.md) — vault, RAG, streaming
- [Pack registry](docs/pack-registry.md) — PyPI-style multi-version registry
- [Hub API](docs/hub-api.md) — authentication, publishing, messages, and administration
- [Chat sessions](docs/chat-sessions.md) — tabs, history, titles
- [Development](docs/development.md) — env vars, sanity checks, releases

## Design notes

- Markdown-only knowledge
- Local vault + SQLite FTS **and** FastEmbed vector RAG via [Rig](https://github.com/0xPlaygrounds/rig) (`rig-fastembed` + `rig-sqlite`); the embedding model ships bundled in the binary, so retrieval works fully offline with no first-run download
- Chat performs local hybrid retrieval before one Rig streaming completion; completions go to your OpenAI-compatible LLM
- Active packs define the default RAG domain; `@` focus paths narrow retrieval and directly load bounded Markdown content (including folders) while indexing catches up
- Desktop use remains login-free; an optional Hub account is used only for publishing and restricted packs.
- Registered authors submit local packs and new versions for administrator review.
- Hub serves an admin/superuser operations console at `/admin` for reviews, roles, visibility, access grants, and release management.

The bundled `getting-started` pack is seeded once per app data directory and is not reinstalled automatically after deletion.

## Data locations

App data (vault + `nest.db` + vector DB) lives in the OS app data directory for `com.cyborgoat.nest.app`.
