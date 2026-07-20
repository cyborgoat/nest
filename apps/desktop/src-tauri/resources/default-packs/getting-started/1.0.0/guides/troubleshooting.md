# Troubleshooting

## Hub shows offline

- Confirm Hub Base URL in Settings.
- Check Hub process is running.
- Try opening the Hub base URL in a browser to confirm it responds.
- You can still use local packs without Hub.

## Chat answers are weak or unrelated

- Verify relevant packs are active.
- Add `@` focus to narrow answer scope.
- Wait a moment after pack changes, then ask again.
- Check model/base URL/API key settings.

## Local image not rendering

- Verify path is correct relative to current markdown file.
- Confirm extension is supported (`png`, `jpg`, `jpeg`, `gif`, `webp`, `svg`, `bmp`).
- Confirm image size is reasonable (very large images may be rejected).

## Import fails

- Zip must include `pack.json`.
- `pack.json.id` should match top-level folder name.
- `pack.json.version` should be a normal version string such as `1.0.0`.

## I deleted the bundled getting-started pack

- This is expected to be permanent for your current installation data.
- Nest does not auto-reinstall it after deletion.
- You can reinstall from Hub/import if a copy is available.
