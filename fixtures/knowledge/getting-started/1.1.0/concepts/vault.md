# The Vault

The vault is Nest's local storage root for downloaded knowledge packs. Each pack mirrors a folder tree of Markdown files.

## Immutability

Knowledge files in the vault are read-only. Nest never writes to them after import or download. Your annotations live in a separate notes database keyed by file path.

## Typical layout

```
vault/
  getting-started/
    README.md
    concepts/
      vault.md
  software-engineering/
    patterns/
      repository.md
```

Relative paths inside the vault are stable identifiers used by notes, the search index, and chat citations.
