# Knowledge Pack Registry (PyPI-style)

Nest’s Knowledge Hub catalogs and distributes Markdown knowledge packs like a small **PyPI**: a stable project id, immutable SemVer releases, and one active install in the vault.

## Layout

```text
fixtures/knowledge/           # or FIXTURES_PATH / HUB_REGISTRY_PATH
  getting-started/
    1.0.0/
      pack.json
      …
    1.1.0/
      pack.json
      …
  software-engineering/
    1.0.0/
      pack.json
      …
```

Rules:

1. **Project directory = `pack.id`** — lowercase `[a-z0-9-]+`, stable forever. Rename = new project.
2. **Version directory = SemVer** — `1.0.0` (not `v1.0.0`). Never mutate a published version folder; publish a new version instead.
3. **`pack.json` must match** parent `id` and `version` path segments.
4. Discovery is filesystem scan only (no root `packs.json` as source of truth).

## `pack.json`

```json
{
  "id": "getting-started",
  "name": "Getting Started",
  "description": "…",
  "version": "1.1.0",
  "yanked": false
}
```

| Field | Required | Notes |
|-------|----------|--------|
| `id` | yes | Must equal parent project folder |
| `name` | yes | Display name |
| `description` | yes | May be empty string |
| `version` | yes | Must equal version folder; SemVer |
| `yanked` | no | If `true`, Hub omits from “latest” and blocks download |
| `path` | no | Legacy; Hub sets `path === id` when absent |

## Hub HTTP API

| Method | Path | Response |
|--------|------|----------|
| `GET` | `/packs` | Projects: `id`, `name`, `description`, `latest_version`, `versions[]` |
| `GET` | `/packs/:id` | Same project detail |
| `GET` | `/packs/:id/:version` | Single release metadata |
| `GET` | `/packs/:id/:version/download` | ZIP `{id}-{version}.zip` |
| `GET` | `/packs/:id/download` | Latest **non-yanked** release ZIP |

Download zip layout: top-level folder `{id}/` including `pack.json` (vault paths stay `getting-started/...`).

## Desktop / vault

- Install one version per pack id at `vault/<id>/` (replace on upgrade), like `pip install pkg==x.y.z`.
- Do **not** stack `vault/<id>/<version>/` for RAG (avoids duplicate citations).
- `sync_state` stores `pack_id`, installed `version`, and **`active`** (RAG inclusion; default `true` on install).
- Local zip import still installs from embedded `pack.json`.
- Example Import zip: `fixtures/examples/healthy-diet-1.0.0.zip`.

## Authoring

1. **SemVer:** patch = doc fixes; minor = new pages; major = breaking path/structure changes.
2. **Never edit** a published `{id}/{version}/` on the Hub disk.
3. **Keep `id` stable**; bump version for every publish.
4. Prefer wholesale vault replace (Nest model).
5. Validate registry with `node scripts/validate-pack-registry.mjs` (id/version match, SemVer, ≥1 `.md`, optional yanked).

## Checksums

Download responses include `X-Content-SHA256` (hex SHA-256 of the zip body) for clients that want integrity checks.
