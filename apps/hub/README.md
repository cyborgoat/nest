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

All runtime settings come from `.env` (see [`.env.example`](.env.example) for local, [`.env.production.example`](.env.production.example) for host deploy). There are no hardcoded host/port/path fallbacks in code.

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
| GET | `/ready` | Readiness (registry path exists and is readable) |
| GET | `/packs` | Projects (`latest_version`, `versions[]`) |
| GET | `/packs/:id` | Project detail |
| GET | `/packs/:id/:version` | Release metadata |
| GET | `/packs/:id/download` | Latest non-yanked ZIP (streamed) |
| GET | `/packs/:id/:version/download` | Pinned version ZIP (streamed) |

## Production deploy (PM2)

Internal single-host deploy: build Hub, supervise with [PM2](https://pm2.keymetrics.io/), serve packs from a directory on disk.

### First-time setup

1. Install Node LTS and PM2 on the host: `npm i -g pm2`
2. Copy `apps/hub` onto the host (or clone the repo).
3. Seed the registry (e.g. from [examples/knowledge-packs](../../examples/knowledge-packs)) into an absolute path such as `/var/lib/nest-hub/registry`.
4. Configure env and build:

```bash
cd apps/hub
cp .env.production.example .env
# edit .env — set REGISTRY_PATH to the absolute registry path; tighten CORS_ORIGIN if needed
npm ci --omit=dev
npm run build
npm run validate:registry -- /var/lib/nest-hub/registry
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup                 # follow the printed command so Hub survives reboot
```

### Day-to-day

| Task | Command |
|------|---------|
| Status | `pm2 status` |
| Logs | `pm2 logs nest-hub` |
| Restart after code change | `npm ci --omit=dev && npm run build && pm2 restart nest-hub` |
| Stop | `pm2 stop nest-hub` |

Publishing a new pack version: copy a new `{id}/{semver}/` tree into `REGISTRY_PATH` (validate first). Hub rescans on each request — **no PM2 restart** required for registry-only updates.

### Smoke test

```bash
curl -sS http://127.0.0.1:8787/health
curl -sS http://127.0.0.1:8787/ready
curl -sS http://127.0.0.1:8787/packs
curl -sSI http://127.0.0.1:8787/packs/<id>/download   # check Content-Length + X-Content-SHA256
```

Point desktop clients at `http://<internal-host>:8787`. Restrict firewall access to internal CIDRs.

## Cloud debugging

Set `DEBUG_MODE=true` on the service, reproduce a pack download, and check logs for `createPackZip start/done` (pack dir, bytes, elapsed ms). Listing `/packs` is JSON-only; downloads build a temp ZIP then stream it with `Content-Length`.
