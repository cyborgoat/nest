# Troubleshooting

## A folder or ZIP will not import

- A folder must contain at least one Markdown file. It does not need a
  `pack.json`; Nest creates one after you confirm the pack details.
- A ZIP must contain at least one Markdown file. If `pack.json` is missing,
  review the prefilled pack details and select **Create pack**.
- If a ZIP contains an invalid `pack.json`, correct it or remove it and import
  the ZIP again using Nest's generated pack details.
- If the same pack is already installed, export it first if you need to keep a
  copy, then confirm replacement.

## Hub cannot connect or a pack cannot be installed

- Confirm that the Hub URL in Settings matches the address provided by your
  team.
- Check the connection status and try again.
- Sign in if the pack is restricted.
- If the service remains unavailable, contact your Hub administrator. Already
  installed packs and local import, reading, editing, and export still work.

## Publishing fails

- Check that `pack.json.id` matches the folder and uses a valid ID.
- Check that `pack.json.version` is valid SemVer and not already published.
- Include at least one Markdown file.
- Sign in to the correct Hub account and confirm you have permission to
  publish.
- Wait for an existing pending request to be reviewed.

## Local changes look stale

Save the editor, then use Source Control refresh. If a remote review was
approved, refresh and choose **Merge with remote** to update the baseline.

## A local image does not render

Use a path relative to the Markdown file and a supported extension such as
PNG, JPEG, GIF, WebP, SVG, or BMP. Check spelling and capitalization.

## Optional Chat fails or gives weak answers

- Verify the model URL, API key, and model name.
- Confirm relevant packs are active and indexing has completed.
- Use a narrower `@` reference.
- Inspect citations and restate the task with clearer constraints.
