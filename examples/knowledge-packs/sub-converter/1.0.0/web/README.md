# Sub-Converter Web

A minimal Vite + React frontend for the Cloudflare Worker. It accepts a subscription URL, URL-encodes it safely, and outputs the final worker link for downloading the compact Clash profile.

Built with Tailwind CSS, shadcn/ui, and a light sandy-brown theme.

## Local development

```bash
cd web
npm install
npm run dev
```

Worker endpoint resolution order:

```text
VITE_WORKER_URL
http://127.0.0.1:8787/          # when running in Vite dev mode
https://sub.cyborgoat.com/
```

## Build

```bash
npm run build
```

The current Vite toolchain requires a Node version compatible with the installed Vite release.

## GitHub Pages

The repo includes `.github/workflows/deploy-pages.yml` to deploy this app to GitHub Pages. The workflow sets `VITE_WORKER_URL=https://sub.cyborgoat.com/` at build time.
