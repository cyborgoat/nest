# Nest Knowledge Hub

[NestJS](https://nestjs.com/) service that catalogs and serves Markdown knowledge packs for the Nest desktop client.

## Run locally

```bash
cd apps/hub
cp .env.example .env   # if you don't already have one
npm install
npm run start:dev
```

## Configuration

Copy `.env.example` to `.env` and adjust as needed:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8787` | HTTP listen port |
| `FIXTURES_PATH` | `../../fixtures/knowledge` | Path to the knowledge fixtures root (absolute, or relative to `apps/hub`) |
| `NEST_DEBUG` | `false` | Verbose Hub service logs when `true` / `1` / `yes` / `on` |

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Liveness |
| GET | `/packs` | Pack catalog |
| GET | `/packs/:id` | Pack metadata |
| GET | `/packs/:id/download` | ZIP of Markdown tree |

Further context: [docs/architecture.md](../../docs/architecture.md), [docs/development.md](../../docs/development.md).
