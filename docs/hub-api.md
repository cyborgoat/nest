# Hub API

The Hub API is optional for local desktop use. Anonymous clients can browse and download public packs; a Hub account is needed only to publish or access restricted packs. JSON fields use `snake_case`.

Authenticated routes accept `Authorization: Bearer <access_token>`. The admin browser console instead uses the same access/refresh values through `HttpOnly`, `SameSite=Strict` cookies. Access tokens are short lived; `POST /api/auth/refresh` rotates a refresh session.

## Public and optionally authenticated registry

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| `GET` | `/health` | Public | Process liveness |
| `GET` | `/ready` | Public | Registry path readiness |
| `GET` | `/packs` | Optional auth | Visible projects and version summaries |
| `GET` | `/packs/:id` | Optional auth | Visible project detail |
| `GET` | `/packs/:id/:version` | Optional auth | Visible release metadata |
| `GET` | `/packs/:id/download` | Optional auth | Latest non-yanked release ZIP |
| `GET` | `/packs/:id/:version/download` | Optional auth | Specific non-yanked release ZIP |

Restricted projects are available to their owner, explicitly granted users, admins, and the superuser. Public projects require no account.

Project responses include `author` and `maintainers` attribution. The author is
the submitter whose first approved publish request created the pack;
maintainers are the accounts currently allowed to publish later releases and
live patches. These roles can diverge after an administrator updates them.

## Account and publishing

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| `POST` | `/api/auth/register` | Public | Register `id`, `password`, and `name` |
| `POST` | `/api/auth/login` | Public | Start a session |
| `POST` | `/api/auth/refresh` | Refresh token/cookie | Rotate a session |
| `POST` | `/api/auth/logout` | Refresh token/cookie | Revoke a session and clear browser cookies |
| `GET` | `/api/auth/me` | User | Current immutable ID, name, and role |
| `PATCH` | `/api/auth/profile` | User | Change display name (managed superuser forbidden) |
| `POST` | `/api/auth/password` | User | Change password and rotate sessions (managed superuser forbidden) |
| `POST` | `/api/publish-requests` | User | Legacy release-only submission with multipart `file` and optional `commit_message` |
| `POST` | `/api/publish-requests/releases` | User | Submit a new version release with multipart `file` and `commit_message` |
| `POST` | `/api/publish-requests/live-patches/:packId/:version` | Pack maintainer | Submit a reviewed replacement with multipart `file` and `commit_message` |
| `GET` | `/api/publish-requests/mine` | User | Author's submissions |
| `GET` | `/api/publish-requests/pack/:packId/pending` | Pack maintainer, submitter, or registry admin | Current pending request plus whether the caller may cancel it |
| `GET` | `/api/publish-requests/:id` | Submitter, pack maintainer, or registry admin | One submission |
| `DELETE` | `/api/publish-requests/:id` | Original submitter | Cancel a pending submission and remove it from review |

Account IDs cannot be changed. The desktop surfaces Hub validation responses directly and keeps authentication errors inside the account dialog.

The desktop requires a trimmed publish commit message for both new releases and
live patches. Messages are limited to 500 characters, stored with the review,
and returned as `commit_message` in publish-request responses. The Hub accepts
an omitted message as empty only for compatibility with legacy API clients.

Submissions must differ from the pack's current published version. A semantic-
version bump by itself is not a pack change; file changes and release metadata
changes are. First-time publishes have no baseline and remain valid.

Live patches use the same review endpoints and pack-wide pending-request lock
as releases. The route identifies the target release; the server does not infer
the operation from optional multipart fields. The target must exist and not be
yanked; its identity and metadata cannot change. Approval atomically replaces
its full file snapshot and increments `patch_revision` without changing SemVer.
Downloads advertise the installed revision in `X-Pack-Patch-Revision`.

While a request is pending, the desktop makes the pack read-only and continues
to show the submitted Source Control changes. The original submitter may cancel
the request; cancellation removes its staged ZIP and derived review artifact,
records an audit event, and releases the lock. Admin review lists emphasize the
commit message, while the routed review detail also retains the pack description.

## Messages

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/messages?filter=all\|unread&cursor=...` | User | Cursor-paginated messages |
| `GET` | `/api/messages/unread-count` | User | Unread badge count |
| `PATCH` | `/api/messages/:id/read` | User | Mark one message read |
| `POST` | `/api/messages/read-all` | User | Mark every message read |
| `DELETE` | `/api/messages/:id` | User | Delete one message |
| `DELETE` | `/api/messages/read` | User | Delete all read messages |

Messages are emitted idempotently for publish submitted, approved, and rejected events.

## Administration

Every `/api/admin/*` route requires role `admin` or `superuser`.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/admin/users` | List accounts and managed status |
| `PATCH` | `/api/admin/users/:uuid` | Set `role` to `user` or `admin` |
| `DELETE` | `/api/admin/users/:uuid` | Delete an account according to role hierarchy |
| `POST` | `/api/admin/users/:uuid/reset-password` | Reset a user's password to the configured `DEFAULT_RESET_PASSWORD` and revoke their sessions (role hierarchy applies) |
| `GET` | `/api/admin/publish-requests` | List pending submissions |
| `GET` | `/api/admin/publish-requests/history` | Cursor-paginated approved/rejected history; filter with `status=all\|approved\|rejected` |
| `GET` | `/api/admin/publish-requests/:id/review` | Review metadata, frozen base version, change totals, and changed-file list |
| `GET` | `/api/admin/publish-requests/:id/review/file?path=…` | Unified text diff or image/binary review metadata for one changed file |
| `GET` | `/api/admin/publish-requests/:id/review/image?path=…&side=old\|new` | Safely stream one side of a changed image |
| `POST` | `/api/admin/publish-requests/:id/approve` | Publish the staged artifact with optional `{ "note": "…" }` |
| `POST` | `/api/admin/publish-requests/:id/reject` | Reject with required `note` |
| `GET` | `/api/admin/packs` | List projects, releases, author, maintainers, and access grants |
| `PATCH` | `/api/admin/packs/:id` | Edit author attribution with `author_uuid` (or `null`), visibility, or archive state |
| `DELETE` | `/api/admin/packs/:id` | Delete project metadata and release files |
| `POST` | `/api/admin/packs/:id/access/:userUuid` | Set grant using `{ "allowed": true\|false }` |
| `POST` | `/api/admin/packs/:id/maintainers/:userUuid` | Add or remove a maintainer using `{ "allowed": true\|false }` |
| `POST` | `/api/admin/packs/:id/releases/:version/yank` | Set `{ "yanked": true\|false }` |
| `POST` | `/api/admin/packs/upload` | Validate and immediately publish multipart field `file` |

Admins and the superuser have identical registry-management privileges. An admin can promote regular users and delete regular users, but cannot change or delete an existing admin. The superuser can demote or delete admins. The environment-managed superuser cannot be edited, demoted, have its password changed, or be deleted by any route.

The React operations console at `/admin` consumes these endpoints and requires an admin or superuser session.

Reviewed request history retains request metadata, checksum, validation file
list, submitter/reviewer identity snapshots, timestamps, reviewer comments, and
derived browser-review artifacts. These artifacts contain compressed text sides,
changed-image sides, and binary hashes relative to the base release frozen at
submission. Completed staging ZIPs are not retained; approved releases remain
available through their normal release download route. Reviews completed before
browser diffs were introduced retain their metadata but report their diff as
unavailable.
