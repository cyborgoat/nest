# Information Retrieval

When you ask a question, Nest searches your local index for relevant Markdown chunks, then sends those chunks to your configured LLM as context.

## Scope

You can:

- Search the whole library
- Limit retrieval to selected folders or files

Scoped retrieval only searches chunks whose file paths fall under the selected tree nodes.

## Citations

Retrieved chunks are returned as explicit references with:

- File path
- Snippet text
- Relevance score

The chat UI always shows these references so you can verify where an answer came from.
