# Nest Desktop

Tauri v2 + React client for Nest.

```bash
npm install
npm run tauri dev
```

## Highlights

- **Library** — read-only Markdown tree from downloaded packs
- **Hub** — download / remove packs (auto reindex)
- **Chat** — RAG agent with session tabs, history, pin/archive
- **Settings** — OpenAI-compatible LLM + Hub URL

See the [root README](../../README.md) and [docs/](../../docs/) for architecture, chat sessions, and development checks.

Copy [`.env.example`](./.env.example) (and optionally [`src-tauri/.env.example`](./src-tauri/.env.example)) if you want `NEST_DEBUG` service logs while developing.
