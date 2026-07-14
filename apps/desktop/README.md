# Nest Desktop

Tauri v2 + React client for Nest.

```bash
npm install
npm run tauri dev
```

## Highlights

- **Library** — read-only Markdown tree; activate/deactivate packs for chat; search
- **Hub** — versioned catalog, download/upgrade, import local pack zips (`pack.json` required), remove (auto reindex)
- **Chat** — RAG over active packs; `@` mention files/folders to focus; session tabs, history, pin/archive
- **Settings** — OpenAI-compatible LLM + Hub URL (separate Test LLM / Test Hub)

See the [root README](../../README.md) and [docs/](../../docs/) for architecture, pack registry, chat sessions, and development checks.

Copy [`.env.example`](./.env.example) (and optionally [`src-tauri/.env.example`](./src-tauri/.env.example)) if you want `NEST_DEBUG` service logs while developing.
