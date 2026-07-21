# Nest Hub

[NestJS](https://nestjs.com/) service that catalogs and serves Markdown knowledge packs for the Nest desktop client.

## Run locally

```bash
cd apps/hub
cp .env.example .env   # if you don't already have one
npm install
npm run start:dev
```

## Configuration

All runtime settings come from `.env` (see [`.env.example`](.env.example)). There are no hardcoded host/port/path fallbacks in code.

| Variable | Example | Description |
|----------|---------|-------------|
| `HOST` | `0.0.0.0` | HTTP listen interface (`0.0.0.0` for cloud / reverse proxies) |
| `PORT` | `8787` | HTTP listen port |
| `REGISTRY_PATH` | `../../examples/knowledge-packs` | Pack registry root (absolute, or relative to `apps/hub`) |
| `VAULT_PATH` | — | Deprecated alias for `REGISTRY_PATH` |
| `FIXTURES_PATH` | — | Deprecated alias for `REGISTRY_PATH` |
| `DEBUG_MODE` | `false` | Verbose logs when `true` / `1` / `yes` / `on` |
| `NEST_DEBUG` | — | Deprecated alias for `DEBUG_MODE` |
| `CORS_ORIGIN` | `*` | `*` or comma-separated allowed origins |
| `DOWNLOAD_TIMEOUT_MS` | `120000` | Documented client timeout hint (desktop uses 120s) |

Registry layout is PyPI-style `{id}/{semver}/`. See [pack-registry.md](../../docs/pack-registry.md).

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Liveness |
| GET | `/packs` | Projects (`latest_version`, `versions[]`) |
| GET | `/packs/:id` | Project detail |
| GET | `/packs/:id/:version` | Release metadata |
| GET | `/packs/:id/download` | Latest non-yanked ZIP (streamed) |
| GET | `/packs/:id/:version/download` | Pinned version ZIP (streamed) |

## Cloud debugging

Set `DEBUG_MODE=true` on the service, reproduce a pack download, and check logs for `createPackZip start/done` (pack dir, bytes, elapsed ms). Listing `/packs` is JSON-only; downloads build a temp ZIP then stream it with `Content-Length`.
