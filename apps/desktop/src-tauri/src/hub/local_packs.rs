use crate::db::{self, PackMeta};
use crate::error::{AppError, AppResult};
use crate::vault;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use zip::write::SimpleFileOptions;
use zip::{ZipArchive, ZipWriter};

#[derive(Debug, Clone, Serialize)]
pub struct FolderPackDefaults {
    pub metadata: PackMeta,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub warning: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LocalPackInspection {
    pub metadata: PackMeta,
    pub needs_metadata: bool,
}

#[derive(Debug, Deserialize)]
struct LoosePackMeta {
    #[serde(default)]
    id: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    version: String,
}

pub fn record_sync(
    conn: &Connection,
    pack: &PackMeta,
    origin: &str,
    owner_id: Option<&str>,
) -> AppResult<()> {
    record_sync_with_patch(conn, pack, origin, owner_id, 0)
}

pub fn record_sync_with_patch(
    conn: &Connection,
    pack: &PackMeta,
    origin: &str,
    owner_id: Option<&str>,
    patch_revision: i64,
) -> AppResult<()> {
    db::upsert_sync_state(
        conn,
        db::SyncStateUpsert {
            pack_id: &pack.id,
            name: &pack.name,
            version: &pack.version,
            local_path: &pack.path,
            origin,
            owner_id,
            description: &pack.description,
            patch_revision,
        },
    )
}

/// Build editable metadata defaults for a source folder. A malformed root
/// pack.json is non-fatal because the user can correct the form before import.
pub fn folder_pack_defaults(source: &Path) -> AppResult<FolderPackDefaults> {
    if !source.is_dir() {
        return Err(AppError::msg("Select a folder to create a knowledge pack"));
    }
    let folder_name = source
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.trim().is_empty())
        .unwrap_or("knowledge-pack")
        .trim()
        .to_string();
    let generated_id = slugify_pack_id(&folder_name);
    let mut metadata = PackMeta {
        id: generated_id,
        name: folder_name,
        description: String::new(),
        version: "1.0.0".into(),
        path: String::new(),
    };

    let pack_json = source.join("pack.json");
    if !pack_json.is_file() {
        return Ok(FolderPackDefaults {
            metadata,
            warning: None,
        });
    }

    match fs::read_to_string(&pack_json)
        .map_err(AppError::from)
        .and_then(|raw| {
            serde_json::from_str::<LoosePackMeta>(&raw)
                .map_err(|e| AppError::msg(format!("Invalid pack.json: {e}")))
        }) {
        Ok(existing) => {
            if !existing.id.trim().is_empty() {
                metadata.id = existing.id.trim().to_string();
            }
            if !existing.name.trim().is_empty() {
                metadata.name = existing.name.trim().to_string();
            }
            metadata.description = existing.description.trim().to_string();
            if !existing.version.trim().is_empty() {
                metadata.version = existing.version.trim().to_string();
            }
            Ok(FolderPackDefaults {
                metadata,
                warning: None,
            })
        }
        Err(error) => Ok(FolderPackDefaults {
            metadata,
            warning: Some(format!(
                "Could not use the folder's pack.json ({error}). Fill in the pack details below."
            )),
        }),
    }
}

/// Scaffold a brand-new, empty knowledge pack directly in the vault (no
/// source folder/zip). Seeds one starter `README.md` — a pack with zero
/// markdown files would be invisible in `list_tree` (which hides empty
/// folders) and would fail `pack_has_markdown`'s installed-pack filter, so a
/// seed file isn't optional here.
///
/// A local pack's id/folder is a registry-safe, case-preserving slug derived
/// from its display name. The stable path is immediately valid for a future
/// Hub publish.
pub fn create_empty_pack(submitted: PackMeta, vault_root: &Path) -> AppResult<PackMeta> {
    let id = slugify_pack_id(&submitted.name);
    let pack = normalize_pack_meta(PackMeta {
        id,
        name: submitted.name,
        description: submitted.description,
        version: submitted.version,
        path: String::new(),
    })?;
    let destination = vault_root.join(&pack.path);
    if destination.exists() {
        return Err(AppError::msg(format!(
            "Knowledge pack '{}' already exists",
            pack.id
        )));
    }
    let result = (|| {
        vault::ensure_dir(&destination)?;
        fs::write(destination.join("README.md"), format!("# {}\n", pack.name))?;
        write_pack_meta(&destination, &pack)?;
        Ok(pack.clone())
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&destination);
    }
    result
}

/// Copy a source folder into the vault as a standalone, validated pack.
pub fn create_pack_from_folder(
    source: &Path,
    submitted: PackMeta,
    vault_root: &Path,
    overwrite: bool,
) -> AppResult<PackMeta> {
    if !source.is_dir() {
        return Err(AppError::msg("Select a folder to create a knowledge pack"));
    }
    if !dir_has_markdown(source) {
        return Err(AppError::msg(
            "This folder has no Markdown (.md) files. Knowledge packs must include at least one.",
        ));
    }
    let pack = normalize_pack_meta(submitted)?;
    let destination = vault_root.join(&pack.path);
    if source.canonicalize().ok() == destination.canonicalize().ok() && destination.exists() {
        return Err(AppError::msg(
            "This folder is already the installed knowledge pack",
        ));
    }
    if destination.exists() && !overwrite {
        return Err(AppError::msg(format!(
            "Knowledge pack '{}' is already installed",
            pack.id
        )));
    }

    let staging = vault_root.join(format!(".creating-{}", uuid::Uuid::new_v4()));
    let backup = vault_root.join(format!(".replacing-{}", uuid::Uuid::new_v4()));
    let result = (|| {
        vault::copy_dir_recursive(source, &staging)?;
        write_pack_meta(&staging, &pack)?;
        let had_existing = destination.exists();
        if had_existing {
            fs::rename(&destination, &backup)?;
        }
        if let Err(error) = fs::rename(&staging, &destination) {
            if had_existing {
                let _ = fs::rename(&backup, &destination);
            }
            return Err(error.into());
        }
        if had_existing {
            let _ = fs::remove_dir_all(&backup);
        }
        Ok(pack.clone())
    })();
    if staging.exists() {
        let _ = fs::remove_dir_all(&staging);
    }
    if backup.exists() && destination.exists() {
        let _ = fs::remove_dir_all(&backup);
    }
    result
}

/// Write an installed pack to a portable ZIP containing one top-level pack folder.
pub fn export_pack(pack: &PackMeta, vault_root: &Path, destination: &Path) -> AppResult<()> {
    export_pack_from_source(pack, &pack.path, vault_root, destination)
}

pub(crate) fn export_pack_from_source(
    pack: &PackMeta,
    source_local_path: &str,
    vault_root: &Path,
    destination: &Path,
) -> AppResult<()> {
    let source = vault_root.join(source_local_path);
    if !source.is_dir() || !dir_has_markdown(&source) {
        return Err(AppError::msg(
            "Installed pack content is missing or has no Markdown files",
        ));
    }
    if destination
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("zip"))
        != Some(true)
    {
        return Err(AppError::msg("Export destination must be a .zip file"));
    }
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)?;
    }
    let file = File::create(destination)?;
    let mut writer = ZipWriter::new(file);
    let options = SimpleFileOptions::default();
    for entry in walkdir::WalkDir::new(&source)
        .into_iter()
        .filter_map(|entry| entry.ok())
    {
        let path = entry.path();
        if path == source {
            continue;
        }
        let relative = path
            .strip_prefix(&source)
            .map_err(|e| AppError::msg(e.to_string()))?;
        let name = format!(
            "{}/{}",
            pack.path,
            relative.to_string_lossy().replace('\\', "/")
        );
        if entry.file_type().is_dir() {
            writer.add_directory(name, options)?;
        } else {
            writer.start_file(name, options)?;
            if relative == Path::new("pack.json") {
                writer.write_all(serde_json::to_string_pretty(pack)?.as_bytes())?;
            } else {
                let mut input = File::open(path)?;
                let mut bytes = Vec::new();
                input.read_to_end(&mut bytes)?;
                writer.write_all(&bytes)?;
            }
        }
    }
    writer.finish()?;
    Ok(())
}

/// Inspect a local `.zip` without installing it. Existing Nest packs return
/// their manifest metadata. Plain Markdown zips return editable defaults so
/// the UI can collect metadata before creating pack.json.
pub fn inspect_local_pack(source: &Path, vault_root: &Path) -> AppResult<LocalPackInspection> {
    let tmp = extract_local_zip(source, vault_root)?;
    let result = (|| {
        if let Some((content_root, pack)) = find_pack_root(&tmp)? {
            validate_imported_pack(&content_root, &pack)?;
            return Ok(LocalPackInspection {
                metadata: pack,
                needs_metadata: false,
            });
        }

        let content_root = unmanifested_content_root(&tmp)?;
        if !dir_has_markdown(&content_root) {
            return Err(AppError::msg(
                "This zip has no Markdown (.md) files. Knowledge packs must include at least one.",
            ));
        }
        let fallback_name = source
            .file_stem()
            .and_then(|name| name.to_str())
            .filter(|name| !name.trim().is_empty())
            .unwrap_or("knowledge-pack");
        let name = if content_root != tmp {
            content_root
                .file_name()
                .and_then(|name| name.to_str())
                .filter(|name| !name.trim().is_empty())
                .unwrap_or(fallback_name)
        } else {
            fallback_name
        }
        .trim()
        .to_string();
        Ok(LocalPackInspection {
            metadata: PackMeta {
                id: slugify_pack_id(&name),
                name,
                description: String::new(),
                version: "1.0.0".into(),
                path: String::new(),
            },
            needs_metadata: true,
        })
    })();
    let _ = fs::remove_dir_all(&tmp);
    result
}

/// Import a local `.zip` knowledge pack (must include `pack.json`).
pub fn import_local_pack(source: &Path, vault_root: &Path, overwrite: bool) -> AppResult<PackMeta> {
    let (tmp, content_root, pack) = prepare_local_pack(source, vault_root)?;
    let dest = vault_root.join(&pack.path);
    if dest.exists() && !overwrite {
        let _ = fs::remove_dir_all(&tmp);
        return Err(AppError::msg(format!(
            "Knowledge pack '{}' is already installed",
            pack.id
        )));
    }
    let backup = vault_root.join(format!(".replacing-{}", uuid::Uuid::new_v4()));
    let had_existing = dest.exists();
    if had_existing {
        if let Err(error) = fs::rename(&dest, &backup) {
            let _ = fs::remove_dir_all(&tmp);
            return Err(error.into());
        }
    }
    if let Err(error) = fs::rename(&content_root, &dest) {
        if had_existing {
            let _ = fs::rename(&backup, &dest);
        }
        let _ = fs::remove_dir_all(&tmp);
        return Err(error.into());
    }
    if had_existing {
        let _ = fs::remove_dir_all(&backup);
    }
    if tmp.exists() {
        let _ = fs::remove_dir_all(&tmp);
    }

    crate::nest_debug!(
        "hub",
        "import_local_zip id={} path={} from={}",
        pack.id,
        pack.path,
        source.display()
    );

    Ok(pack)
}

/// Create a pack from a zip that contains Markdown but no pack.json.
pub fn create_pack_from_zip(
    source: &Path,
    submitted: PackMeta,
    vault_root: &Path,
    overwrite: bool,
) -> AppResult<PackMeta> {
    let tmp = extract_local_zip(source, vault_root)?;
    let result = (|| {
        if find_pack_root(&tmp)?.is_some() {
            return Err(AppError::msg(
                "This zip already contains pack.json. Import it as an existing pack instead.",
            ));
        }
        let content_root = unmanifested_content_root(&tmp)?;
        create_pack_from_folder(&content_root, submitted, vault_root, overwrite)
    })();
    let _ = fs::remove_dir_all(&tmp);
    result
}

fn extract_local_zip(source: &Path, vault_root: &Path) -> AppResult<PathBuf> {
    if !source.is_file() {
        return Err(AppError::msg("Select a .zip knowledge pack file"));
    }
    let ext = source
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if ext != "zip" {
        return Err(AppError::msg(
            "Knowledge packs must be imported as a .zip file",
        ));
    }
    let tmp = vault_root.join(format!(".import-{}", uuid::Uuid::new_v4()));
    if let Err(error) = super::zip::extract_zip_to_dir(source, &tmp) {
        let _ = fs::remove_dir_all(&tmp);
        return Err(error);
    }
    Ok(tmp)
}

fn prepare_local_pack(source: &Path, vault_root: &Path) -> AppResult<(PathBuf, PathBuf, PackMeta)> {
    let tmp = extract_local_zip(source, vault_root)?;
    let cleanup = || {
        let _ = fs::remove_dir_all(&tmp);
    };

    let (content_root, pack) = match locate_pack_root(&tmp) {
        Ok(v) => v,
        Err(e) => {
            cleanup();
            return Err(e);
        }
    };

    if let Err(e) = validate_imported_pack(&content_root, &pack) {
        cleanup();
        return Err(e);
    }

    Ok((tmp, content_root, pack))
}

fn validate_imported_pack(content_root: &Path, pack: &PackMeta) -> AppResult<()> {
    validate_pack_folder_name(&pack.path)?;
    if pack.id != pack.path {
        return Err(AppError::msg(
            "pack.json id must equal the pack folder name (path)",
        ));
    }
    if !dir_has_markdown(content_root) {
        return Err(AppError::msg(
            "This pack has no Markdown (.md) files. Nest packs must include at least one .md file.",
        ));
    }
    Ok(())
}

fn find_pack_root(extracted: &Path) -> AppResult<Option<(PathBuf, PackMeta)>> {
    let root_meta = extracted.join("pack.json");
    if root_meta.is_file() {
        let pack = read_required_pack_meta(extracted)?;
        return Ok(Some((extracted.to_path_buf(), pack)));
    }

    // Hub zips nest content under {path}/… including {path}/pack.json.
    let mut dirs: Vec<PathBuf> = fs::read_dir(extracted)?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.is_dir())
        .collect();
    dirs.sort();
    let mut found: Option<(PathBuf, PackMeta)> = None;
    for dir in dirs {
        let meta = dir.join("pack.json");
        if !meta.is_file() {
            continue;
        }
        if found.is_some() {
            return Err(AppError::msg(
                "Zip contains multiple pack.json files — import one pack per zip",
            ));
        }
        let pack = read_required_pack_meta(&dir)?;
        found = Some((dir, pack));
    }
    Ok(found)
}

fn locate_pack_root(extracted: &Path) -> AppResult<(PathBuf, PackMeta)> {
    find_pack_root(extracted)?.ok_or_else(|| {
        AppError::msg(
            "Zip is missing pack.json. Every Nest knowledge pack must include a pack.json at the pack root.",
        )
    })
}

fn unmanifested_content_root(extracted: &Path) -> AppResult<PathBuf> {
    let mut visible_dirs = Vec::new();
    let mut has_visible_files = false;
    for entry in fs::read_dir(extracted)? {
        let entry = entry?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with('.') || name == "__MACOSX" {
            continue;
        }
        if entry.file_type()?.is_dir() {
            visible_dirs.push(entry.path());
        } else {
            has_visible_files = true;
        }
    }
    if !has_visible_files && visible_dirs.len() == 1 {
        Ok(visible_dirs.remove(0))
    } else {
        Ok(extracted.to_path_buf())
    }
}

fn validate_pack_folder_name(name: &str) -> AppResult<()> {
    if name.is_empty() || name == "." || name == ".." {
        return Err(AppError::msg("Invalid pack path in pack.json"));
    }
    if name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err(AppError::msg(
            "pack.json \"path\" must be a single path segment (no nested paths)",
        ));
    }
    if name.starts_with('.') {
        return Err(AppError::msg("pack.json \"path\" cannot start with a dot"));
    }
    Ok(())
}

pub fn slugify_pack_id(value: &str) -> String {
    let mut slug = String::new();
    let mut previous_dash = false;
    for ch in value.trim().chars() {
        if ch.is_alphanumeric() {
            slug.push(ch);
            previous_dash = false;
        } else if !previous_dash && !slug.is_empty() {
            slug.push('-');
            previous_dash = true;
        }
    }
    let slug = slug.trim_matches('-');
    if slug.is_empty() {
        "knowledge-pack".into()
    } else {
        slug.into()
    }
}

fn valid_semver(version: &str) -> bool {
    let core = version
        .trim()
        .split_once(['-', '+'])
        .map(|(core, _)| core)
        .unwrap_or(version.trim());
    core.split('.').count() == 3
        && core
            .split('.')
            .all(|part| !part.is_empty() && part.chars().all(|ch| ch.is_ascii_digit()))
}

fn normalize_pack_meta(pack: PackMeta) -> AppResult<PackMeta> {
    let id = pack.id.trim().to_string();
    let name = pack.name.trim().to_string();
    let version = pack.version.trim().to_string();
    if id.is_empty() || name.is_empty() || version.is_empty() {
        return Err(AppError::msg("Pack ID, name, and version are required"));
    }
    validate_pack_folder_name(&id)?;
    if !valid_semver(&version) {
        return Err(AppError::msg(
            "Pack version must use SemVer (for example 1.0.0)",
        ));
    }
    Ok(PackMeta {
        id: id.clone(),
        name,
        description: pack.description.trim().to_string(),
        version,
        path: id,
    })
}

/// Update a pack's description on disk. Used to save an edit made right
/// before publishing (works for any origin the user can edit). Renaming a
/// pack is a distinct, local-only operation — see `rename_pack_folder` —
/// since it also has to move the pack's folder and identity.
pub fn update_pack_description(pack_root: &Path, description: &str) -> AppResult<PackMeta> {
    let mut meta = read_required_pack_meta(pack_root)?;
    meta.description = description.trim().to_string();
    write_pack_meta(pack_root, &meta)?;
    Ok(meta)
}

/// Update a pack's version on disk. Used to persist the version typed into
/// the Publish dialog before export — otherwise `export_pack` re-reads
/// `pack.json` from disk and zips up the stale version, and the Hub
/// (correctly) rejects the upload as a duplicate of the *old* release.
/// Safe for any origin the user can edit: like the description, version
/// isn't part of the pack's identity/folder.
pub fn update_pack_version(pack_root: &Path, version: &str) -> AppResult<PackMeta> {
    let mut meta = read_required_pack_meta(pack_root)?;
    meta.version = version.trim().to_string();
    meta = normalize_pack_meta(meta)?;
    write_pack_meta(pack_root, &meta)?;
    Ok(meta)
}

/// Renames a local pack. Its display name remains user-facing while its id and
/// folder move together as a registry-safe slug. Calling this with the same
/// display name also migrates legacy local packs whose id used spaces or other
/// unsupported separators.
pub fn rename_pack_folder(
    vault_root: &Path,
    old_local_path: &str,
    new_name: &str,
) -> AppResult<PackMeta> {
    let new_name = new_name.trim().to_string();
    if new_name.is_empty() {
        return Err(AppError::msg("Pack name cannot be empty"));
    }
    let new_id = slugify_pack_id(&new_name);
    update_local_pack_identity(vault_root, old_local_path, &new_id, &new_name)
}

/// Repairs a legacy sidebar-created pack whose old id used its display name
/// verbatim. This keeps the display name and derives the new id from the old
/// identity so publishing can proceed without recreating the pack.
pub fn migrate_local_pack_id_for_publish(
    vault_root: &Path,
    old_local_path: &str,
    old_id: &str,
    display_name: &str,
) -> AppResult<PackMeta> {
    let new_id = slugify_pack_id(old_id);
    update_local_pack_identity(vault_root, old_local_path, &new_id, display_name)
}

fn update_local_pack_identity(
    vault_root: &Path,
    old_local_path: &str,
    new_id: &str,
    new_name: &str,
) -> AppResult<PackMeta> {
    validate_pack_folder_name(new_id)?;

    let old_dir = vault_root.join(old_local_path);
    let new_dir = vault_root.join(new_id);
    if new_id != old_local_path {
        // A case-only repair points at the same directory on the default
        // macOS/Windows filesystems and must not be mistaken for a collision.
        if new_dir.exists() && !new_id.eq_ignore_ascii_case(old_local_path) {
            return Err(AppError::msg(format!(
                "A pack with ID '{new_id}' already exists"
            )));
        }
        fs::rename(&old_dir, &new_dir)?;
    }

    let result = (|| {
        let mut meta = read_required_pack_meta(&new_dir)?;
        meta.id = new_id.to_string();
        meta.name = new_name.to_string();
        meta.path = new_id.to_string();
        write_pack_meta(&new_dir, &meta)?;
        Ok(meta)
    })();
    if result.is_err() && new_id != old_local_path {
        // Best-effort rollback so a pack.json read/write failure doesn't
        // leave the folder moved but the DB still pointing at the old path.
        let _ = fs::rename(&new_dir, &old_dir);
    }
    result
}

fn write_pack_meta(pack_root: &Path, pack: &PackMeta) -> AppResult<()> {
    fs::write(
        pack_root.join("pack.json"),
        format!("{}\n", serde_json::to_string_pretty(pack)?),
    )?;
    Ok(())
}

pub fn dir_has_markdown(dir: &Path) -> bool {
    if !dir.is_dir() {
        return false;
    }
    walkdir::WalkDir::new(dir)
        .into_iter()
        .filter_map(|e| e.ok())
        .any(|e| {
            e.path()
                .extension()
                .and_then(|ext| ext.to_str())
                .map(|ext| ext.eq_ignore_ascii_case("md"))
                .unwrap_or(false)
        })
}

pub(crate) fn read_required_pack_meta(pack_root: &Path) -> AppResult<PackMeta> {
    let file = pack_root.join("pack.json");
    if !file.is_file() {
        return Err(AppError::msg(format!(
            "Missing required pack.json in {}",
            pack_root.display()
        )));
    }
    let raw = fs::read_to_string(&file)?;
    let pack: PackMeta =
        serde_json::from_str(&raw).map_err(|e| AppError::msg(format!("Invalid pack.json: {e}")))?;
    if pack.id.trim().is_empty() || pack.name.trim().is_empty() || pack.version.trim().is_empty() {
        return Err(AppError::msg(
            "pack.json requires non-empty id, name, and version",
        ));
    }
    let path = if pack.path.trim().is_empty() {
        pack.id.trim().to_string()
    } else {
        pack.path.trim().to_string()
    };
    if path != pack.id.trim() {
        return Err(AppError::msg(
            "pack.json \"path\" must equal \"id\" (or be omitted)",
        ));
    }
    normalize_pack_meta(PackMeta {
        id: pack.id,
        name: pack.name,
        description: pack.description,
        version: pack.version,
        path,
    })
}

#[cfg(test)]
mod local_pack_tests {
    use super::*;

    fn test_root(label: &str) -> PathBuf {
        crate::vault::test_temp_dir(label)
    }

    fn write_pack_zip(path: &Path, version: &str) {
        let file = File::create(path).unwrap();
        let mut zip = ZipWriter::new(file);
        let options = SimpleFileOptions::default();
        zip.start_file("sample/pack.json", options).unwrap();
        zip.write_all(
            serde_json::to_string(&PackMeta {
                id: "sample".into(),
                name: "Sample".into(),
                description: String::new(),
                version: version.into(),
                path: "sample".into(),
            })
            .unwrap()
            .as_bytes(),
        )
        .unwrap();
        zip.start_file("sample/new.md", options).unwrap();
        zip.write_all(b"# New content").unwrap();
        zip.finish().unwrap();
    }

    #[test]
    fn zip_import_requires_explicit_overwrite() {
        let root = test_root("zip-overwrite");
        let vault = root.join("vault");
        fs::create_dir_all(vault.join("sample")).unwrap();
        fs::write(vault.join("sample/old.md"), "# Old content").unwrap();
        let zip_path = root.join("sample.zip");
        write_pack_zip(&zip_path, "2.0.0");

        let inspected = inspect_local_pack(&zip_path, &vault).unwrap();
        assert!(!inspected.needs_metadata);
        assert_eq!(inspected.metadata.version, "2.0.0");
        assert!(import_local_pack(&zip_path, &vault, false).is_err());
        assert!(vault.join("sample/old.md").exists());

        let imported = import_local_pack(&zip_path, &vault, true).unwrap();
        assert_eq!(imported.version, "2.0.0");
        assert!(vault.join("sample/new.md").exists());
        assert!(!vault.join("sample/old.md").exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn zip_without_manifest_gets_defaults_and_creates_pack_json() {
        let root = test_root("zip-defaults");
        let vault = root.join("vault");
        fs::create_dir_all(&vault).unwrap();
        let zip_path = root.join("shared-notes.zip");
        let file = File::create(&zip_path).unwrap();
        let mut zip = ZipWriter::new(file);
        let options = SimpleFileOptions::default();
        zip.start_file("Team Notes/README.md", options).unwrap();
        zip.write_all(b"# Team notes").unwrap();
        zip.finish().unwrap();

        let inspected = inspect_local_pack(&zip_path, &vault).unwrap();
        assert!(inspected.needs_metadata);
        assert_eq!(inspected.metadata.id, "Team-Notes");
        assert_eq!(inspected.metadata.name, "Team Notes");
        assert_eq!(inspected.metadata.version, "1.0.0");

        let created = create_pack_from_zip(&zip_path, inspected.metadata, &vault, false).unwrap();
        assert_eq!(created.id, "Team-Notes");
        assert!(vault.join("Team-Notes/README.md").is_file());
        assert!(vault.join("Team-Notes/pack.json").is_file());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn folder_creation_requires_explicit_overwrite() {
        let root = test_root("folder-overwrite");
        let vault = root.join("vault");
        let source = root.join("source");
        fs::create_dir_all(vault.join("sample")).unwrap();
        fs::create_dir_all(&source).unwrap();
        fs::write(vault.join("sample/old.md"), "# Old content").unwrap();
        fs::write(source.join("new.md"), "# New content").unwrap();
        let metadata = PackMeta {
            id: "sample".into(),
            name: "Sample".into(),
            description: String::new(),
            version: "2.0.0".into(),
            path: String::new(),
        };

        assert!(create_pack_from_folder(&source, metadata.clone(), &vault, false).is_err());
        assert!(vault.join("sample/old.md").exists());
        let created = create_pack_from_folder(&source, metadata, &vault, true).unwrap();
        assert_eq!(created.version, "2.0.0");
        assert!(vault.join("sample/new.md").exists());
        assert!(!vault.join("sample/old.md").exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn create_empty_pack_derives_registry_safe_id_and_path_from_name() {
        let root = test_root("create-empty");
        let vault = root.join("vault");
        fs::create_dir_all(&vault).unwrap();
        let metadata = PackMeta {
            id: "ignored-submitted-id".into(),
            name: "My New Pack".into(),
            description: String::new(),
            version: "0.1.0".into(),
            path: String::new(),
        };

        let created = create_empty_pack(metadata, &vault).unwrap();
        assert_eq!(created.id, "My-New-Pack");
        assert_eq!(created.name, "My New Pack");
        assert_eq!(created.path, "My-New-Pack");
        assert!(vault.join("My-New-Pack/README.md").is_file());
        assert!(vault.join("My-New-Pack/pack.json").is_file());
        assert!(dir_has_markdown(&vault.join("My-New-Pack")));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn create_empty_pack_retains_chinese_characters_in_id_and_folder() {
        let root = test_root("create-empty-chinese");
        let vault = root.join("vault");
        fs::create_dir_all(&vault).unwrap();
        let created = create_empty_pack(
            PackMeta {
                id: String::new(),
                name: "我的 Pack 笔记".into(),
                description: String::new(),
                version: "0.1.0".into(),
                path: String::new(),
            },
            &vault,
        )
        .unwrap();

        assert_eq!(created.id, "我的-Pack-笔记");
        assert_eq!(created.name, "我的 Pack 笔记");
        assert_eq!(created.path, "我的-Pack-笔记");
        assert!(vault.join("我的-Pack-笔记/pack.json").is_file());

        let zip_path = root.join("publish.zip");
        export_pack(&created, &vault, &zip_path).unwrap();
        let file = fs::File::open(zip_path).unwrap();
        let mut archive = ZipArchive::new(file).unwrap();
        assert!(archive.by_name("我的-Pack-笔记/pack.json").is_ok());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn create_empty_pack_rejects_existing_id() {
        let root = test_root("create-empty-conflict");
        let vault = root.join("vault");
        fs::create_dir_all(vault.join("Taken")).unwrap();
        let metadata = PackMeta {
            id: String::new(),
            name: "Taken".into(),
            description: String::new(),
            version: "0.1.0".into(),
            path: String::new(),
        };

        assert!(create_empty_pack(metadata, &vault).is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn update_pack_description_preserves_everything_else() {
        let root = test_root("update-description");
        let vault = root.join("vault");
        let metadata = PackMeta {
            id: String::new(),
            name: "Original Name".into(),
            description: "Original description".into(),
            version: "0.1.0".into(),
            path: String::new(),
        };
        let pack = create_empty_pack(metadata, &vault).unwrap();
        let pack_dir = vault.join(&pack.path);

        let updated = update_pack_description(&pack_dir, "A new description").unwrap();
        assert_eq!(updated.description, "A new description");
        assert_eq!(updated.name, "Original Name", "name must never change here");
        assert_eq!(updated.id, "Original-Name", "id must never change here");
        assert_eq!(updated.version, "0.1.0", "version must never change");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn update_pack_version_preserves_everything_else_and_export_picks_it_up() {
        let root = test_root("update-version");
        let vault = root.join("vault");
        let metadata = PackMeta {
            id: String::new(),
            name: "Original Name".into(),
            description: "Keep me".into(),
            version: "1.0.0".into(),
            path: String::new(),
        };
        let pack = create_empty_pack(metadata, &vault).unwrap();
        let pack_dir = vault.join(&pack.path);

        let updated = update_pack_version(&pack_dir, "1.1.0").unwrap();
        assert_eq!(updated.version, "1.1.0");
        assert_eq!(updated.name, "Original Name", "name must never change here");
        assert_eq!(
            updated.description, "Keep me",
            "description must never change here"
        );

        // The bug this guards against: export_pack re-reads pack.json from
        // disk, so a version bump that never lands there gets silently
        // dropped and the Hub is asked to publish the *old* version again.
        let zip_path = root.join("export.zip");
        export_pack(&updated, &vault, &zip_path).unwrap();
        let file = fs::File::open(&zip_path).unwrap();
        let mut archive = ZipArchive::new(file).unwrap();
        let mut contents = String::new();
        archive
            .by_name(&format!("{}/pack.json", updated.path))
            .unwrap()
            .read_to_string(&mut contents)
            .unwrap();
        assert!(
            contents.contains("\"1.1.0\""),
            "exported pack.json should contain the bumped version, got: {contents}"
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rename_pack_folder_moves_the_directory_and_updates_identity() {
        let root = test_root("rename-pack");
        let vault = root.join("vault");
        let metadata = PackMeta {
            id: String::new(),
            name: "Original Name".into(),
            description: "Keep me".into(),
            version: "0.1.0".into(),
            path: String::new(),
        };
        create_empty_pack(metadata, &vault).unwrap();

        let renamed = rename_pack_folder(&vault, "Original-Name", "New Name").unwrap();
        assert_eq!(renamed.id, "New-Name");
        assert_eq!(renamed.name, "New Name");
        assert_eq!(renamed.path, "New-Name");
        assert_eq!(
            renamed.description, "Keep me",
            "description is untouched by rename"
        );
        assert!(!vault.join("Original-Name").exists());
        assert!(vault.join("New-Name/README.md").is_file());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rename_pack_folder_rejects_a_name_already_in_use() {
        let root = test_root("rename-pack-conflict");
        let vault = root.join("vault");
        create_empty_pack(
            PackMeta {
                id: String::new(),
                name: "Pack A".into(),
                description: String::new(),
                version: "0.1.0".into(),
                path: String::new(),
            },
            &vault,
        )
        .unwrap();
        create_empty_pack(
            PackMeta {
                id: String::new(),
                name: "Pack B".into(),
                description: String::new(),
                version: "0.1.0".into(),
                path: String::new(),
            },
            &vault,
        )
        .unwrap();

        assert!(rename_pack_folder(&vault, "Pack-A", "Pack B").is_err());
        assert!(
            vault.join("Pack-A").exists(),
            "source must survive a rejected rename"
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rename_pack_folder_rejects_an_empty_name() {
        let root = test_root("rename-pack-empty-name");
        let vault = root.join("vault");
        create_empty_pack(
            PackMeta {
                id: String::new(),
                name: "Original Name".into(),
                description: String::new(),
                version: "0.1.0".into(),
                path: String::new(),
            },
            &vault,
        )
        .unwrap();

        assert!(rename_pack_folder(&vault, "original-name", "   ").is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn publishing_migration_repairs_legacy_sidebar_pack_identity() {
        let root = test_root("migrate-legacy-sidebar-pack");
        let vault = root.join("vault");
        let legacy_dir = vault.join("Legacy Pack");
        fs::create_dir_all(&legacy_dir).unwrap();
        fs::write(legacy_dir.join("README.md"), "# Legacy Pack").unwrap();
        write_pack_meta(
            &legacy_dir,
            &PackMeta {
                id: "Legacy Pack".into(),
                name: "Legacy Pack".into(),
                description: "Keep me".into(),
                version: "0.1.0".into(),
                path: "Legacy Pack".into(),
            },
        )
        .unwrap();

        let migrated =
            migrate_local_pack_id_for_publish(&vault, "Legacy Pack", "Legacy Pack", "Legacy Pack")
                .unwrap();
        assert_eq!(migrated.id, "Legacy-Pack");
        assert_eq!(migrated.name, "Legacy Pack");
        assert_eq!(migrated.path, "Legacy-Pack");
        assert!(!legacy_dir.exists());
        assert!(vault.join("Legacy-Pack/README.md").is_file());

        let zip_path = root.join("publish.zip");
        export_pack(&migrated, &vault, &zip_path).unwrap();
        let file = fs::File::open(zip_path).unwrap();
        let mut archive = ZipArchive::new(file).unwrap();
        assert!(archive.by_name("Legacy-Pack/pack.json").is_ok());

        let _ = fs::remove_dir_all(root);
    }
}
