# Chat sessions

## UX model

- **Tabs** = browser-style open set. A session becomes a tab when created with **+** or opened from History. Closing a tab hides it from the bar only; the conversation remains in History.
- **History** (clock icon) lists non-archived sessions (pinned first), then an Archived section.
- Row actions (ellipsis): Pin / Unpin, Archive / Unarchive, Rename, Delete.

## Metadata (`chat_sessions`)

| Field | Meaning |
|-------|---------|
| `pinned` | Sorts to the top of History |
| `archived` | Moved to the Archived section; closed from tabs when archived |
| `title_source` | `placeholder` \| `llm` \| `manual` |

Additive SQLite migrations add these columns on existing DBs.

## Titles

- New chats start as **New chat** (`title_source = placeholder`).
- After the first successful assistant reply, the app may call the configured chat model to invent a short title (≤ ~6 words) and set `title_source = llm`.
- Rename sets `title_source = manual` and stops automatic retitling.
- Title generation failures leave the placeholder title.

## Retrieval context

Chat does not use a separate “scope” picker. Domain is:

1. All **active** packs (Library), and
2. Optional `@` focus paths sent as `focus_paths` on `chat_send`.

See [Architecture — Library / Chat focus](./architecture.md#library-active--inactive-packs).

## Commands

| Command | Purpose |
|---------|---------|
| `chat_create_session` | Create session |
| `chat_list_sessions` | All sessions (UI filters archived) |
| `chat_update_session` | Rename / pin / archive |
| `chat_delete_session` | Hard delete (messages cascade) |
| `chat_send` / `chat_cancel` | Streamed agent chat (`focus_paths` optional) |
