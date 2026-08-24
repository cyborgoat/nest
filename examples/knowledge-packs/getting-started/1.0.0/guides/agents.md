# 接入 Agents 开始对话

Nest chats run on an **agent** (the backend that produces answers and runs
tools). Two agents ship with the app, and a chat keeps whichever one it
started with.

## The two agents

| | Nest Agent | Claude Agent |
|---|---|---|
| Runs on | The model you configure (any OpenAI-compatible API) | Your local Claude CLI |
| Setup | API base URL, key, and model in Settings | Enable in Settings, then **Save and connect** |
| Knowledge tools | Built in (search, read, list, staged edits) | Same tools, provided through Nest |
| References | From its own retrieval | From the knowledge tools it actually calls |
| Chat modes | Ask (read-only) and Agent (reviewable proposals) | Same two modes |

## Choosing an agent

The chat box starts with three selectors: **Agent**, **Model**, and **Mode**.

- A new conversation is **unbound** until you send its first message. The
  agent you picked applies at that moment and is then fixed for the
  conversation.
- Switching the agent on a conversation that already has messages starts a
  **new chat** and carries your unsent draft over. The original conversation
  is untouched in History.
- New chats start with the agent and model of the most recently created
  chat, so your usual setup follows you.
- Disabling an agent in Settings affects only new chats. Conversations bound
  to it stay bound; a Claude conversation simply waits until Claude is
  enabled again.

## Nest Agent setup

Chat needs an OpenAI-compatible API. In **Settings → LLM**, enter the base
URL (for example `https://api.openai.com/v1` or your OpenRouter or
self-hosted endpoint), the API key, and the model name. No other
configuration is required. The same model also generates conversation
titles.

## Claude Agent setup

Claude Agent routes chats through the Claude CLI already installed and
signed in on your computer.

1. In **Settings → Claude Agent**, enable **Enable Claude Agent**.
2. Set the CLI path, or leave it empty and click **Auto-detect** — Nest
   finds `claude.exe`, the npm wrapper, or a `claude` shim automatically.
   A failed detect changes the placeholder to `Auto-detect Not Found`.
3. Click **Save and connect**. Nest verifies the CLI runs, sends a real
   test message, and exercises all six knowledge tools in a temporary pack
   that it cleans up afterwards. Every step must pass before the connection
   counts.

### Models

Claude Agent models come from two places:

- The model the CLI is currently using, shown in the chat box with a
  `(default)` marker.
- **Custom models** you list in Settings (one per row). Models observed from
  successful tests and chats also appear in chat automatically under
  **Detected models** — no need to copy them down.

The model applies per message, so you can switch mid-conversation.

## Knowledge tools and proposals

In **Agent** mode, both agents use the same Nest tools to change Markdown
in active packs: edits are staged as proposals, previewed in the viewer, and
applied only when you approve them in the editor. The same limits apply to
both: active editable packs only, Markdown only, at most 32 files and 2 MiB
per turn, and files open in the editor or under publish review are
protected.

Claude Agent also keeps Claude's native tools (Bash, Edit, Write, …) in
**Agent** mode. Changes made with those tools write to disk directly and
are **not** staged as proposals — Nest marks them as direct changes in the
tool activity list so you can tell them apart.

**Ask** mode is read-only for both agents.

## Tool activity and references

While an agent works, the chat shows each tool call as a live row (spinner
while running, check when done). After the reply, a collapsible
**"Thought for N seconds · N tool calls"** section keeps the full list.

References under a reply list the files the agent actually read or searched.
Verify important statements against them.
