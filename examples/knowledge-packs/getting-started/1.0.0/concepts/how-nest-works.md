# How Nest Works

Nest keeps knowledge in ordinary folders of Markdown files. A folder becomes a
knowledge pack when it contains a valid `pack.json`.

## The main areas

- **Library** browses installed packs and opens Markdown files.
- **Source Control** shows new, modified, and deleted files before publishing.
- **Hub** discovers, installs, updates, imports, exports, and publishes packs.
- **Messages** records publishing submissions, approvals, and rejections.
- **Chat** answers questions using active packs and optional `@` references.
- **Settings** configures the model provider, Hub connection, account, and
  local storage.

## Local-first behavior

Installed packs live on your computer. You can read, edit, import, export, and
search them without signing in. Hub is optional and adds shared catalog,
publishing, restricted-pack access, and review notifications.

## Active knowledge

Active packs participate in broad Chat retrieval. Inactive packs remain
installed and readable but are excluded until reactivated. An explicit `@`
reference narrows retrieval to selected active files or folders.

## Versions and publishing

Nest installs one version of each pack. Published releases are immutable:
change the local files, choose a higher semantic version, submit that version,
and wait for an administrator to approve or reject it.
