# Nest

Local-first desktop knowledge workspace. Browse immutable Markdown knowledge packs and ask questions with retrieval-augmented chat over an OpenAI-compatible LLM.

## Layout

```
apps/desktop   Tauri v2 + React (Nest desktop client)
apps/hub       NestJS Knowledge Hub (catalog + download)
packages/shared  Shared TypeScript types
fixtures/knowledge  Sample Markdown packs
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

1. Open **Library** (empty state) or **Settings → Import demo packs** to load fixture knowledge into your local vault and build the search index.
2. Configure an OpenAI-compatible **Base URL**, **API key**, and chat model.
3. Use **Hub** to download individual packs (falls back to fixtures if the hub is offline).
4. In **Library**, open a file to read it (read-only).
5. Use **scope** on tree items to limit chat retrieval, then ask in **Chat**. References appear with every answer.

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

## Phase 1 scope

- Markdown-only knowledge
- Local vault + SQLite chat / lightweight FTS retrieval (no embedding model)
- Chat answers still use your configured OpenAI-compatible LLM
- Desktop Nest is a download-only client (no publishing)
- Hub auth and multi-tenant cloud are deferred

## Data locations

App data (vault + `nest.db`) lives in the OS app data directory for `com.nest.app`.
