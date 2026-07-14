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

1. Start the Knowledge Hub (`apps/hub`), then open **Hub** in the desktop app and download a pack. Indexing runs automatically after download (and again after remove).
2. Configure an OpenAI-compatible **Base URL**, **API key**, and chat model under **Settings**.
3. In **Library**, open a file to read it (read-only).
4. Use **scope** on tree items to limit chat retrieval, then ask in **Chat**.
5. Chat supports **multiple sessions**: tabs for open chats, History for pin/archive/rename/delete. Session titles are generated after the first reply when still untitled.

## Knowledge Hub

[NestJS](https://nestjs.com/) API served on port 8787:

```bash
cd apps/hub
cp .env.example .env
npm install
npm run start:dev
```

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Liveness |
| GET | `/packs` | Catalog |
| GET | `/packs/:id` | Metadata |
| GET | `/packs/:id/download` | ZIP of Markdown tree |

## Documentation

- [Architecture](docs/architecture.md) — vault, RAG, streaming
- [Chat sessions](docs/chat-sessions.md) — tabs, history, titles
- [Development](docs/development.md) — env vars and sanity checks

## Scope notes

- Markdown-only knowledge
- Local vault + SQLite FTS **and** FastEmbed vector RAG via [Rig](https://github.com/0xPlaygrounds/rig) (`rig-fastembed` + `rig-sqlite`)
- Chat uses a Rig agent with multi-turn history and a `vault_search` tool; completions still go to your OpenAI-compatible LLM
- Desktop Nest is a download-only client (no publishing)
- Hub auth and multi-tenant cloud are deferred

## Data locations

App data (vault + `nest.db` + vector DB) lives in the OS app data directory for `com.nest.app`.
