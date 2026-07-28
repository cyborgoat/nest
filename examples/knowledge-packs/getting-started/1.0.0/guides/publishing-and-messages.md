# Exporting, Publishing, and Messages

## Export a portable copy

Use **Export ZIP** from the installed pack actions. Nest includes the pack
metadata and content in a portable archive that can be imported on another
computer.

## Prepare a release

Before submitting:

1. Review every change in Source Control.
2. Confirm `pack.json` matches the pack ID and intended version.
3. Use semantic versioning: patch for fixes, minor for additive content, and
   major for incompatible structure changes.
4. Check links, images, Markdown rendering, and the pack README.

## Submit

Use the publish action for the pack, choose the next version, confirm the
description, and upload. Hub validates paths, metadata, size, Markdown content,
and version uniqueness before creating a pending request.

Only one request for a pack can be pending at a time. The local baseline does
not advance merely because a request was submitted.

## Follow review status

The pack shows **under review** while pending. Use Source Control refresh to
synchronize immediately, or wait for background refresh.

- **Approved:** the release becomes available in Hub, the pending marker
  clears, and the approved version becomes the new comparison baseline.
- **Rejected:** the pending marker clears, local edits remain, and Source
  Control shows a rejection badge until its message is read.

## Read and act on messages

The Messages page records submission, approval, and rejection events. An unread
dot appears on the Messages icon. Open a rejection to read the administrator's
comment, make the requested edits, choose a new valid version when necessary,
and submit again.

Mark messages read when they no longer require attention. Read messages can be
deleted without changing the publishing history kept by Hub administrators.
