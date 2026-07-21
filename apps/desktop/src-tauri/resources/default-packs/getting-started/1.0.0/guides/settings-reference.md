# Settings Reference

This page explains each setting and when to change it.

| Setting | What it controls | Typical value |
|---|---|---|
| LLM Base URL | OpenAI-compatible API endpoint | `https://api.openai.com/v1` |
| API key | Auth for your model provider | provider key |
| Chat model | Model used to generate answers | `gpt-4o-mini` |
| Hub URL | Remote catalog/download service | `http://127.0.0.1:8787` |
| Font size | Global UI text size | `10pt` default |
| User name | Optional profile display | your preferred name |
| Knowledge directory | Local storage location for packs | empty = app default |

## Knowledge directory tips

- Leave empty to use the app default location.
- If set, use an absolute path.
- If you change it, your Library will refresh to the new folder location.

## Hub URL tips

- Must be `http` or `https`.
- Trailing slash is fine; app normalizes it.
- If empty, Hub features are disabled but local browsing/chat still works.
