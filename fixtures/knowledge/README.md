# Knowledge fixtures (Hub registry)

PyPI-style layout: `{pack-id}/{semver}/` with required `pack.json`.

See [docs/pack-registry.md](../../docs/pack-registry.md).

```text
getting-started/
  1.0.0/pack.json
  1.1.0/pack.json
software-engineering/
  1.0.0/pack.json
```

Validate: `node scripts/validate-pack-registry.mjs`
