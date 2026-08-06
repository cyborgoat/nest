# Exporting, Publishing, and Messages

| Goal | Use |
| --- | --- |
| Send a copy directly to someone | **Export ZIP** |
| Share a version through your team's catalog | **Publish** to Hub |

## Share a ZIP

Select **Export ZIP** on the pack's actions and send the file. The recipient
imports it with **Hub → Import → Import pack ZIP**. No account needed.

## Publish to Hub

Needs a Hub connection, a signed-in account with publishing permission, and no
pending review for the pack.

1. For a Hub-installed pack, review its changes in **Source Control**.
2. Use the pack's **Publish** action.
3. Choose **New release** (a new version) or **Live patch** (replace files in
   an existing release).
4. Enter a concise publish commit message describing what changed.
5. Track the result in **Under Review** or **Messages**.

Nest enables submission only when the pack differs from its current published
version. Changing only the version number is not enough; edit a file or, for a
new release, update the description first. A live patch always requires a file
change.

When the first publication of a new pack is approved, its submitter becomes the
credited author and is added as a maintainer. Hub pack details show the author
and current maintainers. Administrators can update attribution and maintainer
access independently from the admin dashboard.

## After submission

- **Pending:** the pack is locked. Its submitted changes stay visible and
  read-only in Source Control. The original submitter can cancel from **Under
  Review** to unlock it.
- **Approved:** choose **Merge with remote** in Messages or Source Control to
  sync your baseline.
- **Rejected:** read the comment in Messages, make changes, and publish again.

An approved live patch shows as **Patch available**; choose **Sync patch**
(Source Control must be clean).
