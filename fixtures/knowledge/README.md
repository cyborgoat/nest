# Knowledge fixtures

Each pack lives in its own directory and **must** include `pack.json`:

```json
{
  "id": "getting-started",
  "name": "Getting Started",
  "description": "…",
  "version": "1.0.0",
  "path": "getting-started"
}
```

Required fields: `id`, `name`, `description`, `version`, `path` (`path` is a single vault folder name).

The Hub lists packs by scanning for `*/pack.json`. Downloads are zips of the pack directory (including `pack.json`). Desktop **Import** expects the same zip layout.
