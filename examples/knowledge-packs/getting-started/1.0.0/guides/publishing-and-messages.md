# Exporting, Publishing, and Messages

Open **Source Control** from the far-left activity bar to publish changes.
Open **Messages** from the upper-right app header to read review decisions.

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

1. Review your changes in **Source Control**.
2. Use the pack's **Publish** action.
3. Choose **New release** (a new version) or **Live patch** (replace files in
   an existing release).
4. Track the result in **Under Review** or **Messages**.

## After submission

- **Pending:** the pack is locked and its read-only label identifies the
  submitter. **Under Review** in the far-left activity bar shows the request;
  only the original submitter can cancel it.
- **Approved:** choose **Merge with remote** in Messages or Source Control to
  sync your baseline. Non-conflicting work is retained and true conflicts let
  you choose **Local** or **Approved Hub** per file.
- **Rejected:** read the comment in Messages, make changes, and publish again.

An approved live patch shows as **Patch available**; choose **Sync patch**
from **Hub → Installed**. Patch conflicts use the same per-file resolver.
