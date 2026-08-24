# Chat sessions

## UX model

- **Tabs** = browser-style open set. A session becomes a tab when created with **+** or opened from History. Closing a tab hides it from the bar only; the conversation remains in History. Closing the last open tab automatically opens a fresh chat.
- **History** (clock icon) lists non-archived sessions (pinned first), then an Archived section.
- Row actions (ellipsis): Pin / Unpin, Archive / Unarchive, Rename, Delete.

## Metadata (`chat_sessions`)

| Field | Meaning |
|-------|---------|
| `pinned` | Sorts to the top of History |
| `archived` | Moved to the Archived section; closed from tabs when archived |
| `title_source` | `placeholder` \| `llm` \| `manual` \| `local` |
| `mode` | `ask` (read-only answers) \| `agent` (permissioned Markdown tools) |
| `backend` | Bound execution backend (`nest` \| `claude`), set on first send and immutable |
| `selected_backend_id`, `selected_model_*` | Provisional agent/model selection before binding |
| `selection_revision` | Optimistic-concurrency counter for selection updates |

Additive SQLite migrations add these columns on existing DBs. Existing sessions migrate to `nest`.

See [Claude Agent](./claude-agent.md) for the Claude backend.

## Titles

- New chats start as **New chat** (`title_source = placeholder`).
- After the first successful assistant reply, the app may call the configured chat model to invent a short title (≤ ~6 words) and set `title_source = llm`. Claude-bound chats derive a local title from the first message instead (`title_source = local`).
- Rename sets `title_source = manual` and stops automatic retitling.
- Title generation failures leave the placeholder title.

## Retrieval context

Chat does not use a separate “scope” picker. Domain is:

1. All **active** packs (Library), and
2. Optional `@` focus paths sent as `focus_paths` on `chat_send`.

See [Architecture — Library / Chat focus](./architecture.md#library-active--inactive-packs).

## Ask and Agent modes

The selector in the lower-left of the composer is remembered per session. **Ask** is always read-only. **Agent** may list, read, create, replace, or delete Markdown files in active editable packs. Choosing Agent mode grants permission to create reviewable proposals. A successful response persists proposed before/after content without writing the vault; cancellation or model/tool failure discards the in-memory staging area.

Agent cannot edit bundled/unknown packs, inactive packs, packs under publish review, or files already open in Nest's editor. Registry packs require maintainer/owner or administrator access. A turn is limited to 32 changed files, 256 KiB per file, and 2 MiB total staged content.

The streaming reply reports files being edited and staged. Completed assistant messages retain a collapsible list of created, modified, and deleted files. Pending content is used by the Markdown renderer immediately, with a clear proposal banner. **Review in editor** opens a unified inline diff with old/new line numbers and **Approve** and **Reject** actions. Source Control keeps its separate side-by-side review layout. Approval revalidates permission and the original disk content before writing and indexing; rejection discards the proposal. Each proposal retains its pending, approved, or rejected status.

If the user continues in Agent mode before reviewing a proposal, unresolved proposals form the effective workspace: tool reads return proposed content, proposed creations appear in file listings, proposed deletions are treated as absent, and bounded pending content is included in the turn context as authoritative over the still-older retrieval index. A later proposal for the same path supersedes the earlier pending proposal while retaining the original disk snapshot for approval conflict checks.

## Commands

| Command | Purpose |
|---------|---------|
| `chat_create_session` | Create session |
| `chat_list_sessions` | All sessions (UI filters archived) |
| `chat_update_session` | Rename / pin / archive / select mode |
| `chat_update_selection` | Update agent/model/mode selection (revision-checked) |
| `chat_delete_session` | Hard delete (messages, turns, and activities cascade) |
| `chat_send` / `chat_cancel` | Streamed agent chat (`focus_paths` optional) |
| `chat_list_messages` | Session messages with turn association |
| `chat_list_turn_activities` | Persisted tool activity for a turn |
| `chat_get_file_change` | Load one persisted before/after snapshot for the diff UI |
