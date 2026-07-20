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
| `FIXTURES_PATH` | `../../examples/knowledge-packs` | Path to the knowledge examples root (absolute, or relative to `apps/hub`) |
| `NEST_DEBUG` | `false` | Verbose Hub service logs when `true` / `1` / `yes` / `on` |

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Liveness |
| GET | `/packs` | Projects (`latest_version`, `versions[]`) |
| GET | `/packs/:id` | Project detail |
| GET | `/packs/:id/:version` | Release metadata |
| GET | `/packs/:id/download` | Latest non-yanked ZIP |
| GET | `/packs/:id/:version/download` | Pinned version ZIP |

Registry layout is PyPI-style `{id}/{semver}/`. See [pack-registry.md](../../docs/pack-registry.md).
