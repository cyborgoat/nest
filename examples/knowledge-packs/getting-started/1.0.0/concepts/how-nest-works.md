# How Nest Works

Nest keeps knowledge in ordinary folders of Markdown files, grouped into
packs. A pack has a `pack.json`, but you don't need to create one yourself —
Nest generates it when you import a folder.

## Main areas

The upper-right app header contains **Hub**, **Messages**, and **Chat**. The
activity bar on the far left contains **Explorer**, **Source Control**, and
**Under Review**, with the **Settings** gear anchored at the bottom.

- **Explorer** browses installed packs and opens Markdown files.
- **Source Control** shows new, modified, and deleted files before publishing.
- **Hub** discovers, installs, updates, imports, exports, and publishes packs.
- **Messages** records publishing submissions, approvals, and rejections.
- **Chat** answers questions using active packs and optional `@` references.
- **Settings** configures Hub, your account, storage, and the Chat model.

## Local-first

Installed packs live on your computer. Read, edit, import, export, and search
them without signing in. Hub is optional and adds a shared catalog,
publishing, restricted-pack access, and review notifications.

## Versions

Nest installs one version of each pack. Use **New release** for a new semantic
version or **Live patch** to update an existing release's files. Both require
review; installed users are notified when an approved patch is available.
