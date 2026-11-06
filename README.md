<div align="center">

<img src="apps/desktop/public/nest-logo-transparent.png" alt="Nest logo" width="120" height="120" />

# Nest

**A local-first desktop knowledge workspace. Read and edit Markdown knowledge packs, and chat with them using any OpenAI-compatible LLM.**

[![Release](https://img.shields.io/github/v/release/cyborgoat/nest?style=flat-square)](https://github.com/cyborgoat/nest/releases/latest)
[![CI](https://img.shields.io/github/actions/workflow/status/cyborgoat/nest/ci.yml?style=flat-square&label=ci)](https://github.com/cyborgoat/nest/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/github/license/cyborgoat/nest?style=flat-square)](LICENSE)
![Platforms](https://img.shields.io/badge/platforms-macOS%20%7C%20Windows-lightgrey?style=flat-square)
[![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri%20v2-24C8DB?style=flat-square)](https://tauri.app)

[Download](https://github.com/cyborgoat/nest/releases/latest) ·
[Documentation](#documentation) ·
[Report a bug](https://github.com/cyborgoat/nest/issues)

</div>

---

## What is Nest?

Nest keeps your knowledge as plain Markdown in a local vault and lets you talk to
it. Install **knowledge packs** (folders of Markdown), keep the ones you care
about active, and ask questions: Nest retrieves the relevant passages with a
hybrid full-text and vector search, then answers through the LLM you configure.

It works from the first launch. A bundled **Getting Started** pack is preinstalled,
and the embedding model ships inside the app, so retrieval works fully offline.
Only the chat completion goes to your LLM provider.

## Features

- **Markdown knowledge packs.** Browse and edit packs in a built-in editor with
  GitHub Flavored Markdown, syntax-highlighted code, Mermaid diagrams, and images
  (including inline SVG).
- **Retrieval-augmented chat.** Hybrid SQLite full-text and FastEmbed vector
  search over your active packs, with streaming answers from any
  OpenAI-compatible endpoint.
- **Focus with `@`.** `@`-mention files or folders in chat to narrow what Nest
  retrieves.
- **Ask and Agent modes.** *Ask* is read-only. *Agent* proposes Markdown changes
  you review as an inline diff, then **Approve** to write and index them or
  **Reject** to discard.
- **Multiple chat sessions.** Tabs for open chats, plus history with pin, archive,
  rename, and delete. Titles are generated after the first reply.
- **Optional Hub.** Browse a registry of packs, download them, and publish your
  own. The desktop app never requires a login; an account is only needed to
  publish or access restricted packs.
- **Claude Agent (Windows, optional).** Use a signed-in local Claude CLI as the
  chat backend. See the [Claude Agent guide](docs/claude-agent.md).

## Install

Download the installer for your platform from the
[latest release](https://github.com/cyborgoat/nest/releases/latest).

| Platform | Package |
|----------|---------|
| macOS (Apple silicon) | `.dmg` |
| Windows (x64) | `.msi` or `.exe` |

On first run:

1. Open **Settings** and enter an OpenAI-compatible **Base URL**, **API key**, and
   chat model.
2. Open **Library**. The **Getting Started** pack is already installed and active.
3. Go to **Chat** and ask a question about your active packs.

Optional: start the [Hub service](#hub-service) and point **Settings → Hub URL** at
it to browse, download, and import packs. You can also **Import** a local pack
`.zip` that contains a `pack.json`.

## Repository layout

```text
apps/desktop      Tauri v2 + React desktop client
apps/hub          NestJS Hub API (accounts, publishing, registry, messages)
apps/admin        React operations console served by the Hub at /admin
packages/shared   Shared TypeScript types
examples/knowledge-packs  Example Markdown packs served by the Hub
docs/             Architecture and development notes
```

## Build from source

Requirements: Node.js 22+, and a stable Rust toolchain with the
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

```bash
cd apps/desktop
npm install
npm run tauri dev
```

## Hub service

The Hub is a [NestJS](https://nestjs.com/) API that hosts the pack registry. Set
`HOST` and `PORT` in `apps/hub/.env` (see `apps/hub/.env.example`), then point the
desktop app's **Settings → Hub URL** at it.

```bash
cd apps/admin
npm install
npm run build

cd ../hub
cp .env.example .env
npm install
npm run start:dev
```

The catalog and downloads are anonymous. Accounts are only needed to publish or
access restricted packs. Authors submit packs and new versions for administrator
review, and an admin console at `/admin` handles reviews, roles, visibility,
access grants, and releases. See the [Hub API reference](docs/hub-api.md).

## How it works

- **Local vault.** Packs, `nest.db`, and the vector database live in the OS app
  data directory for `Nest`.
- **Hybrid retrieval.** SQLite FTS plus FastEmbed vector search through
  [Rig](https://github.com/0xPlaygrounds/rig) (`rig-fastembed` and `rig-sqlite`),
  with the embedding model bundled in the binary.
- **Active packs** define the default search domain. `@` focus paths narrow it and
  load bounded Markdown directly while indexing catches up.
- **Agent edits** go through a reviewable pending workspace, so nothing is written
  until you approve it.
- The bundled `getting-started` pack is seeded once per app data directory and is
  not reinstalled automatically after you delete it.

## Documentation

- [Architecture](docs/architecture.md): vault, RAG, streaming
- [Pack registry](docs/pack-registry.md): PyPI-style multi-version registry
- [Hub API](docs/hub-api.md): authentication, publishing, messages, administration
- [Chat sessions](docs/chat-sessions.md): tabs, history, titles, Ask and Agent
- [Claude Agent](docs/claude-agent.md): Windows setup, tools, review, recovery
- [Development](docs/development.md): env vars, checks, and releases

## Releases

Installers are built by GitHub Actions from version tags (`v*`) and published as a
GitHub release. See [Development → Releases](docs/development.md#releases) for the
version-bump checklist.

## Contributing

Issues and pull requests are welcome. Please open an issue first for larger
changes, and see [docs/development.md](docs/development.md) for environment setup
and the checks to run.

## License

MIT. See [LICENSE](LICENSE).
