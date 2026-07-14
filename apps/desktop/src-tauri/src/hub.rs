use crate::db::{self, PackMeta};
use crate::error::{AppError, AppResult};
use crate::vault;
use rusqlite::Connection;
use std::fs::{self, File};
use std::io::copy;
use std::path::{Path, PathBuf};
use zip::ZipArchive;

pub async fn list_packs_remote(hub_base_url: &str) -> AppResult<Vec<PackMeta>> {
    let url = format!("{}/packs", hub_base_url.trim_end_matches('/'));
    let client = reqwest::Client::new();
    let resp = client.get(&url).send().await?;
    if !resp.status().is_success() {
        return Err(AppError::msg(format!(
            "Hub list failed: {}",
            resp.status()
        )));
    }
    Ok(resp.json().await?)
}

pub fn list_packs_fixture(fixtures_root: &Path) -> AppResult<Vec<PackMeta>> {
    let packs_file = fixtures_root.join("packs.json");
    if !packs_file.exists() {
        return Ok(Vec::new());
    }
    let raw = fs::read_to_string(packs_file)?;
    Ok(serde_json::from_str(&raw)?)
}

pub async fn download_pack_remote(
    hub_base_url: &str,
    pack: &PackMeta,
    vault_root: &Path,
) -> AppResult<PathBuf> {
    let url = format!(
        "{}/packs/{}/download",
        hub_base_url.trim_end_matches('/'),
        pack.id
    );
    let client = reqwest::Client::new();
    let resp = client.get(&url).send().await?;
    if !resp.status().is_success() {
        return Err(AppError::msg(format!(
            "Hub download failed: {}",
            resp.status()
        )));
    }
    let bytes = resp.bytes().await?;
    let tmp = vault_root.join(format!(".{}.zip", pack.id));
    fs::write(&tmp, &bytes)?;
    let dest = extract_zip_to_vault(&tmp, vault_root)?;
    let _ = fs::remove_file(&tmp);
    Ok(dest)
}

pub fn import_pack_fixture(
    fixtures_root: &Path,
    pack: &PackMeta,
    vault_root: &Path,
) -> AppResult<PathBuf> {
    let src = fixtures_root.join(&pack.path);
    if !src.is_dir() {
        return Err(AppError::msg(format!(
            "Fixture pack not found: {}",
            pack.path
        )));
    }
    let dest = vault_root.join(&pack.path);
    if dest.exists() {
        fs::remove_dir_all(&dest)?;
    }
    vault::copy_dir_recursive(&src, &dest)?;
    Ok(dest)
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
            top = Some(
                name.split('/')
                    .next()
                    .unwrap_or(&name)
                    .to_string(),
            );
        }
    }
    Ok(vault_root.join(top.unwrap_or_default()))
}

pub fn record_sync(conn: &Connection, pack: &PackMeta) -> AppResult<()> {
    db::upsert_sync_state(conn, &pack.id, &pack.name, &pack.version, &pack.path)
}
