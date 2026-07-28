use crate::db;
use crate::error::{AppError, AppResult};
use crate::vault;
use include_dir::{include_dir, Dir};
use rusqlite::Connection;
use serde::Deserialize;
use std::fs;
use std::path::{Path, PathBuf};

const DEFAULT_PACK_ID: &str = "getting-started";
const DEFAULT_PACK_NAME: &str = "Getting Started";
const DEFAULT_PACK_MARKER: &str = ".default-pack-seeded-v1";
const ZH_CN_PACK_ID: &str = "getting-started-zh-cn";
const ZH_CN_PACK_NAME: &str = "Nest 快速入门（简体中文）";
const ZH_CN_PACK_MARKER: &str = ".default-pack-zh-cn-seeded-v1";

static DEFAULT_PACK_DIR: Dir<'_> =
    include_dir!("$CARGO_MANIFEST_DIR/../../../examples/knowledge-packs/getting-started/1.0.0");
static ZH_CN_PACK_DIR: Dir<'_> = include_dir!(
    "$CARGO_MANIFEST_DIR/../../../examples/knowledge-packs/getting-started-zh-cn/1.0.0"
);

#[derive(Debug, Deserialize)]
struct EmbeddedPackMeta {
    id: String,
    name: String,
    version: String,
}

pub fn ensure_seeded(conn: &Connection, app_data_dir: &Path, vault_root: &Path) -> AppResult<()> {
    ensure_pack_seeded_once(
        conn,
        app_data_dir,
        vault_root,
        DEFAULT_PACK_ID,
        DEFAULT_PACK_NAME,
        &DEFAULT_PACK_DIR,
        DEFAULT_PACK_MARKER,
    )?;
    ensure_pack_seeded_once(
        conn,
        app_data_dir,
        vault_root,
        ZH_CN_PACK_ID,
        ZH_CN_PACK_NAME,
        &ZH_CN_PACK_DIR,
        ZH_CN_PACK_MARKER,
    )?;
    ensure_default_snapshots(conn, app_data_dir, vault_root)
}

pub fn seed_fresh_defaults(conn: &Connection, vault_root: &Path) -> AppResult<()> {
    seed_pack(
        conn,
        vault_root,
        DEFAULT_PACK_ID,
        DEFAULT_PACK_NAME,
        &DEFAULT_PACK_DIR,
    )?;
    seed_pack(
        conn,
        vault_root,
        ZH_CN_PACK_ID,
        ZH_CN_PACK_NAME,
        &ZH_CN_PACK_DIR,
    )
}

/// Write pristine copies of both bundled packs without changing database
/// state. Vault migration uses this while preparing an inactive staging
/// directory, then records the packs only after the new vault is activated.
pub fn write_fresh_defaults(vault_root: &Path) -> AppResult<()> {
    write_embedded_pack(&vault_root.join(DEFAULT_PACK_ID), &DEFAULT_PACK_DIR)?;
    write_embedded_pack(&vault_root.join(ZH_CN_PACK_ID), &ZH_CN_PACK_DIR)
}

pub fn ensure_default_snapshots(
    conn: &Connection,
    app_data_dir: &Path,
    vault_root: &Path,
) -> AppResult<()> {
    for pack_id in [DEFAULT_PACK_ID, ZH_CN_PACK_ID] {
        let Some(installed) = db::get_sync_state(conn, pack_id)? else {
            continue;
        };
        let snapshot = crate::snapshot::snapshot_root(app_data_dir, pack_id, &installed.version);
        if !snapshot.exists() {
            crate::snapshot::write_snapshot(
                app_data_dir,
                pack_id,
                &installed.version,
                &vault_root.join(&installed.local_path),
            )?;
        }
    }
    Ok(())
}

fn ensure_pack_seeded_once(
    conn: &Connection,
    app_data_dir: &Path,
    vault_root: &Path,
    pack_id: &str,
    fallback_name: &str,
    pack_dir: &Dir<'_>,
    marker_name: &str,
) -> AppResult<()> {
    let marker = app_data_dir.join(marker_name);
    if !marker.exists() {
        seed_pack(conn, vault_root, pack_id, fallback_name, pack_dir)?;
        write_marker(&marker)?;
    }
    promote_bundled_record(conn, pack_id)
}

fn promote_bundled_record(conn: &Connection, pack_id: &str) -> AppResult<()> {
    let Some(installed) = db::get_sync_state(conn, pack_id)? else {
        return Ok(());
    };
    if installed.origin != "bundled" {
        return Ok(());
    }
    db::upsert_sync_state(
        conn,
        db::SyncStateUpsert {
            pack_id: &installed.pack_id,
            name: &installed.name,
            version: &installed.version,
            local_path: &installed.local_path,
            origin: "local",
            owner_id: installed.owner_id.as_deref(),
            description: &installed.description,
        },
    )
}

fn seed_pack(
    conn: &Connection,
    vault_root: &Path,
    pack_id: &str,
    fallback_name: &str,
    pack_dir: &Dir<'_>,
) -> AppResult<()> {
    if db::get_sync_state(conn, pack_id)?.is_some() {
        return Ok(());
    }

    let pack_root = vault_root.join(pack_id);
    if !pack_root.exists() {
        write_embedded_pack(pack_root.as_path(), pack_dir)?;
    }

    let meta = match read_pack_meta(&pack_root.join("pack.json"), pack_id, fallback_name) {
        Ok(meta) => meta,
        Err(_) => {
            if pack_root.exists() {
                fs::remove_dir_all(&pack_root)?;
            }
            write_embedded_pack(pack_root.as_path(), pack_dir)?;
            read_pack_meta(&pack_root.join("pack.json"), pack_id, fallback_name)?
        }
    };

    db::upsert_sync_state(
        conn,
        db::SyncStateUpsert {
            pack_id: &meta.id,
            name: &meta.name,
            version: &meta.version,
            local_path: &meta.id,
            origin: "local",
            owner_id: None,
            // Bundled packs' embedded pack.json doesn't carry a description field.
            description: "",
        },
    )
}

fn write_embedded_pack(pack_root: &Path, pack_dir: &Dir<'_>) -> AppResult<()> {
    vault::ensure_dir(pack_root)?;
    write_dir_recursive(pack_dir, PathBuf::new(), pack_root)
}

fn write_dir_recursive(dir: &Dir<'_>, rel: PathBuf, target_root: &Path) -> AppResult<()> {
    let current = target_root.join(&rel);
    vault::ensure_dir(&current)?;

    for file in dir.files() {
        let name = file
            .path()
            .file_name()
            .ok_or_else(|| AppError::msg("Invalid bundled default-pack file path"))?;
        let out = current.join(name);
        fs::write(out, file.contents())?;
    }

    for child in dir.dirs() {
        let name = child
            .path()
            .file_name()
            .ok_or_else(|| AppError::msg("Invalid bundled default-pack directory path"))?;
        let next_rel = rel.join(name);
        write_dir_recursive(child, next_rel, target_root)?;
    }

    Ok(())
}

fn read_pack_meta(
    path: &Path,
    expected_id: &str,
    fallback_name: &str,
) -> AppResult<EmbeddedPackMeta> {
    let raw = fs::read_to_string(path)?;
    let meta: EmbeddedPackMeta = serde_json::from_str(&raw)?;
    if meta.id.trim().is_empty() || meta.version.trim().is_empty() {
        return Err(AppError::msg("Bundled default pack has invalid metadata"));
    }
    if meta.id != expected_id {
        return Err(AppError::msg(format!(
            "Bundled default pack id mismatch: expected {expected_id}, found {}",
            meta.id
        )));
    }
    if meta.name.trim().is_empty() {
        return Ok(EmbeddedPackMeta {
            id: meta.id,
            name: fallback_name.into(),
            version: meta.version,
        });
    }
    Ok(meta)
}

fn write_marker(marker_path: &Path) -> AppResult<()> {
    fs::write(marker_path, b"1")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonical_default_pack_has_expected_metadata_and_tutorial() {
        let metadata = DEFAULT_PACK_DIR
            .get_file("pack.json")
            .expect("embedded pack.json");
        let meta: EmbeddedPackMeta =
            serde_json::from_slice(metadata.contents()).expect("valid pack metadata");
        assert_eq!(meta.id, DEFAULT_PACK_ID);
        assert_eq!(meta.name, DEFAULT_PACK_NAME);
        assert_eq!(meta.version, "1.0.0");
        assert!(DEFAULT_PACK_DIR
            .get_file("guides/editing-and-source-control.md")
            .is_some());
        assert!(DEFAULT_PACK_DIR
            .get_file("guides/publishing-and-messages.md")
            .is_some());

        let zh_metadata = ZH_CN_PACK_DIR
            .get_file("pack.json")
            .expect("embedded Chinese pack.json");
        let zh_meta: EmbeddedPackMeta =
            serde_json::from_slice(zh_metadata.contents()).expect("valid Chinese metadata");
        assert_eq!(zh_meta.id, ZH_CN_PACK_ID);
        assert_eq!(zh_meta.name, ZH_CN_PACK_NAME);
        assert_eq!(zh_meta.version, "1.0.0");
        assert!(ZH_CN_PACK_DIR
            .get_file("guides/settings-and-account.md")
            .is_some());
    }

    #[test]
    fn first_seed_installs_both_defaults_as_clean_local_packs() {
        let root =
            std::env::temp_dir().join(format!("nest-default-packs-test-{}", uuid::Uuid::new_v4()));
        let app_data = root.join("app-data");
        let vault = app_data.join("vault");
        fs::create_dir_all(&vault).unwrap();
        let conn = db::open_db(&app_data.join("test.db")).unwrap();

        ensure_seeded(&conn, &app_data, &vault).unwrap();

        for id in [DEFAULT_PACK_ID, ZH_CN_PACK_ID] {
            let installed = db::get_sync_state(&conn, id).unwrap().unwrap();
            assert_eq!(installed.origin, "local");
            assert!(vault.join(id).join("pack.json").is_file());
            assert!(crate::snapshot::snapshot_root(&app_data, id, &installed.version).is_dir());
        }
        drop(conn);
        let _ = fs::remove_dir_all(root);
    }
}
