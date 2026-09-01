# Claude Agent

Nest supports two chat backends: the built-in **Nest Agent** (Rig + your OpenAI-compatible model) and **Claude Agent** (your local Claude CLI). A chat session binds one backend on its first message and keeps it for its lifetime.

## Setup (Settings → Claude Agent)

1. Toggle **Enable Claude Agent**.
2. Set the **CLI path**, or leave it empty and click **Auto-detect** (`claude.exe`, the npm `cli-wrapper.cjs`, and `claude` shims are resolved automatically). Manually entered paths accept renamed but equivalent CLI entry points — any `.exe`/`.cjs` file, or any `.cmd`/`.ps1` shim that resolves to the npm wrapper. A failed detect switches the placeholder to `Auto-detect Not Found`.
3. If your CLI variant needs additional non-interactive flags, enter them in **Custom startup arguments**. For example, `--skip-safe-check` suppresses the trust prompt in compatible Claude-derived CLIs. Quoted values are supported; the arguments are passed directly without shell expansion.
4. Click **Test connection** (or **Save and connect**). The test verifies:
   - the CLI launches and completes a real headless turn, and
   - the Nest MCP server responds through Claude: one `knowledge_list` call over a temporary probe pack succeeds.

   The connection report shows the resolved CLI path, version, and effective model. Any failure returns an error with the failing step; probe residue is reported if cleanup could not complete. Save and connect reuses an already-successful report for the same CLI path and startup arguments instead of re-testing.
5. **Custom models** lists model IDs (one per row, Enter adds a row). The current default model (from the latest successful test) appears read-only above your rows with a `[default]` badge; observed models from successful tests and chats are also selectable in chat without adding them here.

Disabling Claude Agent only affects new chats; conversations already bound to Claude stay bound.

Only one app-wide operation runs at a time. While a chat turn, connection test, Save and connect, Reindex, Vault switch, or session deletion is active, the composer and conflicting Settings controls are disabled and show the current operation. This prevents a configuration or Vault change from invalidating an in-flight Claude process.

## Composer selectors

The composer shows three capsules: **Agent → Model → Mode**.

| Capsule | Behavior |
|---------|----------|
| Agent | `Nest Agent` always available; `Claude` appears when the toggle is on and is disabled (with reason) while disconnected. Switching the agent on a bound chat creates a new chat and carries the unsent draft over. New chats inherit the most recently created chat's agent and model. |
| Model | Nest shows the configured `chat_model`. Claude shows the observed default model (labelled `(default)`) plus custom and detected models; the selection applies per turn and is passed as `--model`. |
| Mode | Ask / Agent, per session. |

Selections are revision-checked: if the chat changed underneath (another tab, a sync), sending returns `chat_selection_stale`, the session reloads, and you send again. Closing the last open tab automatically opens a fresh chat.

## Modes

- **Ask** is read-only. Claude gets only `knowledge_search`, `knowledge_list`, and `knowledge_read` via `--strict-mcp-config`; its native tools are limited to read-only ones (Read, Grep, Glob, WebSearch, WebFetch where available).
- **Agent** enables all six knowledge tools and keeps Claude's default native tools (Bash, Edit, Write, …) running with permissive execution. Native file changes apply to disk directly and are **not** staged as proposals.

## Nest knowledge tools

Claude accesses the vault through a loopback MCP server (`nest`) started inside Nest while a turn runs:

| Tool | Effect |
|------|--------|
| `knowledge_search` | Hybrid retrieval over active packs (same engine as Nest Agent RAG) |
| `knowledge_list` | Markdown paths in active packs, pending proposals included |
| `knowledge_read` | File content including this turn's staged edits |
| `knowledge_create` / `knowledge_replace` / `knowledge_delete` | Stage reviewable proposals |

Staged writes reuse the Nest Agent rules — active editable packs only, Markdown only, 256 KiB per file, 32 files and 2 MiB per turn, protected paths (open editor files) and publish-review locks respected. When the turn finishes, staged changes become pending proposals with diffs and Approve/Reject in the editor, exactly like Nest Agent proposals. Search, list, and read share an effective workspace view: this turn's staged content wins over pending proposals, and pending proposals win over the indexed file on disk. Staged or pending deletes hide stale index results.

Nest instructs Claude to prefer the knowledge tools over native file access for vault work; when Claude falls back to native tools, those changes are visible as tool activity but never appear as proposals or references.

If Claude changes the same file through a native tool and a Nest knowledge tool in one turn, Nest compares the staged base, the proposed content, and the current file at turn end. Non-overlapping edits are rebased into a new proposal for review. Overlapping edits become a conflict and never overwrite the native change. Approving a proposal repeats this check, so a file changed after the turn cannot be silently overwritten.

## Tool activity and references

Every tool call streams into the chat as a live activity row (spinner while running, check when done). After the turn, the assistant message keeps a collapsible **"Thought for N seconds · N tool calls"** section listing each tool with its target and outcome.

Agent mode keeps Claude's configured external MCP servers available; their calls are recorded as external tool activity and never receive Nest citation, staging, or proposal semantics. Ask mode uses a strict MCP configuration and exposes only Nest's read-only knowledge tools. The per-turn server ID `nest` is reserved for Nest's authenticated adapter.

References at the bottom of a reply list the files Claude actually read or searched through the knowledge tools — the same verifiable-source rule as Nest Agent citations. Native tool reads do not become references.

## Session continuity

Each Nest chat session UUID is also the Claude session ID. The first message starts a Claude conversation with `--session-id`; later messages resume it with `--resume`, so context persists across turns. Claude sessions keep the placeholder title until renamed (Nest sessions may use LLM-generated titles); deleting a Nest session does not delete Claude's local transcript.

## Recovery and troubleshooting

- Claude can modify active packs directly with native tools in Agent mode. Nest reconciles Markdown manifests and waits for indexing at turn end; there is no permanent filesystem watcher, so edits made outside a turn are discovered at startup, Reindex, Vault switch, the next turn, or the next knowledge review operation.
- If reconciliation or indexing fails, Nest shows **Reindex required**. Nest Agent and Nest knowledge tools remain unavailable until **Reindex now** succeeds; Claude's native Agent tools remain usable.
- Stopping or deleting an active Claude chat first terminates the process and aborts its staged work, then performs bounded reconciliation. Direct changes already written by native tools are retained.
- Interrupted proposal apply/rebase operations are claimed and journaled. Startup recovery completes or safely rolls back abandoned operations before normal editing continues.
- `operation_busy` means another chat, connection test, save, reindex, Vault switch, or deletion owns the app-wide operation slot. Wait for it to finish or stop the active chat.
- If a Claude-derived CLI reports that stdin is not a TTY while asking whether the project is trusted, add that CLI's non-interactive trust flag to **Custom startup arguments** and test the connection again.
- An unavailable historical backend remains visible on its old session but cannot send. Start a new session with an available Agent.

## Bundled tutorial packs

The getting-started guides shipped with every install cover agents in the dedicated
[Agents guide](../examples/knowledge-packs/getting-started/1.0.0/guides/agents.md)
(both backends, binding, models, and tool semantics), with setup pointers in
[Settings and account](../examples/knowledge-packs/getting-started/1.0.0/guides/settings-and-account.md)
and selector basics in
[Chat and `@` references](../examples/knowledge-packs/getting-started/1.0.0/guides/chat-and-references.md).
The Chinese edition (`getting-started-zh-cn`) mirrors all three. These packs live in
`examples/knowledge-packs/`, are compiled into the desktop binary, and are seeded on first
run — when you update these guides, re-run the desktop build so the embedded copy stays in
sync. Changing the pack contents also bumps the pack version per the
[pack registry](./pack-registry.md) conventions when publishing.
