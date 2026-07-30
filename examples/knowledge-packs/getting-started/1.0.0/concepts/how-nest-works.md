# How Nest Works

Nest keeps knowledge in ordinary folders of Markdown files. Installed packs
contain a `pack.json`, but you do not need to create one before importing a
folder: Nest can collect the metadata and generate the file for you.

## The basic journey

1. Use **Hub** to find a shared pack or import one from a folder or ZIP.
2. Use **Explorer** to browse the installed pack and read its Markdown files.
3. Edit locally when you want to improve or create knowledge.
4. Export a ZIP for direct sharing, or publish through Hub for a reviewed,
   versioned release.

## Local-first behavior

Installed packs live on your computer. You can read, edit, import, export, and
search them without signing in. Hub adds a shared catalog, publishing,
restricted-pack access, and review notifications.

## Areas used for editing and sharing

- **Source Control** shows new, modified, and deleted files before publishing.
- **Messages** records publishing submissions, approvals, and rejections.
- **Settings** manages Hub access, your account, local storage, and optional
  Chat configuration.

## Versions and publishing

Nest installs one version of each pack. Published releases are immutable:
change the local files, choose a higher semantic version, submit that version,
and wait for an administrator to approve or reject it.

## Optional Chat behavior

Chat answers questions using active packs and optional `@` references. An
inactive pack stays installed and readable but is excluded from broad Chat
retrieval until reactivated.
