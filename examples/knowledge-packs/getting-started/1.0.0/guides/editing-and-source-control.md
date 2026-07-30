# Editing and Source Control

## Edit Markdown

Open a Markdown file and switch between rendered and source modes. Save changes
normally; the editor and Source Control share the same file state, so discarding
a change also restores the open editor.

Use **Undo** and **Redo** while editing. **Cancel** exits immediately when the
buffer is clean; with unsaved edits it asks before restoring the last saved
content.

Nest supports GitHub Flavored Markdown, including tables, task lists,
strikethrough, fenced code, links, local images, and Mermaid diagrams.

```mermaid
flowchart LR
  Edit --> Save
  Save --> Review[Review in Source Control]
  Review --> Publish
```

## Understand status markers

- **M** means a tracked file was modified.
- **A** means a file is new.
- **D** means a file was deleted.

The amber dot on the Source Control icon means at least one local change exists.
Open a changed file from Source Control to compare it with the synchronized
baseline.

## Discard carefully

Discard restores a modified or deleted file from the baseline and removes a new
file. This also updates an already-open editor. Review the diff before
discarding because unsaved intent cannot be reconstructed afterward.

## Synchronize review state

Use the Source Control refresh button after publishing. An approved request
shows a **Merge with remote** action. Merging makes the exact reviewed Hub
release the new baseline while preserving the working folder, so edits made
after submission remain visible. A rejected request releases the pending lock
and displays a rejection badge; open Messages from that badge to read the
review comment.
