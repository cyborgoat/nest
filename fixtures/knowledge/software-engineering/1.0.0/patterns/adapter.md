# Adapter Pattern

An adapter translates one interface into another without changing the underlying behavior.

LLM providers often differ slightly. An OpenAI-compatible adapter lets Nest call chat and embeddings endpoints through one contract even when the host is Azure, a local server, or another gateway.
