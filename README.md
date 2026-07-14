# Nest

Local-first desktop knowledge workspace. Browse immutable Markdown knowledge packs and ask questions with retrieval-augmented chat over an OpenAI-compatible LLM.

## Layout

```
apps/desktop   Tauri v2 + React (Nest desktop client)
apps/hub       NestJS Knowledge Hub (catalog + download)
packages/shared  Shared TypeScript types
fixtures/knowledge  Markdown packs served by the Knowledge Hub
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

1. Start the Knowledge Hub (`apps/hub`), then open **Hub** in the desktop app and download a pack. Indexing runs automatically after download.
2. Configure an OpenAI-compatible **Base URL**, **API key**, and chat model under **Settings**.
3. In **Library**, open a file to read it (read-only).
4. Use **scope** on tree items to limit chat retrieval, then ask in **Chat**. References appear with answers when passages were retrieved.

## Knowledge Hub

[NestJS](https://nestjs.com/) API served on port 8787:

```bash
cd apps/hub
npm install
npm run start:dev
```

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Liveness |
| GET | `/packs` | Catalog |
| GET | `/packs/:id` | Metadata |
| GET | `/packs/:id/download` | ZIP of Markdown tree |

## Phase 1–2 scope

- Markdown-only knowledge
- Local vault + SQLite FTS **and** FastEmbed vector RAG via [Rig](https://github.com/0xPlaygrounds/rig) (`rig-fastembed` + `rig-sqlite`)
- Chat uses a Rig agent with multi-turn history and a `vault_search` tool; completions still go to your OpenAI-compatible LLM
- Desktop Nest is a download-only client (no publishing)
- Hub auth and multi-tenant cloud are deferred

## Data locations

App data (vault + `nest.db`) lives in the OS app data directory for `com.nest.app`.
