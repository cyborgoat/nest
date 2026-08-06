# How Nest Works

Nest keeps knowledge in ordinary folders of Markdown files, grouped into
packs. A pack has a `pack.json`, but you don't need to create one yourself —
Nest generates it when you import a folder.

## Main areas

- **Explorer** browses installed packs and opens Markdown files.
- **Source Control** shows changes to editable packs installed from Hub. A
  local pack appears there temporarily while its publish request is reviewed.
- **Hub** discovers, installs, updates, imports, exports, and publishes packs.
- **Messages** records publishing submissions, approvals, and rejections.
- **Chat** answers questions using active packs and optional `@` references.
- **Settings** configures Hub, your account, storage, and the Chat model.

## Local-first

Installed packs live on your computer. Read, edit, import, export, and search
them without signing in. Hub is optional and adds a shared catalog,
publishing, restricted-pack access, and review notifications.

## Versions

Nest installs one version of each pack. Publish a new version or submit a live
patch, describe the change with a commit message, and wait for approval.
