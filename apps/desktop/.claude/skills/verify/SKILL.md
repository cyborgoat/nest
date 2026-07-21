---
name: verify
description: Build, launch, and observe the Nest desktop app (Tauri v2) to verify frontend/Rust changes at the real GUI surface.
---

# Verifying the Nest desktop app

## Build checks (fast, not a substitute for running)
```bash
cd apps/desktop && npx tsc --noEmit && npm run build
```

## Launch
1. Hub service (registry catalog) — often already running; check first:
   ```bash
   curl --noproxy '*' -s http://127.0.0.1:8787/health   # {"status":"ok"} if up
   cd apps/hub && npm run start   # if not
   ```
   IMPORTANT: the user's shell exports HTTP(S)_PROXY (clash on 127.0.0.1:7897);
   always pass `--noproxy '*'` to curl for localhost or you get bogus 502/timeouts.
2. Desktop app:
   ```bash
   cd apps/desktop && npm run tauri dev
   ```
   - Port 1420 is fixed (vite). **Check the user's tmux session first** — they
     often have `tauri dev` running in tmux (`tmux capture-pane -p -t 0:0.0`).
     Launching a second instance fails theirs with "Port 1420 is already in use".
   - Vite HMR means frontend edits reach an already-running app instantly.
   - Hub URL is persisted in app settings (SQLite); on this machine it is
     already set to http://127.0.0.1:8787.

## Observe (screenshots without stealing focus)
- `osascript -l JavaScript` (JXA) **segfaults on this machine** — don't use it.
- Get the CGWindowID with a small Swift tool (swiftc is available):
  compile CGWindowListCopyWindowInfo filtering kCGWindowOwnerName == "nest";
  the main window has name "Nest" and layer 0.
- Capture without raising: `screencapture -x -o -l <windowid> out.png`
  (screen-recording permission is granted for this shell).

## Drive (clicks)
- AppleScript System Events can click HTML buttons via the AX tree:
  `entire contents of window 1` of process "nest", match by `name`, `click`.
- **Only works when the window is on the active Space.** Off-space windows give
  "Can't get window 1 … Invalid index. (-1719)". Raising the app switches Spaces
  and steals the user's focus — if the user is active (check tmux pane / recent
  commands), don't fight them; capture what you can and report the rest.

## Example packs
Registry packs come from `examples/knowledge-packs` (customer-support,
devops-operations, llm-agents, product-management, software-engineering).
`GET /packs` on the hub lists them.
