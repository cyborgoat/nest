# Sub-Converter Cloudflare Worker

A Cloudflare Workers service that converts proxy subscription URLs to compact Clash-compatible YAML profiles.

## Features

- Supports multiple proxy protocols: SS, VMess, SSR, Trojan, VLESS, SOCKS5, HTTP/HTTPS
- Automatic Base64 decoding of subscription data
- Converts to Clash YAML format using a compact shared policy template
- Optional country flag emoji decoration for proxy names (geojs.io lookup)
- Graceful error handling and descriptive error messages
- Serverless deployment on Cloudflare Workers

## Setup

### Prerequisites

- Node.js 18+ and npm
- Wrangler CLI (`npm install -g wrangler`)
- Cloudflare account

### Installation

```bash
cd worker
npm install
npm run build
```

## Development

Start the local development server:

```bash
npm run dev
```

This runs at `http://127.0.0.1:8787`.

### Test with curl

Convert a subscription URL to Clash YAML:

```bash
curl "http://127.0.0.1:8787/?url=https://example.com/subscription" -o clash-profile.yaml
```

Disable country flag decoration:

```bash
curl "http://127.0.0.1:8787/?url=https://example.com/subscription&decorate=false" -o clash-profile.yaml
```

Run tests:

```bash
npm test
```

## Deployment

1. Authenticate with Cloudflare:

```bash
wrangler login
```

2. Deploy:

```bash
npm run deploy
```

Production is configured in `wrangler.toml` with a custom domain at `sub.cyborgoat.com`.

To use a different domain, update the `routes` block in `wrangler.toml`:

```toml
routes = [
  { pattern = "sub.example.com", custom_domain = true }
]
```

## API Usage

### Endpoint

```text
GET /?url=<subscription_url>[&decorate=true/false]
```

The `url` query parameter should be percent-encoded by the client. The `web/` app handles that automatically.

### Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `url` | string | required | Subscription URL to convert |
| `decorate` | boolean | true | Add country flag emojis to proxy names |

### Response

Returns a Clash-compatible YAML configuration file with:

- Proxy list
- Compact proxy groups
- Compact routing rules
- Subscription metadata

### Examples

```bash
curl "https://sub.cyborgoat.com/?url=https%3A%2F%2Fexample.com%2Fsubscription" \
  -H "Accept: application/yaml" \
  -o clash-profile.yaml
```

```bash
curl "https://sub.cyborgoat.com/?url=https%3A%2F%2Fexample.com%2Fsubscription&decorate=false" \
  -o clash-profile.yaml
```

## Error Handling

- **400 Bad Request**: Missing `url` parameter or no valid proxies found
- **500 Internal Server Error**: Failed to fetch, decode, or parse subscription
- **HTTP errors**: Timeout or subscription server unreachable

All errors include descriptive messages for debugging.

## Supported Proxy Protocols

- **SS** (ShadowSocks)
- **VMess**
- **SSR** (ShadowSocksR)
- **Trojan**
- **VLESS**
- **SOCKS5**
- **HTTP/HTTPS**

## How It Works

1. Fetches the subscription from the provided URL
2. Auto-detects and decodes Base64 encoded subscriptions
3. Parses individual proxy entries (protocol-specific)
4. Converts to Clash proxy format
5. Optionally decorates proxy names with country flags (via geojs.io)
6. Expands `__ALL_PROXIES__` only inside `PROXY` and `AUTO`
7. Renders compact Clash YAML configuration
8. Returns with YAML content type and filename `clash-profile`

## Geolocation Decoration

When `decorate=true` (default), the worker looks up each proxy server's IP to determine its country and adds the corresponding flag emoji. Unknown countries fall back to a globe emoji. Pass `&decorate=false` to skip.

Geolocation lookups add latency. Disable them if speed is more important than decorated names.

## Compact Template

The worker uses a deliberately compact template for better performance on large subscriptions. It keeps only:

- `PROXY`
- `AUTO`
- `DIRECT_GROUP`
- `REJECT_GROUP`
- `FINAL`

The rule set is intentionally minimal and focuses on private/local traffic plus a final fallback route.

## Architecture

```text
src/
├── index.ts              Main Worker handler
├── config/
│   └── policy-template.ts Bundled compact policy template
├── services/
│   └── subscription.ts   Fetch, decode, split entries
├── parsers/
│   ├── index.ts          Entry dispatcher
│   ├── ss.ts             ShadowSocks parser
│   ├── vmess.ts          VMess parser
│   ├── ssr.ts            ShadowSocksR parser
│   └── generic.ts        Trojan, VLESS, SOCKS, HTTP
├── converters/
│   └── clash.ts          Build Clash config
├── renderers/
│   └── yaml.ts           YAML serialization
├── decorators/
│   └── flag.ts           Country flag decoration
└── utils/
    ├── types.ts          TypeScript interfaces
    └── url.ts            URL parsing helpers
```

## Building

```bash
npm run build      # Compile TypeScript to dist/
npm run dev        # Local development server
npm run deploy     # Deploy to Cloudflare Workers
npm test           # Build and run tests
```

## License

See LICENSE file in parent directory.

## Notes

- Worker execution timeout: 15 seconds (includes geolocation lookups)
- Maximum payload size: Standard Cloudflare Workers limits
- Geolocation powered by geojs.io (free, no auth required)
- YAML rendering uses a custom renderer (no external dependencies)
