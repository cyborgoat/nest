# Nest Hub

[NestJS](https://nestjs.com/) service that catalogs and serves Markdown knowledge packs for the Nest desktop client.

## Run locally

```bash
cd apps/admin
npm install
npm run build

cd apps/hub
cp .env.example .env   # if you don't already have one
npm install
npm run start:dev
```

The admin build is written to the ignored `apps/hub/public/admin/` directory and served by Hub at `/admin`.

## Configuration

All runtime settings come from `.env` (see [`.env.example`](.env.example) for local, [`.env.production.example`](.env.production.example) for host deploy). There are no hardcoded host/port/path fallbacks in code.

| Variable              | Example                          | Description                                                     |
| --------------------- | -------------------------------- | --------------------------------------------------------------- |
| `HOST`                | `0.0.0.0`                        | HTTP listen interface (`0.0.0.0` for cloud / reverse proxies)   |
| `PORT`                | `8787`                           | HTTP listen port                                                |
| `REGISTRY_PATH`       | `../../examples/knowledge-packs` | Pack registry root (absolute, or relative to `apps/hub`)        |
| `DEBUG_MODE`          | `false`                          | Verbose logs when `true` / `1` / `yes` / `on`                   |
| `CORS_ORIGIN`         | `*`                              | `*` or comma-separated allowed origins                          |
| `DOWNLOAD_TIMEOUT_MS` | `120000`                         | Documented client timeout hint (desktop uses 120s)              |
| `DATABASE_PATH`       | `./data/hub.sqlite3`             | SQLite control database for users, packs, releases, and reviews |
| `STAGING_PATH`        | `./data/staging`                 | Pending pack upload storage                                     |
| `JWT_SECRET`          | —                                | Required random signing secret, at least 32 characters          |
| `MIN_PASSWORD_LENGTH` | `8`                              | Minimum registration password length enforced by Hub            |
| `SUPERUSER_ID`        | —                                | Account ID adopted/created as the permanent superuser           |
| `SUPERUSER_PASSWORD`  | —                                | Initial superuser password; remove after bootstrap              |
| `SUPERUSER_NAME`      | `Administrator`                  | Display name applied when the superuser is first adopted        |

Registry layout is PyPI-style `{id}/{semver}/`. See [pack-registry.md](../../docs/pack-registry.md).

## Endpoints

Public catalog/download, authenticated account/publishing/messages, and privileged admin routes are documented in the canonical [Hub API reference](../../docs/hub-api.md).

The routed React operations console is served at `/admin` for admins and the superuser. It uses Tailwind, TanStack Router/Query/Table, and shadcn-style primitives for the dashboard, publishing queue and review history, pack details, and user access. Every page has a header refresh button with skeleton loading and error states; on the packs and users pages the metric cards double as the status/role filters, and destructive or releasing actions (pack/user deletion, approve & release) go through confirmation dialogs. Admins and the superuser have equal registry-management permissions, including immediate uploads. Admins can promote regular users and remove regular users; only the superuser can remove admins. The environment-adopted superuser is permanently marked as managed and its ID, name, password, and role cannot be changed through the service. Published release contents are immutable, while project metadata, visibility, grants, archive state, and release yank state are managed in SQLite.

Publishing submissions, approvals, and rejections create durable per-user messages. Clients may poll the unread-count endpoint; messages remain until the recipient deletes them.

### Schema compatibility

The account/publishing release establishes a new development schema baseline. Databases from earlier development builds are not upgraded in place; reset the configured `DATABASE_PATH` once as described in [Development](../../docs/development.md#development-database-reset). Production data should be migrated explicitly rather than reset.

## Production deploy (PM2)

Internal single-host deploy: build Hub, supervise with [PM2](https://pm2.keymetrics.io/), serve packs from a directory on disk.

### First-time setup

1. Install Node.js 24 or newer and PM2 on the host: `npm i -g pm2`
2. Copy `apps/hub` onto the host (or clone the repo).
3. Seed the registry (e.g. from [examples/knowledge-packs](../../examples/knowledge-packs)) into an absolute path such as `/var/lib/nest-hub/registry`.
4. Install both application workspaces, configure env, and build:

```bash
cd apps/hub
cp .env.production.example .env
# edit .env — set REGISTRY_PATH to the absolute registry path; tighten CORS_ORIGIN if needed
npm ci
npm --prefix ../admin ci
npm run build
npm prune --omit=dev
npm run validate:registry -- /var/lib/nest-hub/registry
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup                 # follow the printed command so Hub survives reboot
```

### Day-to-day

| Task                      | Command                                                      |
| ------------------------- | ------------------------------------------------------------ |
| Status                    | `pm2 status`                                                 |
| Logs                      | `pm2 logs nest-hub`                                          |
| Restart after code change | `npm ci --omit=dev && npm run build && pm2 restart nest-hub` |
| Stop                      | `pm2 stop nest-hub`                                          |

Publishing now normally happens through the desktop review workflow or the `/admin` control room. Existing filesystem releases are imported idempotently as public, system-owned catalog records.

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
