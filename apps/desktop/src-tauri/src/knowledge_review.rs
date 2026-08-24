use crate::db::{self, NewChatFileChange};
use crate::error::{AppError, AppResult};
use crate::state::SharedState;
use crate::vault;
use std::path::Path;

#[allow(dead_code)]
pub const REVIEW_STATUS_PENDING: &str = "pending";
#[allow(dead_code)]
pub const REVIEW_STATUS_APPLYING: &str = "applying";
#[allow(dead_code)]
pub const REVIEW_STATUS_APPROVED: &str = "approved";
pub const REVIEW_STATUS_REJECTED: &str = "rejected";
#[allow(dead_code)]
pub const REVIEW_STATUS_FAILED: &str = "failed";
pub const REVIEW_STATUS_CONFLICTED: &str = "conflicted";

pub enum ReviewOutcome {
    Approved,
    Rejected,
    RebasedReviewRequired,
    Conflicted,
    ResolvedExternal,
    Failed { code: String, message: String },
}

pub enum ReconcileOutcome {
    Rebased,
    Conflicted,
    ResolvedExternal,
    Unchanged,
}

fn content_hash(content: Option<&str>) -> String {
    use std::fmt::Write as _;
    let mut hash = 0xcbf29ce484222325_u64;
    let marker = if content.is_some() { 1_u8 } else { 0_u8 };
    hash ^= u64::from(marker);
    hash = hash.wrapping_mul(0x100000001b3);
    if let Some(content) = content {
        for byte in content.as_bytes() {
            hash ^= u64::from(*byte);
            hash = hash.wrapping_mul(0x100000001b3);
        }
    }
    let mut out = String::with_capacity(16);
    let _ = write!(&mut out, "{hash:016x}");
    out
}

pub fn recover_claimed_changes(conn: &rusqlite::Connection, vault_root: &Path) -> AppResult<usize> {
    let claimed = db::list_claimed_chat_file_changes(conn)?;
    for change in &claimed {
        if change.status == "rebasing" && change.claim_kind == "rebase" {
            db::release_chat_file_change_claim(conn, &change.id, &change.claim_id)?;
            continue;
        }
        if change.status != "applying" || change.claim_kind != "apply" {
            db::conflict_claimed_chat_file_change(
                conn,
                &change.id,
                "startup recovery found an invalid proposal claim state",
                &change.claim_id,
            )?;
            continue;
        }
        let disk = vault::read_file(vault_root, &change.path).ok();
        let disk_hash = content_hash(disk.as_deref());
        match (
            change.expected_old_hash.as_deref(),
            change.expected_new_hash.as_deref(),
        ) {
            (_, Some(expected_new)) if disk_hash == expected_new => {
                db::approve_chat_file_change(conn, &change.id, &change.claim_id)?;
            }
            (Some(expected_old), _) if disk_hash == expected_old => {
                db::release_chat_file_change_claim(conn, &change.id, &change.claim_id)?;
            }
            _ => {
                db::conflict_claimed_chat_file_change(
                    conn,
                    &change.id,
                    "startup recovery found workspace content outside the apply journal",
                    &change.claim_id,
                )?;
            }
        }
    }
    Ok(claimed.len())
}

pub fn reconcile_pending_change(
    state: &SharedState,
    change: &db::ChatFileChangeDetail,
) -> AppResult<ReconcileOutcome> {
    let root = state.vault_path();
    let current = vault::read_file(&root, &change.path).ok();
    if current == change.old_content {
        return Ok(ReconcileOutcome::Unchanged);
    }
    let old_hash = content_hash(change.old_content.as_deref());
    let new_hash = content_hash(change.new_content.as_deref());
    let claim_id = uuid::Uuid::new_v4().to_string();
    {
        let conn = state.db.lock();
        db::claim_chat_file_change(&conn, &change.id, &claim_id, "rebase", None, None)?;
    }
    let result = (|| -> AppResult<ReconcileOutcome> {
        match (&change.old_content, &change.new_content, &current) {
            (Some(old), Some(_), Some(disk)) => {
                if disk == change.new_content.as_deref().unwrap() {
                    {
                        let conn = state.db.lock();
                        db::resolve_chat_file_change_externally(
                            &conn,
                            &change.id,
                            "proposal already satisfied by external change",
                            &claim_id,
                        )?;
                    }
                    Ok(ReconcileOutcome::ResolvedExternal)
                } else {
                    let _ = old;
                    let base = change.old_content.as_deref().unwrap_or("");
                    let proposed = change.new_content.as_deref().unwrap_or("");
                    match crate::knowledge_merge::merge_text(base, proposed, disk) {
                        crate::knowledge_merge::MergeOutcome::Clean(merged) => {
                            if merged == disk.as_str() {
                                {
                                    let conn = state.db.lock();
                                    db::resolve_chat_file_change_externally(
                                        &conn,
                                        &change.id,
                                        "clean merge equals current disk content",
                                        &claim_id,
                                    )?;
                                }
                                Ok(ReconcileOutcome::ResolvedExternal)
                            } else {
                                {
                                    let conn = state.db.lock();
                                    db::rebase_chat_file_change(
                                        &conn,
                                        &change.id,
                                        Some(disk),
                                        Some(&merged),
                                        &old_hash,
                                        &new_hash,
                                        &claim_id,
                                    )?;
                                }
                                Ok(ReconcileOutcome::Rebased)
                            }
                        }
                        crate::knowledge_merge::MergeOutcome::Conflicted => {
                            {
                                let conn = state.db.lock();
                                db::conflict_chat_file_change(
                                    &conn,
                                    &change.id,
                                    "overlapping edits conflict with external changes",
                                    &claim_id,
                                )?;
                            }
                            Ok(ReconcileOutcome::Conflicted)
                        }
                    }
                }
            }
            _ => {
                {
                    let conn = state.db.lock();
                    db::conflict_chat_file_change(
                        &conn,
                        &change.id,
                        "create/delete proposal cannot be auto-merged with external change",
                        &claim_id,
                    )?;
                }
                Ok(ReconcileOutcome::Conflicted)
            }
        }
    })();
    if result.is_err() {
        let conn = state.db.lock();
        let _ = db::release_chat_file_change_claim(&conn, &change.id, &claim_id);
    }
    result
}

pub struct KnowledgeReview;

impl KnowledgeReview {
    pub fn review(state: &SharedState, change_id: &str, approve: bool) -> AppResult<ReviewOutcome> {
        let change = {
            let conn = state.db.lock();
            let change = db::get_chat_file_change(&conn, change_id)?;
            if change.status == REVIEW_STATUS_CONFLICTED && !approve {
                db::set_chat_file_change_status(&conn, change_id, REVIEW_STATUS_REJECTED)?;
                return Ok(ReviewOutcome::Rejected);
            }
            if change.status != REVIEW_STATUS_PENDING {
                return Err(AppError::msg("File change is no longer pending"));
            }
            if !approve {
                db::set_chat_file_change_status(&conn, change_id, REVIEW_STATUS_REJECTED)?;
                return Ok(ReviewOutcome::Rejected);
            }
            change
        };

        match reconcile_pending_change(state, &change)? {
            ReconcileOutcome::Unchanged => {}
            ReconcileOutcome::Rebased => {
                return Ok(ReviewOutcome::RebasedReviewRequired);
            }
            ReconcileOutcome::Conflicted => {
                return Ok(ReviewOutcome::Conflicted);
            }
            ReconcileOutcome::ResolvedExternal => {
                return Ok(ReviewOutcome::ResolvedExternal);
            }
        }

        let change = {
            let conn = state.db.lock();
            db::get_chat_file_change(&conn, change_id)?
        };
        if change.status != REVIEW_STATUS_PENDING {
            return Ok(ReviewOutcome::Conflicted);
        }
        let claim_id = uuid::Uuid::new_v4().to_string();
        let expected_old_hash = content_hash(change.old_content.as_deref());
        let expected_new_hash = content_hash(change.new_content.as_deref());
        {
            let conn = state.db.lock();
            db::claim_chat_file_change(
                &conn,
                change_id,
                &claim_id,
                "apply",
                Some(&expected_old_hash),
                Some(&expected_new_hash),
            )?;
        }

        let applied = Self::apply_change(state, &change);
        match applied {
            Ok(()) => {
                {
                    let conn = state.db.lock();
                    if let Err(error) =
                        db::mark_chat_file_change_written(&conn, change_id, &claim_id)
                            .and_then(|_| db::approve_chat_file_change(&conn, change_id, &claim_id))
                    {
                        return Ok(ReviewOutcome::Failed {
                            code: "apply_status_failed".to_string(),
                            message: error.to_string(),
                        });
                    }
                }
                let _ = crate::indexing::schedule(state);
                Ok(ReviewOutcome::Approved)
            }
            Err(error) => {
                let status = {
                    let conn = state.db.lock();
                    db::fail_chat_file_change(
                        &conn,
                        change_id,
                        "apply_failed",
                        &error.to_string(),
                        &claim_id,
                    )
                };
                Ok(ReviewOutcome::Failed {
                    code: if status.is_ok() {
                        "apply_failed".to_string()
                    } else {
                        "apply_status_failed".to_string()
                    },
                    message: status
                        .err()
                        .map_or_else(|| error.to_string(), |e| e.to_string()),
                })
            }
        }
    }

    fn apply_change(state: &SharedState, change: &db::ChatFileChangeDetail) -> AppResult<()> {
        let root = state.vault_path();
        ensure_editable(state, &change.path)?;
        let current = vault::read_file(&root, &change.path).ok();
        if current != change.old_content {
            return Err(AppError::msg(format!(
                "{} changed after the proposal was created; review it again before applying",
                change.path
            )));
        }
        match &change.new_content {
            Some(content) => vault::write_file(&root, &change.path, content),
            None => vault::delete_file(&root, &change.path),
        }
    }
}

#[allow(dead_code)]
pub fn rollback_changes(state: &SharedState, changes: &[NewChatFileChange]) {
    let originals = changes
        .iter()
        .map(|change| (change.path.clone(), change.old_content.clone()))
        .collect::<Vec<_>>();
    rollback_files(&state.vault_path(), &originals);
}

fn rollback_files(root: &Path, files: &[(String, Option<String>)]) {
    for (path, original) in files.iter().rev() {
        match original {
            Some(content) => {
                let _ = vault::write_file(root, path, content);
            }
            None => {
                let _ = vault::delete_file(root, path);
            }
        }
    }
}

fn ensure_editable(state: &SharedState, path: &str) -> AppResult<()> {
    if !vault::is_markdown_path(path) {
        return Err(AppError::msg(
            "Knowledge tools can only edit Markdown (.md) files",
        ));
    }
    ensure_no_symlink_components(&state.vault_path(), path)?;
    let candidate = Path::new(path);
    let pack = {
        let conn = state.db.lock();
        db::list_sync_state(&conn)?
            .into_iter()
            .filter(|pack| pack.active)
            .find(|pack| {
                let root = Path::new(&pack.local_path);
                candidate.starts_with(root) && candidate != root
            })
            .ok_or_else(|| AppError::msg(format!("Path is not inside an active pack: {path}")))?
    };
    crate::commands::ensure_pack_not_review_locked(&pack)?;
    let user = state
        .hub_auth
        .lock()
        .as_ref()
        .map(|session| session.user.clone());
    let permitted = match pack.origin.as_str() {
        "local" => true,
        "registry" => user.as_ref().is_some_and(|user| {
            user.role == "admin"
                || user.role == "superuser"
                || pack.owner_id.as_deref() == Some(user.id.as_str())
        }),
        _ => false,
    };
    if !permitted {
        return Err(AppError::msg(format!(
            "You do not have edit access to {}",
            pack.name
        )));
    }
    Ok(())
}

fn ensure_no_symlink_components(root: &Path, rel_path: &str) -> AppResult<()> {
    let mut probe = root.to_path_buf();
    for component in Path::new(rel_path).components() {
        probe.push(component);
        if let Ok(metadata) = std::fs::symlink_metadata(&probe) {
            if metadata.file_type().is_symlink() {
                return Err(AppError::msg(
                    "Knowledge tools cannot edit through symbolic links",
                ));
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod reconcile_tests {
    use super::*;
    use std::sync::Arc;

    struct Env {
        state: SharedState,
        _root: std::path::PathBuf,
    }

    fn setup(pack: &str, file: &str, content: &str) -> Env {
        let state = Arc::new(
            crate::state::AppState::new(
                std::env::temp_dir().join(format!("nest-reconcile-{}", uuid::Uuid::new_v4())),
            )
            .unwrap(),
        );
        let vault = state.vault_path();
        std::fs::create_dir_all(vault.join(pack)).unwrap();
        std::fs::write(vault.join(pack).join(file), content).unwrap();
        {
            let conn = state.db.lock();
            db::upsert_sync_state(
                &conn,
                db::SyncStateUpsert {
                    pack_id: pack,
                    name: pack,
                    version: "1.0.0",
                    local_path: pack,
                    origin: "local",
                    owner_id: None,
                    description: "",
                    patch_revision: 0,
                },
            )
            .unwrap();
        }
        Env {
            state,
            _root: vault,
        }
    }

    fn insert_pending(env: &Env, path: &str, old: Option<&str>, new: Option<&str>) -> String {
        let conn = env.state.db.lock();
        let session_id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO chat_sessions (id, title, title_source, mode, created_at, updated_at)
             VALUES (?1, 't', 'placeholder', 'ask', '2026-01-01', '2026-01-01')",
            rusqlite::params![session_id],
        )
        .unwrap();
        let message_id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO chat_messages (id, session_id, role, content, citations_json, created_at)
             VALUES (?1, ?2, 'assistant', 'm', '', '2026-01-01')",
            rusqlite::params![message_id, session_id],
        )
        .unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO chat_file_changes (id, message_id, path, operation, status, old_content, new_content)
             VALUES (?1, ?2, ?3, 'modified', 'pending', ?4, ?5)",
            rusqlite::params![id, message_id, path, old, new],
        )
        .unwrap();
        id
    }

    fn current_change(env: &Env, id: &str) -> db::ChatFileChangeDetail {
        let conn = env.state.db.lock();
        db::get_chat_file_change(&conn, id).unwrap()
    }

    #[test]
    fn unchanged_baseline_returns_unchanged() {
        let env = setup("p", "a.md", "one\ntwo\nthree");
        let id = insert_pending(
            &env,
            "p/a.md",
            Some("one\ntwo\nthree"),
            Some("X\ntwo\nthree"),
        );
        let change = current_change(&env, &id);
        assert!(matches!(
            reconcile_pending_change(&env.state, &change).unwrap(),
            ReconcileOutcome::Unchanged
        ));
    }

    #[test]
    fn independent_external_edit_rebases_onto_disk() {
        let env = setup("p", "a.md", "one\ntwo\nthree");
        let id = insert_pending(
            &env,
            "p/a.md",
            Some("one\ntwo\nthree"),
            Some("ONE\ntwo\nthree"),
        );
        std::fs::write(env.state.vault_path().join("p/a.md"), "one\ntwo\nTHREE").unwrap();
        let change = current_change(&env, &id);
        assert!(matches!(
            reconcile_pending_change(&env.state, &change).unwrap(),
            ReconcileOutcome::Rebased
        ));
        let rebased = current_change(&env, &id);
        assert_eq!(rebased.status, "pending");
        assert_eq!(rebased.old_content.as_deref(), Some("one\ntwo\nTHREE"));
        assert_eq!(rebased.new_content.as_deref(), Some("ONE\ntwo\nTHREE"));
        assert_eq!(rebased.rebase_count, 1);
        assert!(rebased.last_rebased_at.is_some());
    }

    #[test]
    fn already_satisfied_proposal_resolves_external() {
        let env = setup("p", "a.md", "one\ntwo\nthree");
        let id = insert_pending(
            &env,
            "p/a.md",
            Some("one\ntwo\nthree"),
            Some("one\ntwo\nNEW"),
        );
        std::fs::write(env.state.vault_path().join("p/a.md"), "one\ntwo\nNEW").unwrap();
        let change = current_change(&env, &id);
        assert!(matches!(
            reconcile_pending_change(&env.state, &change).unwrap(),
            ReconcileOutcome::ResolvedExternal
        ));
        let resolved = current_change(&env, &id);
        assert_eq!(resolved.status, "resolved_external");
        assert!(resolved.resolution_reason.is_some());
    }

    #[test]
    fn overlapping_external_edit_conflicts() {
        let env = setup("p", "a.md", "one\ntwo\nthree");
        let id = insert_pending(
            &env,
            "p/a.md",
            Some("one\ntwo\nthree"),
            Some("one\nCHANGED\nthree"),
        );
        std::fs::write(env.state.vault_path().join("p/a.md"), "one\nOTHER\nthree").unwrap();
        let change = current_change(&env, &id);
        assert!(matches!(
            reconcile_pending_change(&env.state, &change).unwrap(),
            ReconcileOutcome::Conflicted
        ));
        let conflicted = current_change(&env, &id);
        assert_eq!(conflicted.status, "conflicted");
    }

    #[test]
    fn conflicted_proposal_can_only_be_rejected() {
        let env = setup("p", "a.md", "one\ntwo\nthree");
        let id = insert_pending(
            &env,
            "p/a.md",
            Some("one\ntwo\nthree"),
            Some("one\nCHANGED\nthree"),
        );
        std::fs::write(env.state.vault_path().join("p/a.md"), "one\nOTHER\nthree").unwrap();
        assert!(
            matches!(
                KnowledgeReview::review(&env.state, &id, true).unwrap(),
                ReviewOutcome::Conflicted
            ),
            "approving after an overlapping external change must conflict, not apply"
        );
        assert!(
            KnowledgeReview::review(&env.state, &id, true).is_err(),
            "approving a conflicted proposal must fail outright"
        );
        assert!(matches!(
            KnowledgeReview::review(&env.state, &id, false).unwrap(),
            ReviewOutcome::Rejected
        ));
        let rejected = current_change(&env, &id);
        assert_eq!(rejected.status, "rejected");
    }

    #[test]
    fn rebase_on_approve_requires_second_review() {
        let env = setup("p", "a.md", "one\ntwo\nthree");
        let id = insert_pending(
            &env,
            "p/a.md",
            Some("one\ntwo\nthree"),
            Some("ONE\ntwo\nthree"),
        );
        std::fs::write(env.state.vault_path().join("p/a.md"), "one\ntwo\nTHREE").unwrap();
        assert!(matches!(
            KnowledgeReview::review(&env.state, &id, true).unwrap(),
            ReviewOutcome::RebasedReviewRequired
        ));
        let rebased = current_change(&env, &id);
        assert_eq!(rebased.status, "pending", "rebased proposal stays pending");
        assert!(matches!(
            KnowledgeReview::review(&env.state, &id, true).unwrap(),
            ReviewOutcome::Approved
        ));
    }

    #[test]
    fn only_claim_owner_can_commit_apply() {
        let env = setup("p", "a.md", "old");
        let id = insert_pending(&env, "p/a.md", Some("old"), Some("new"));
        let conn = env.state.db.lock();
        db::claim_chat_file_change(
            &conn,
            &id,
            "owner-a",
            "apply",
            Some(&content_hash(Some("old"))),
            Some(&content_hash(Some("new"))),
        )
        .unwrap();
        assert!(db::approve_chat_file_change(&conn, &id, "owner-b").is_err());
        assert_eq!(
            db::get_chat_file_change(&conn, &id).unwrap().status,
            "applying"
        );
    }

    #[test]
    fn startup_recovery_commits_a_completed_write() {
        let env = setup("p", "a.md", "old");
        let id = insert_pending(&env, "p/a.md", Some("old"), Some("new"));
        {
            let conn = env.state.db.lock();
            db::claim_chat_file_change(
                &conn,
                &id,
                "owner",
                "apply",
                Some(&content_hash(Some("old"))),
                Some(&content_hash(Some("new"))),
            )
            .unwrap();
            db::mark_chat_file_change_written(&conn, &id, "owner").unwrap();
        }
        std::fs::write(env.state.vault_path().join("p/a.md"), "new").unwrap();
        {
            let conn = env.state.db.lock();
            assert_eq!(
                recover_claimed_changes(&conn, &env.state.vault_path()).unwrap(),
                1
            );
        }
        assert_eq!(current_change(&env, &id).status, "approved");
    }

    #[test]
    fn startup_recovery_releases_an_unwritten_apply() {
        let env = setup("p", "a.md", "old");
        let id = insert_pending(&env, "p/a.md", Some("old"), Some("new"));
        {
            let conn = env.state.db.lock();
            db::claim_chat_file_change(
                &conn,
                &id,
                "owner",
                "apply",
                Some(&content_hash(Some("old"))),
                Some(&content_hash(Some("new"))),
            )
            .unwrap();
            recover_claimed_changes(&conn, &env.state.vault_path()).unwrap();
        }
        assert_eq!(current_change(&env, &id).status, "pending");
    }

    #[test]
    fn startup_recovery_conflicts_an_ambiguous_apply() {
        let env = setup("p", "a.md", "old");
        let id = insert_pending(&env, "p/a.md", Some("old"), Some("new"));
        {
            let conn = env.state.db.lock();
            db::claim_chat_file_change(
                &conn,
                &id,
                "owner",
                "apply",
                Some(&content_hash(Some("old"))),
                Some(&content_hash(Some("new"))),
            )
            .unwrap();
        }
        std::fs::write(env.state.vault_path().join("p/a.md"), "other").unwrap();
        {
            let conn = env.state.db.lock();
            recover_claimed_changes(&conn, &env.state.vault_path()).unwrap();
        }
        assert_eq!(current_change(&env, &id).status, "conflicted");
    }

    #[test]
    fn startup_recovery_releases_an_interrupted_rebase() {
        let env = setup("p", "a.md", "old");
        let id = insert_pending(&env, "p/a.md", Some("old"), Some("new"));
        {
            let conn = env.state.db.lock();
            db::claim_chat_file_change(&conn, &id, "owner", "rebase", None, None).unwrap();
            recover_claimed_changes(&conn, &env.state.vault_path()).unwrap();
        }
        assert_eq!(current_change(&env, &id).status, "pending");
    }
}
