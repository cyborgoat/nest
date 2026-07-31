# How Nest Works

## A shared home for organizational knowledge

Nest is designed to centralize knowledge packs, their supporting images, and
other Markdown-based content from different departments. It gives people one
predictable place to discover where knowledge lives instead of sending them to
a different website, drive, or message thread for every source.

This is especially useful when scattered copies make it difficult to know:

- where to find a document;
- which version is current;
- whether a release is official and has been reviewed; or
- who is authorized to access restricted material.

Nest addresses these problems by combining a local knowledge library with an
optional shared Hub. Hub catalogs versioned releases, applies access rules to
restricted packs, and supports administrator review before submitted content
is published. That makes approved Hub releases a clear source for authoritative
team content. Direct ZIP export remains available when you need to share a pack
outside the catalog.

## What a knowledge pack contains

Nest keeps knowledge in ordinary folders of Markdown files and supported
images. A pack groups related material—such as a handbook, design guidance, or
project documentation—so it can be found, versioned, and shared as one unit.
Installed packs contain a `pack.json`, but you do not need to create one before
importing a folder: Nest can collect the metadata and generate the file for you.

## The basic journey

1. Connect your team's Hub in **Settings**, if your organization provides one.
2. Use **Hub** to find an approved shared pack, or import one from a folder or
   ZIP.
3. Use **Explorer** to browse the installed pack and read its Markdown files.
4. Edit locally when you want to improve or create knowledge, then inspect the
   changes in **Source Control**.
5. Export a ZIP for direct sharing, or publish through Hub for a reviewed,
   versioned release.
6. Install approved updates when the pack owner publishes a newer version.

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
and wait for an administrator to approve or reject it. Review and versioning
help readers distinguish an official Hub release from an unpublished local
edit.

## Optional Chat behavior

Chat answers questions using active packs and optional `@` references. An
inactive pack stays installed and readable but is excluded from broad Chat
retrieval until reactivated.
