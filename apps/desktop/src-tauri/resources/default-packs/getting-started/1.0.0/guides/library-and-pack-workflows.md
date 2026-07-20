# Library and Pack Workflows

## What Library is for

Use Library to browse installed packs and open files.

## Pack lifecycle

1. Install from Hub (remote) or Import (local `.zip`).
2. The pack appears in your Library.
3. The app prepares it for search and chat.
4. You can deactivate, reactivate, upgrade, export, or remove.

## Active state

- `+/-` on pack root toggles active status.
- Active packs are used in Chat answers.
- Inactive packs remain readable but excluded from Chat answers.

## Import local pack

Pack zip should contain top-level folder `<id>/` and include `<id>/pack.json`.

Required `pack.json` fields:

- `id`
- `name`
- `description`
- `version`

Optional:

- `path` (if provided, must equal `id`)

## Remove pack behavior

Removing a pack:

- Removes the pack from your local Library
- Removes it from Library and Chat scope
- Frees local storage used by that pack

## Version model

Nest keeps one installed version per pack. Upgrading replaces the pack content with the newer version.
