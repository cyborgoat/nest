# Knowledge Pack Registry (PyPI-style)

Nest’s Hub service catalogs and distributes Markdown knowledge packs like a small **PyPI**: a stable project id, immutable SemVer releases, and one active install in the vault.

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

1. **Project directory = `pack.id`** — lowercase `[a-z0-9-]+`, stable forever. Rename = new project.
2. **Version directory = SemVer** — `1.0.0` (not `v1.0.0`). Never mutate a published version folder; publish a new version instead.
3. **`pack.json` must match** parent `id` and `version` path segments.
4. Release contents are discovered from the filesystem and synchronized into Hub's SQLite control catalog (there is no root `packs.json`).

Hub now imports filesystem releases into its SQLite control catalog. Release bytes remain on disk and immutable; SQLite adds ownership, approval state, archive/yank state, and pack-wide `public` or `restricted` visibility. Public is the default. Restricted packs are returned only to their owner, explicitly selected users, admins, and the superuser.

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

## Desktop / vault

- Install one version per pack id at `vault/<id>/` (replace on upgrade), like `pip install pkg==x.y.z`.
- Do **not** stack `vault/<id>/<version>/` for RAG (avoids duplicate citations).
- `sync_state` stores `pack_id`, installed `version`, and **`active`** (RAG inclusion; default `true` on install).
- `sync_state.origin` records `local`, `registry`, `bundled`, or `unknown`; legacy rows migrate to `unknown`, and only `local` packs may be submitted for publishing.
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
2. **Never edit** a published `{id}/{version}/` on the Vault disk.
3. **Keep `id` stable**; bump version for every publish.
4. Prefer wholesale vault replace (Nest model).
5. Validate registry with `node scripts/validate-pack-registry.mjs` (id/version match, SemVer, ≥1 `.md`, optional yanked).
6. Registered desktop users publish ZIPs through Hub. New projects and later owner versions remain pending until an admin or the superuser approves the exact reviewed artifact.

## Publishing and access lifecycle

1. A user creates an account from **Settings → Account**. The account ID is immutable; name and password can be maintained there.
2. Only a pack with local origin (created from a folder or imported by the user) exposes **Publish** in the installed-pack action menu. Registry downloads, bundled packs, and legacy unknown-origin packs cannot be republished.
3. Desktop exports the installed tree as a ZIP and submits it to Hub. Hub validates the archive size, safe paths, `pack.json`, SemVer, and Markdown content before storing a pending artifact.
4. An admin or the superuser approves the exact staged artifact with an optional comment or rejects it with a required comment. Hub creates a durable submitted/approved/rejected message for the author and retains review metadata for administrator history.
5. Approved releases are immutable. Administrators can edit project metadata, yank a release, archive or delete a project, upload an immediate release, and change visibility.
6. Every project is `public` by default. A `restricted` project is visible only to its owner, explicitly granted users, admins, and the superuser. Authentication is therefore optional for all local work and public browsing.

The complete route and authorization contract is documented in [hub-api.md](hub-api.md).

## Checksums

Download responses include `X-Content-SHA256` (hex SHA-256 of the zip body) for clients that want integrity checks.
