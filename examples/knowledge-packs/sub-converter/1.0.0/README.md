# sub-converter

Convert proxy subscriptions into compact Clash-compatible YAML with a TypeScript Cloudflare Worker and a minimal Vite web UI.

Supported protocols: `ss`, `vmess`, `ssr`, `trojan`, `vless`, `socks`, `http`, `https`

## Projects

- `worker/`: Cloudflare Worker that fetches a subscription, decodes it, converts entries to Clash proxies, applies the compact policy template, optionally decorates proxy names with country flags, and returns a downloadable Clash profile named `clash-profile`
- `web/`: React app with Tailwind CSS and shadcn/ui that builds the worker request URL and uses the local worker service automatically in dev mode
- `clash_policy_template.yaml`: canonical compact policy template used to build `proxy-groups` and `rules`

## Worker

```bash
cd worker
npm install
npm run build
npm run dev
```

Local dev runs at `http://127.0.0.1:8787`.

Production endpoint: `https://sub.cyborgoat.com/`

Request shape:

```text
GET /?url=<percent-encoded-subscription-url>[&decorate=false]
```

The response is a Clash YAML profile with:

- converted `proxies`
- compact `proxy-groups`
- compact routing `rules`
- `subscription-info` metadata including source type, source encoding, and node count
- `Content-Disposition: attachment; filename=clash-profile`

See [`worker/README.md`](worker/README.md) for deployment and API details.

## Compact Profile Shape

The current template is intentionally trimmed for speed and smaller output. It keeps only:

- `PROXY`
- `AUTO`
- `DIRECT_GROUP`
- `REJECT_GROUP`
- `FINAL`

The rule set is also compact and focuses on:

- private and local network direct rules
- local router and LAN hostnames
- `GEOIP,CN,DIRECT_GROUP`
- `MATCH,FINAL`

This is a deliberate tradeoff: less routing detail and fewer manual selector groups in exchange for much faster generation on large subscriptions.

## Web UI

```bash
cd web
npm install
npm run dev
```

Worker endpoint resolution order:

1. `VITE_WORKER_URL` if set
2. `http://127.0.0.1:8787/` in Vite dev mode
3. `https://sub.cyborgoat.com/` in production

See [`web/README.md`](web/README.md) for build and GitHub Pages deployment details.

## Policy Template

`clash_policy_template.yaml` is JSON-compatible YAML. Only the `PROXY` and `AUTO` groups expand the `__ALL_PROXIES__` placeholder into converted proxy names.

The worker bundles a generated copy of this template at `worker/src/config/policy-template.ts` so Cloudflare Workers do not depend on filesystem reads at runtime.

## Notes

- The worker is the source of truth for conversion; the old Python package has been removed.
- Name decoration performs geo-IP lookups via geojs.io and can be disabled with `decorate=false`.
- The worker has been optimized to reduce per-request object churn and YAML output size.
- If `npm run build` for `web` resolves the wrong Node version on your machine, run Vite with your intended Node runtime explicitly.

## License

See [LICENSE](./LICENSE).
