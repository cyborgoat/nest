# Test Pyramid

The classic test pyramid suggests many fast unit tests, fewer integration tests, and a small number of end-to-end checks.

## Layers

- **Unit**: pure functions, chunking, ranking
- **Integration**: SQLite schema, IPC commands, vault I/O
- **E2E**: full desktop flows through the UI

Prefer deterministic unit tests for retrieval scoring and keep browser/desktop E2E focused on critical paths.
