use crate::db::{self, PackMeta};
use crate::error::{AppError, AppResult};
use crate::vault;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::copy;
use std::path::{Path, PathBuf};
use zip::ZipArchive;

fn hub_http_client(hub_base_url: &str) -> AppResult<reqwest::Client> {
    let base = hub_base_url.trim().to_lowercase();
    let is_loopback = base.starts_with("http://127.")
        || base.starts_with("https://127.")
        || base.starts_with("http://localhost")
        || base.starts_with("https://localhost")
        || base.starts_with("http://[::1]")
        || base.starts_with("https://[::1]");

    let mut builder = reqwest::Client::builder();
    if is_loopback {
        builder = builder.no_proxy();
    }
    Ok(builder.build()?)
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

/// Probe `{hub}/health`. Used for the Hub panel online/offline indicator.
pub async fn check_hub_status(hub_base_url: &str) -> HubConnectionStatus {
    let base = hub_base_url.trim_end_matches('/').to_string();
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
    let path = {
        let p = pack.path.trim();
        if p.is_empty() {
            pack.id.trim().to_string()
        } else {
            p.to_string()
        }
    };
    if path != pack.id.trim() {
        return Err(AppError::msg(
            "pack.json \"path\" must equal \"id\" (or be omitted)",
        ));
    }
    validate_pack_folder_name(&path)?;
    Ok(PackMeta {
        id: pack.id.trim().to_string(),
        name: pack.name.trim().to_string(),
        description: pack.description.trim().to_string(),
        version: pack.version.trim().to_string(),
        path,
    })
}
