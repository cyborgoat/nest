# Knowledge Pack Examples (Hub registry)

PyPI-style layout: `{pack-id}/{semver}/` with required `pack.json`.

This folder contains Hub registry example packs only. The official bundled first-run guide is stored separately in `apps/desktop/src-tauri/resources/default-packs/getting-started/1.0.0/`.

See [docs/pack-registry.md](../../docs/pack-registry.md).

```text
customer-support/
  1.0.0/pack.json
  1.1.0/pack.json
devops-operations/
  1.0.0/pack.json
  1.1.0/pack.json
llm-agents/
  0.0.1/pack.json
  0.1.0/pack.json
product-management/
  1.0.0/pack.json
  1.1.0/pack.json
software-engineering/
  1.0.0/pack.json
  1.1.0/pack.json
```

Validate: `node scripts/validate-pack-registry.mjs`
