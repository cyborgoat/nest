# Pack Publishing Rules

Use these conventions to keep a pack portable across Nest Desktop, Hub, macOS,
Linux, and Windows.

## Choose a stable pack identity

- Use a short lowercase pack ID such as `engineering-handbook`.
- Pack IDs may contain lowercase letters, numbers, and single hyphens.
- The pack ID must match the top-level pack folder name.
- Treat the ID as permanent after the first release. Renaming it creates a
  different Hub project rather than a new version of the existing project.
- The display name can be more readable and may contain spaces or non-English
  characters.

## Name content files clearly

Markdown filenames may use Unicode, including Chinese characters:

```text
engineering-handbook/
  开始阅读.md
  guides/
    发布流程.md
    故障排查.md
```

For compatibility with Windows:

- Do not use `< > : " / \ | ? *`.
- Do not end a filename with a space or period.
- Do not use reserved names such as `CON`, `NUL`, `PRN`, `AUX`, `COM1`, or
  `LPT1`.
- Avoid two paths that differ only by letter case.
- Keep the `.md` extension and use relative Markdown links between files.

Folder names such as `guides`, `concepts`, and `images` are conventions, not
requirements. Organize them for the people reading the pack.

## Use `pack.json` as metadata

A source folder does not need a hand-written `pack.json`. When importing from a
folder, Nest derives sensible values, lets you review them, and creates the
manifest in the installed copy.

Installed, exported, ZIP-imported, and published packs currently use
`pack.json` as their portable manifest:

```json
{
  "id": "engineering-handbook",
  "name": "Engineering Handbook",
  "description": "Shared engineering practices.",
  "version": "1.2.0",
  "path": "engineering-handbook"
}
```

- `id` is the stable Hub identity and must equal the pack folder.
- `name` is the human-readable title.
- `description` is optional but helps people decide whether to install it.
- `version` must be a semantic version.
- `path`, when present, must equal `id`. Let Nest manage this field.

Prefer editing metadata through Nest. Renaming a pack or choosing a publish
version updates the manifest and related local records together. Do not put
documentation, credentials, API keys, or machine-specific paths in
`pack.json`.

## Version releases consistently

Use semantic versioning in the form `major.minor.patch`:

- Patch (`1.0.1`) for corrections and small clarifications.
- Minor (`1.1.0`) for new, backward-compatible content.
- Major (`2.0.0`) for reorganizations that break links or substantially change
  how readers use the pack.

Every Hub release needs a version that has not already been published. Choose
the next version in Nest's publish dialog; Nest writes it to the exported
manifest before upload.

## Review before publishing

1. Review all Source Control changes.
2. Open changed Markdown files in rendered view.
3. Check relative links, images, headings, and `@` reference examples.
4. Remove secrets, personal data, temporary files, and machine-specific paths.
5. Confirm the pack ID, display name, description, and intended version.
6. Export and re-import a ZIP when testing a substantial structural change.
7. Submit the request and monitor Messages for approval or reviewer comments.

ZIP files must contain exactly one top-level pack folder, its generated
`pack.json`, and at least one Markdown file.
