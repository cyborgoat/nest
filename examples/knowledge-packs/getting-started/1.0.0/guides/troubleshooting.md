# Troubleshooting

## Hub is offline

- Verify the Hub URL and protocol in Settings.
- Open the Hub health URL in a browser.
- Confirm the Hub process and reverse proxy are running.
- Local reading, editing, import, export, and Chat remain available.

## Admin login returns to the login page

If login returns `201` but the page immediately signs out, update Hub to a
version that supports HTTP-only internal deployments or serve it over HTTPS.
Cookies are marked `Secure` only for HTTPS requests.

## Chat fails or gives weak answers

- Verify the model URL, API key, and model name.
- Confirm relevant packs are active and indexing has completed.
- Use a narrower `@` reference.
- Inspect citations and restate the task with clearer constraints.

## Import or publish fails

- For folder imports, include at least one Markdown file. `pack.json` is
  optional because Nest generates it from the metadata you confirm.
- For ZIP imports, confirm the archive contains one pack and its `pack.json`.
- Check that `pack.json.id` matches the folder and uses a valid ID.
- Check that `pack.json.version` is valid SemVer and not already published.
- Include at least one Markdown file.
- Wait for an existing pending request to be reviewed.

## Local changes look stale

Save the editor, then use Source Control refresh. If a remote review recently
resolved, refreshing updates the pending state and approved baseline.

## A local image does not render

Use a path relative to the Markdown file and a supported extension such as
PNG, JPEG, GIF, WebP, SVG, or BMP. Check spelling and capitalization.
