# Import a Pack from a ZIP

Use a ZIP when someone shared a portable Nest pack with you or when you are
moving a pack between computers.

## Quick import

1. Open **Hub** and choose **Import**.
2. Select **Import pack ZIP**.
3. Drag the ZIP into the dialog or browse for it.
4. If the ZIP has no `pack.json`, review the prefilled ID, name, version, and
   optional description. Select **Create pack** so Nest can generate the
   metadata.
5. Otherwise, select **Import ZIP**.
6. Confirm replacement if the same pack is already installed.

Nest keeps one installed version per pack ID. Importing another version replaces
the installed copy only after you confirm. Open **Explorer** to find and read the
imported pack.

## ZIP files with or without pack metadata

A ZIP created with Nest's **Export ZIP** action already contains `pack.json` and
can be imported directly. For an ordinary ZIP without `pack.json`, Nest derives
the pack name and ID from the archive or its top-level folder, defaults the
version to `1.0.0`, and lets you edit those values before import.

Either kind of ZIP must contain at least one Markdown file. Nest generates
`pack.json` in the installed copy and leaves the original ZIP unchanged.
