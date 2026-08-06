# Knowledge Pack Registry (PyPI-style)

Nest’s Hub service catalogs and distributes Markdown knowledge packs like a small **PyPI**: a stable project id, reviewed SemVer releases, and one active install in the vault. A release may receive a reviewed live patch identified by a monotonically increasing patch revision.

Desktop also bundles one default pack (`getting-started`) for first launch. The bundled content follows the same pack structure.

## Layout

```text
examples/knowledge-packs/     # or REGISTRY_PATH (pack registry root)
  getting-started/
    1.0.0/
      pack.json
      …
```

Rules:

1. **Project directory = `pack.id`** — lowercase cased letters plus Unicode letters (including Chinese), numbers, and hyphens; stable forever. Rename = new project.
2. **Version directory = SemVer** — `1.0.0` (not `v1.0.0`). Normal publishing creates a new version; the reviewed live-patch workflow may atomically replace an existing non-yanked version.
3. **`pack.json` must match** parent `id` and `version` path segments.
4. Release contents are discovered from the filesystem and synchronized into Hub's SQLite control catalog (there is no root `packs.json`).

Hub now imports filesystem releases into its SQLite control catalog. Release bytes remain on disk and change only through approval; SQLite adds ownership, approval state, patch revision, archive/yank state, and pack-wide `public` or `restricted` visibility. Public is the default. Restricted packs are returned only to their owner, explicitly selected users, admins, and the superuser.

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

| Field         | Required | Notes                                                  |
| ------------- | -------- | ------------------------------------------------------ |
| `id`          | yes      | Must equal parent project folder                       |
| `name`        | yes      | Display name                                           |
| `description` | yes      | May be empty string                                    |
| `version`     | yes      | Must equal version folder; SemVer                      |
| `yanked`      | no       | If `true`, Hub omits from “latest” and blocks download |
| `path`        | no       | Legacy; Hub sets `path === id` when absent             |

## Hub HTTP API

| Method | Path                           | Response                                                              |
| ------ | ------------------------------ | --------------------------------------------------------------------- |
| `GET`  | `/packs`                       | Projects: `id`, `name`, `description`, `latest_version`, `versions[]` |
| `GET`  | `/packs/:id`                   | Same project detail                                                   |
| `GET`  | `/packs/:id/:version`          | Single release metadata                                               |
| `GET`  | `/packs/:id/:version/download` | ZIP `{id}-{version}.zip`                                              |
| `GET`  | `/packs/:id/download`          | Latest **non-yanked** release ZIP                                     |

Download zip layout: top-level folder `{id}/` including `pack.json` (vault paths stay `getting-started/...`).

Administrators who make emergency filesystem changes can use the refresh
action on the admin pack pages. It calls `POST /api/admin/packs/resync` to add
or update valid filesystem entries and remove database rows for directories
that no longer exist. Invalid manifests are reported without deleting their
existing database records. Pack visibility, archive state, maintainers, grants,
yank state, and publishing history remain database-owned.

## Desktop / vault

- Install one version per pack id at `vault/<id>/` (replace on upgrade), like `pip install pkg==x.y.z`.
- Do **not** stack `vault/<id>/<version>/` for RAG (avoids duplicate citations).
- `sync_state` stores `pack_id`, installed `version`, `patch_revision`, and **`active`** (RAG inclusion; default `true` on install).
- `sync_state.origin` records `local`, `registry`, `bundled`, or `unknown`; legacy rows migrate to `unknown`. Local packs and editable registry packs may be submitted.
- Pending requests lock in-app pack mutations while preserving a read-only view of the submitted differences. The original submitter may cancel to remove the request and unlock the pack. Approved requests remain locally actionable until **Merge with remote** downloads the exact release as the source-control baseline.
- Local zip import still installs from embedded `pack.json`.
- Importing or creating a local pack whose ID is already installed requires confirmation and atomically replaces the single installed version.
- The repository example registry contains only the canonical
  `getting-started@1.0.0` tutorial.

Bundled default pack notes:

- On first launch, desktop copies bundled `getting-started` files into `vault/getting-started/` and records that version in `sync_state`.
- The user can remove it like any other pack.
- A first-run marker avoids reinstalling it automatically after removal.

## Authoring

1. **SemVer:** patch = doc fixes; minor = new pages; major = breaking path/structure changes.
2. **Never edit** a published `{id}/{version}/` directly on the registry disk; use a new release or reviewed live patch.
3. **Keep `id` stable**; bump version for a normal publish, or use a reviewed live patch for an in-place correction.
4. Prefer wholesale vault replace (Nest model).
5. Validate registry with `node scripts/validate-pack-registry.mjs` (id/version match, SemVer, ≥1 `.md`, optional yanked).
6. Registered desktop users publish ZIPs through Hub. New projects and later owner versions remain pending until an admin or the superuser approves the exact reviewed artifact.

## Publishing and access lifecycle

1. A user creates an account from **Settings → Account**, confirming the password before submission. The account ID is immutable; name and password can be maintained there.
2. Local packs and editable registry packs expose **Publish**. Bundled and legacy unknown-origin packs cannot be published.
3. Desktop requires a publish commit message and at least one change from the current published version, exports the installed tree as a ZIP, and submits both to Hub. A version bump alone is not a change. Hub independently enforces the same rule and validates the archive size, safe paths, `pack.json`, SemVer, Markdown content, and commit-message length before storing a pending artifact.
4. An admin or the superuser approves the exact staged artifact with an optional comment or rejects it with a required comment. Hub creates a durable submitted/approved/rejected message for the author and retains review metadata for administrator history.
5. Approved releases change only through a new semantic release or reviewed live patch. A live patch keeps only the latest approved file snapshot, increments `patch_revision`, and preserves the semantic version. Administrators can edit project metadata, yank a release, archive or delete a project, upload an immediate release, and change visibility.
6. Every project is `public` by default. A `restricted` project is visible only to its owner, explicitly granted users, admins, and the superuser. Authentication is therefore optional for all local work and public browsing.

The complete route and authorization contract is documented in [hub-api.md](hub-api.md).

## Checksums

Download responses include `X-Content-SHA256` (hex SHA-256 of the zip body) and `X-Pack-Patch-Revision` for clients that want integrity and patch checks.
