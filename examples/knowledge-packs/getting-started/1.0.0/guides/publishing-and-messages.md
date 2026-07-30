# Exporting, Publishing, and Messages

Choose how you want to share:

| Goal                                            | Use                |
| ----------------------------------------------- | ------------------ |
| Send a copy directly to someone                 | **Export ZIP**     |
| Make a version available in your team's catalog | **Publish** to Hub |

## Share a ZIP

Choose **Export ZIP** from the installed pack's actions. Send the resulting
file to another Nest user, who can add it with **Hub → Import → Import pack
ZIP**. Exporting does not require an account or Hub connection.

## Publish to Hub

You need a Hub connection, a signed-in account with publishing permission, and
a pack that is not already waiting for review.

1. Open and read the content you intend to share.
2. Open **Source Control** and review every local change.
3. Use the pack's **Publish** action.
4. Choose **New release** to publish a new semantic version, or **Live patch**
   to replace the files in an existing non-yanked release. For a new release,
   Nest prefills the description from the most recent Hub release.
5. Open **Under Review** or **Messages** to follow the result.

For version naming, file compatibility, and a fuller pre-publish checklist, see
[Pack publishing rules](publishing-rules.md).

## After submission

Only one request for a pack can be under review at a time:

- **Approved:** the version becomes available in Hub. Choose **Merge with
  remote** in Messages or Source Control to finish synchronizing your local
  review state.
- **Rejected:** open the message to read the review comment. Your local edits
  remain, so you can make the requested changes and publish again.

Merging the approved release updates the comparison baseline without
overwriting edits made after submission. Those later edits continue to appear
in Source Control.

An approved live patch is labeled `vX.Y.Z · Patch N`. Users who already have
that semantic version see **Patch available** and can choose **Sync patch**.
Nest blocks patch sync while Source Control has local changes; commit or discard
them first. A newer semantic release and a patch can be offered at the same time.
