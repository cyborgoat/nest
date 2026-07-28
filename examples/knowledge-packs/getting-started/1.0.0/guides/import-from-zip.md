# Import a Pack from a ZIP

Use a ZIP when someone shared a portable Nest pack with you or when you are
moving a pack between computers.

## Required archive structure

Unlike folder import, ZIP import does not show a metadata form. The archive
therefore needs a valid `pack.json` at the pack root and at least one Markdown
file.

```text
my-pack/
  pack.json
  README.md
  guides/
    first-topic.md
```

The manifest identifies the pack and its version. The `id` must match the pack
folder name, and `version` must use semantic versioning such as `1.0.0`.

## Import the ZIP

1. Open **Hub** and choose **Import**.
2. Select **Import pack ZIP**.
3. Drag the ZIP into the dialog or browse for it.
4. Select **Import ZIP**.
5. Confirm replacement if the same pack is already installed.

Nest keeps one installed version per pack ID. Importing another version replaces
the installed copy only after you confirm.

Tip: use Nest's **Export ZIP** action to create an archive with the correct
structure automatically.
