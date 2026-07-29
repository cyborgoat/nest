# Exporting, Publishing, and Messages

## Export a portable copy

Use **Export ZIP** from the installed pack actions. Nest includes the pack
metadata and content in a portable archive that can be imported on another
computer.

## Prepare a release

Before submitting:

1. Review every change in Source Control.
2. Follow the [pack publishing rules](publishing-rules.md).
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

- **Approved:** the release becomes available in Hub and waits for you to
  choose **Merge with remote** from Messages or Source Control.
- **Rejected:** the pending marker clears, local edits remain, and Source
  Control shows a rejection badge until its message is read.

## Read and act on messages

The Messages page records submission, approval, and rejection events. An unread
dot appears on the Messages icon. For an approval, choose **Merge with remote**.
Nest downloads the exact reviewed release as the new Source Control baseline
without overwriting your local working files. Any edits made after submission
remain visible as modified, new, or deleted files.

The **Under Review** sidebar lists installed packs with pending requests. Use it
to inspect the local pack, open its submission message, or refresh review
status.

Open a rejection to read the administrator's comment, make the requested edits,
choose a new valid version when necessary, and submit again.

Mark messages read when they no longer require attention. Read messages can be
deleted without changing the publishing history kept by Hub administrators.
