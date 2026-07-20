# Repository Pattern

The repository pattern isolates domain logic from persistence details. Callers depend on a repository interface; the implementation talks to SQL, files, or remote APIs.

## Benefits

- Keeps domain models free of storage concerns
- Makes unit testing easier with in-memory fakes
- Allows swapping storage backends without rewriting business rules

## In Nest

Nest's vault and notes layers are a practical example: the UI talks to IPC commands, while Rust owns filesystem and SQLite details.
