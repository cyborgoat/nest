# Settings and Account

## Model connection

| Setting | Purpose | Example |
| --- | --- | --- |
| LLM Base URL | OpenAI-compatible API endpoint | `https://api.openai.com/v1` |
| API key | Credential for that endpoint | Provider-specific |
| Chat model | Model sent with completions | Provider-specific |
| Font size | Application text scale | `10pt` |
| Knowledge directory | Folder containing local packs | Empty uses the app default |

The model endpoint is contacted only when you use Chat. Keep API keys private.

## Hub connection

Set **Hub URL** to the service root, for example
`http://127.0.0.1:8787`. A trailing slash is accepted. Use the connection
status in Settings to verify the address before signing in.

## Account

Create or sign in to a Hub account from **Settings → Account**. Your account ID
is permanent; your display name and password can be changed later. Signing out
removes the local Hub session but does not remove installed packs.

An account is required for publishing and restricted content. It is not
required for local editing, Chat over local packs, or public Hub downloads.

## Moving the knowledge directory

Use an absolute path. After changing it, Nest reloads the Library from the new
location. Existing files are not silently copied, so move them yourself first
when you intend to preserve the same library.
