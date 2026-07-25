# Nest Desktop

Tauri v2 + React client for Nest.

```bash
npm install
npm run tauri dev
```

## Highlights

- **Library** — read-only Markdown tree; activate/deactivate packs for chat; search
- **Hub** — public/restricted catalog, download/upgrade, local pack import, and owner publishing actions
- **Messages** — durable Hub publish-submitted, approved, and rejected notifications in a compact list with unread markers, per-row mark-read/delete, bulk actions, and a manual refresh button (plus 30s background polling)
- **Chat** — RAG over active packs; `@` mention files/folders to focus; session tabs, history, pin/archive
- **Settings** — General (vault, appearance, LLM, Hub, network) and Account (sign-in, profile, password) tabs; General auto-saves

Pack mutations queue background indexing and return before FastEmbed model loading, so import/download dialogs are not held open by indexing. Hub accounts are optional and needed only for publishing or restricted packs.

See the [root README](../../README.md) and [docs/](../../docs/) for architecture, pack registry, chat sessions, and development checks.

Copy [`.env.example`](./.env.example) (and optionally [`src-tauri/.env.example`](./src-tauri/.env.example)) if you want `NEST_DEBUG` service logs while developing.
