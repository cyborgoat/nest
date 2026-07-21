use crate::db::{self, PackMeta};
use crate::error::{AppError, AppResult};
use crate::vault;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{copy, Read, Write};
use std::path::{Path, PathBuf};
use zip::write::SimpleFileOptions;
use zip::{ZipArchive, ZipWriter};

fn hub_http_client(_hub_base_url: &str) -> AppResult<reqwest::Client> {
    // Always bypass HTTP(S)_PROXY for Hub traffic. Local Clash/system proxies
    // often return 502/504 for remote Hub URLs (and for loopback unless
    // no_proxy is set). The Hub base URL is user-configured first-party traffic.
    Ok(reqwest::Client::builder().no_proxy().build()?)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PackProject {
    pub id: String,
    pub name: String,
    pub description: String,
    pub latest_version: String,
    pub versions: Vec<String>,
}

pub async fn list_packs_remote(hub_base_url: &str) -> AppResult<Vec<PackProject>> {
    if hub_base_url.trim().is_empty() {
        return Err(AppError::msg(
            "Knowledge Hub URL is not configured. Set it in Settings.",
        ));
    }
    let url = format!("{}/packs", hub_base_url.trim_end_matches('/'));
    let client = hub_http_client(hub_base_url)?;
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| AppError::msg(format!("Knowledge Hub unreachable: {e}")))?;
    if !resp.status().is_success() {
        return Err(AppError::msg(format!(
            "Knowledge Hub list failed: {}",
            resp.status()
        )));
    }
    Ok(resp.json().await?)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HubConnectionStatus {
    pub online: bool,
    pub hub_base_url: String,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct FolderPackDefaults {
    pub metadata: PackMeta,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub warning: Option<String>,
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

/// Probe `{hub}/health`. Used for the Hub panel online/offline indicator.
pub async fn check_hub_status(hub_base_url: &str) -> HubConnectionStatus {
    let base = hub_base_url.trim_end_matches('/').to_string();
    if base.is_empty() {
        return HubConnectionStatus {
            online: false,
            hub_base_url: base,
            message: Some("Knowledge Hub URL is not configured.".into()),
        };
    }
    let url = format!("{base}/health");
    let client = match hub_http_client(hub_base_url) {
        Ok(client) => client,
        Err(e) => {
            return HubConnectionStatus {
                online: false,
                hub_base_url: base,
                message: Some(format!("Knowledge Hub is not accessible: {e}")),
            }
        }
    };
    match client.get(&url).send().await {
        Ok(resp) if resp.status().is_success() => HubConnectionStatus {
            online: true,
            hub_base_url: base,
            message: None,
        },
        Ok(resp) => HubConnectionStatus {
            online: false,
            hub_base_url: base,
            message: Some(format!(
                "Knowledge Hub is not accessible (HTTP {})",
                resp.status()
            )),
        },
        Err(e) => HubConnectionStatus {
            online: false,
            hub_base_url: base,
            message: Some(format!("Knowledge Hub is not accessible: {e}")),
        },
    }
}

/// Download a pack release into `vault/<id>/`, replacing any previous install.
pub async fn download_pack_remote(
    hub_base_url: &str,
    pack_id: &str,
    version: Option<&str>,
    vault_root: &Path,
) -> AppResult<PackMeta> {
    if hub_base_url.trim().is_empty() {
        return Err(AppError::msg(
            "Knowledge Hub URL is not configured. Set it in Settings.",
        ));
    }
    let base = hub_base_url.trim_end_matches('/');
    let url = match version {
        Some(v) => format!("{base}/packs/{pack_id}/{v}/download"),
        None => format!("{base}/packs/{pack_id}/download"),
    };
    let client = hub_http_client(hub_base_url)?;
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| AppError::msg(format!("Knowledge Hub unreachable: {e}")))?;
    if !resp.status().is_success() {
        return Err(AppError::msg(format!(
            "Hub download failed: {}",
            resp.status()
        )));
    }
    let bytes = resp.bytes().await?;
    let tmp = vault_root.join(format!(".{pack_id}.zip"));
    fs::write(&tmp, &bytes)?;

    let dest = vault_root.join(pack_id);
    if dest.exists() {
        fs::remove_dir_all(&dest)?;
    }

    let extracted = extract_zip_to_vault(&tmp, vault_root)?;
    let _ = fs::remove_file(&tmp);

    let mut meta = read_required_pack_meta(&extracted)?;
    if meta.path.trim().is_empty() {
        meta.path = meta.id.clone();
    }
    if meta.version.is_empty() {
        if let Some(v) = version {
            meta.version = v.to_string();
        }
    }
    Ok(meta)
}

fn extract_zip_to_dir(zip_path: &Path, dest_root: &Path) -> AppResult<()> {
    vault::ensure_dir(dest_root)?;
    let file = File::open(zip_path)?;
    let mut archive = ZipArchive::new(file)?;
    for i in 0..archive.len() {
        let mut file = archive.by_index(i)?;
        let name = file.name().to_string();
        if name.contains("..") {
            return Err(AppError::msg("Zip contains unsafe path"));
        }
        let outpath = dest_root.join(&name);
        if file.is_dir() {
            vault::ensure_dir(&outpath)?;
        } else {
            if let Some(parent) = outpath.parent() {
                vault::ensure_dir(parent)?;
            }
            let mut outfile = File::create(&outpath)?;
            copy(&mut file, &mut outfile)?;
        }
    }
    Ok(())
}

fn extract_zip_to_vault(zip_path: &Path, vault_root: &Path) -> AppResult<PathBuf> {
    let file = File::open(zip_path)?;
    let mut archive = ZipArchive::new(file)?;
    let mut top: Option<String> = None;
    for i in 0..archive.len() {
        let mut file = archive.by_index(i)?;
        let name = file.name().to_string();
        if name.contains("..") {
            return Err(AppError::msg("Zip contains unsafe path"));
        }
        let outpath = vault_root.join(&name);
        if file.is_dir() {
            vault::ensure_dir(&outpath)?;
        } else {
            if let Some(parent) = outpath.parent() {
                vault::ensure_dir(parent)?;
            }
            let mut outfile = File::create(&outpath)?;
            copy(&mut file, &mut outfile)?;
        }
        if top.is_none() {
            top = Some(name.split('/').next().unwrap_or(&name).to_string());
        }
    }
    Ok(vault_root.join(top.unwrap_or_default()))
}

pub fn record_sync(conn: &Connection, pack: &PackMeta) -> AppResult<()> {
    db::upsert_sync_state(conn, &pack.id, &pack.name, &pack.version, &pack.path)
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

/// Copy a source folder into the vault as a standalone, validated pack.
pub fn create_pack_from_folder(
    source: &Path,
    submitted: PackMeta,
    vault_root: &Path,
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

    let staging = vault_root.join(format!(".creating-{}", uuid::Uuid::new_v4()));
    let result = (|| {
        vault::copy_dir_recursive(source, &staging)?;
        write_pack_meta(&staging, &pack)?;
        if destination.exists() {
            fs::remove_dir_all(&destination)?;
        }
        fs::rename(&staging, &destination)?;
        Ok(pack.clone())
    })();
    if staging.exists() {
        let _ = fs::remove_dir_all(&staging);
    }
    result
}

/// Write an installed pack to a portable ZIP containing one top-level pack folder.
pub fn export_pack(pack: &PackMeta, vault_root: &Path, destination: &Path) -> AppResult<()> {
    let source = vault_root.join(&pack.path);
    if !source.is_dir() || !dir_has_markdown(&source) {
        return Err(AppError::msg(
            "Installed pack content is missing or has no Markdown files",
        ));
    }
    let pack = read_required_pack_meta(&source)?;
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
            let mut input = File::open(path)?;
            let mut bytes = Vec::new();
            input.read_to_end(&mut bytes)?;
            writer.write_all(&bytes)?;
        }
    }
    writer.finish()?;
    Ok(())
}

/// Import a local `.zip` knowledge pack (must include `pack.json`).
pub fn import_local_pack(source: &Path, vault_root: &Path) -> AppResult<PackMeta> {
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
    let cleanup = || {
        let _ = fs::remove_dir_all(&tmp);
    };

    if let Err(e) = extract_zip_to_dir(source, &tmp) {
        cleanup();
        return Err(e);
    }

    let (content_root, pack) = match locate_pack_root(&tmp) {
        Ok(v) => v,
        Err(e) => {
            cleanup();
            return Err(e);
        }
    };

    if let Err(e) = validate_pack_folder_name(&pack.path) {
        cleanup();
        return Err(e);
    }
    if pack.id != pack.path {
        cleanup();
        return Err(AppError::msg(
            "pack.json id must equal the pack folder name (path)",
        ));
    }

    if !dir_has_markdown(&content_root) {
        cleanup();
        return Err(AppError::msg(
            "This pack has no Markdown (.md) files. Nest packs must include at least one .md file.",
        ));
    }

    let dest = vault_root.join(&pack.path);
    if dest.exists() {
        if let Err(e) = fs::remove_dir_all(&dest) {
            cleanup();
            return Err(e.into());
        }
    }
    if let Err(e) = vault::copy_dir_recursive(&content_root, &dest) {
        cleanup();
        return Err(e);
    }
    cleanup();

    crate::nest_debug!(
        "hub",
        "import_local_zip id={} path={} from={}",
        pack.id,
        pack.path,
        source.display()
    );

    Ok(pack)
}

fn locate_pack_root(extracted: &Path) -> AppResult<(PathBuf, PackMeta)> {
    let root_meta = extracted.join("pack.json");
    if root_meta.is_file() {
        let pack = read_required_pack_meta(extracted)?;
        return Ok((extracted.to_path_buf(), pack));
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
    found.ok_or_else(|| {
        AppError::msg(
            "Zip is missing pack.json. Every Nest knowledge pack must include a pack.json at the pack root.",
        )
    })
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

fn slugify_pack_id(value: &str) -> String {
    let mut slug = String::new();
    let mut previous_dash = false;
    for ch in value.trim().chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch.to_ascii_lowercase());
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

fn write_pack_meta(pack_root: &Path, pack: &PackMeta) -> AppResult<()> {
    fs::write(
        pack_root.join("pack.json"),
        format!("{}\n", serde_json::to_string_pretty(pack)?),
    )?;
    Ok(())
}

fn dir_has_markdown(dir: &Path) -> bool {
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

fn read_required_pack_meta(pack_root: &Path) -> AppResult<PackMeta> {
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
