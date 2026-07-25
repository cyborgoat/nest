use crate::db::{self, PackMeta};
use crate::error::{AppError, AppResult};
use crate::http;
use crate::vault;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{copy, Read, Write};
use std::path::{Path, PathBuf};
use zip::write::SimpleFileOptions;
use zip::{ZipArchive, ZipWriter};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HubUser {
    pub uuid: String,
    pub id: String,
    pub name: String,
    pub role: String,
    #[serde(default)]
    pub managed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthSession {
    pub user: HubUser,
    pub access_token: String,
    pub refresh_token: String,
    pub expires_in: u64,
    #[serde(default)]
    pub expires_at_epoch: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct AuthState {
    pub authenticated: bool,
    pub user: Option<HubUser>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PublishRequest {
    pub id: String,
    pub pack_id: String,
    pub version: String,
    pub name: String,
    pub description: String,
    pub status: String,
    pub review_note: Option<String>,
    pub created_at: String,
    pub reviewed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HubMessage {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub body: String,
    pub pack_id: Option<String>,
    pub publish_request_id: Option<String>,
    pub read_at: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HubMessagePage {
    pub items: Vec<HubMessage>,
    pub next_cursor: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnreadCount {
    pub count: u64,
}

#[derive(Serialize)]
struct LoginBody<'a> {
    id: &'a str,
    password: &'a str,
}
#[derive(Serialize)]
struct RegisterBody<'a> {
    id: &'a str,
    password: &'a str,
    name: &'a str,
}
#[derive(Serialize)]
struct RefreshBody<'a> {
    refresh_token: &'a str,
}
#[derive(Serialize)]
struct ProfileBody<'a> {
    name: &'a str,
}
#[derive(Serialize)]
struct ChangePasswordBody<'a> {
    current_password: &'a str,
    new_password: &'a str,
}

pub async fn login_remote(
    hub_base_url: &str,
    proxy_url: &str,
    id: &str,
    password: &str,
) -> AppResult<AuthSession> {
    let session = auth_request(
        hub_base_url,
        proxy_url,
        "login",
        &LoginBody { id, password },
    )
    .await?;
    Ok(with_expiry(session))
}

pub async fn register_remote(
    hub_base_url: &str,
    proxy_url: &str,
    id: &str,
    password: &str,
    name: &str,
) -> AppResult<AuthSession> {
    let session = auth_request(
        hub_base_url,
        proxy_url,
        "register",
        &RegisterBody { id, password, name },
    )
    .await?;
    Ok(with_expiry(session))
}

pub async fn refresh_remote(
    hub_base_url: &str,
    proxy_url: &str,
    refresh_token: &str,
) -> AppResult<AuthSession> {
    let session = auth_request(
        hub_base_url,
        proxy_url,
        "refresh",
        &RefreshBody { refresh_token },
    )
    .await?;
    Ok(with_expiry(session))
}

pub async fn update_profile_remote(
    hub_base_url: &str,
    proxy_url: &str,
    access_token: &str,
    name: &str,
) -> AppResult<HubUser> {
    let response = http::build_client(proxy_url)?
        .patch(format!(
            "{}/api/auth/profile",
            hub_base_url.trim_end_matches('/')
        ))
        .bearer_auth(access_token)
        .json(&ProfileBody { name })
        .send()
        .await
        .map_err(|e| map_hub_http_error("Hub profile update", e))?;
    parse_hub_response(response, "Hub profile update").await
}

pub async fn change_password_remote(
    hub_base_url: &str,
    proxy_url: &str,
    access_token: &str,
    current_password: &str,
    new_password: &str,
) -> AppResult<AuthSession> {
    let response = http::build_client(proxy_url)?
        .post(format!(
            "{}/api/auth/password",
            hub_base_url.trim_end_matches('/')
        ))
        .bearer_auth(access_token)
        .json(&ChangePasswordBody {
            current_password,
            new_password,
        })
        .send()
        .await
        .map_err(|e| map_hub_http_error("Hub password update", e))?;
    Ok(with_expiry(
        parse_hub_response(response, "Hub password update").await?,
    ))
}

fn with_expiry(mut session: AuthSession) -> AuthSession {
    session.expires_at_epoch = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        + session.expires_in;
    session
}

async fn auth_request<T: Serialize + ?Sized>(
    hub_base_url: &str,
    proxy_url: &str,
    action: &str,
    body: &T,
) -> AppResult<AuthSession> {
    if hub_base_url.trim().is_empty() {
        return Err(AppError::msg(
            "Hub URL is not configured. Set it in Settings.",
        ));
    }
    let url = format!("{}/api/auth/{action}", hub_base_url.trim_end_matches('/'));
    let response = http::build_client(proxy_url)?
        .post(url)
        .json(body)
        .send()
        .await
        .map_err(|e| map_hub_http_error("Hub authentication", e))?;
    parse_hub_response(response, "Hub authentication").await
}

async fn parse_hub_response<T: serde::de::DeserializeOwned>(
    response: reqwest::Response,
    label: &str,
) -> AppResult<T> {
    if response.status().is_success() {
        return Ok(response.json().await?);
    }
    let status = response.status();
    let message = response
        .json::<serde_json::Value>()
        .await
        .ok()
        .and_then(|value| {
            let message = value.get("message")?;
            if let Some(text) = message.as_str() {
                return Some(text.to_string());
            }
            message.as_array().map(|items| {
                items
                    .iter()
                    .filter_map(|item| item.as_str())
                    .collect::<Vec<_>>()
                    .join(". ")
            })
        });
    Err(AppError::msg(message.unwrap_or_else(|| {
        format!("{label} failed: HTTP {status}")
    })))
}

fn map_hub_http_error(label: &str, err: reqwest::Error) -> AppError {
    if err.is_timeout() {
        return AppError::msg(format!(
            "{label} timed out after {}s",
            http::DEFAULT_HTTP_TIMEOUT.as_secs()
        ));
    }
    if let Some(status) = err.status() {
        return AppError::msg(format!("{label} failed: HTTP {status}"));
    }
    AppError::msg(format!("{label} failed: {err}"))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PackProject {
    pub id: String,
    pub name: String,
    pub description: String,
    pub latest_version: String,
    pub versions: Vec<String>,
    #[serde(default)]
    pub visibility: Option<String>,
    #[serde(default)]
    pub owner_id: Option<String>,
}

pub async fn list_packs_remote(
    hub_base_url: &str,
    proxy_url: &str,
    access_token: Option<&str>,
) -> AppResult<Vec<PackProject>> {
    if hub_base_url.trim().is_empty() {
        return Err(AppError::msg(
            "Hub URL is not configured. Set it in Settings.",
        ));
    }
    let url = format!("{}/packs", hub_base_url.trim_end_matches('/'));
    let client = http::build_client(proxy_url)?;
    let mut request = client.get(&url);
    if let Some(token) = access_token {
        request = request.bearer_auth(token);
    }
    let resp = request
        .send()
        .await
        .map_err(|e| map_hub_http_error("Hub list", e))?;
    if !resp.status().is_success() {
        return Err(AppError::msg(format!(
            "Hub list failed: HTTP {}",
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
pub async fn check_hub_status(hub_base_url: &str, proxy_url: &str) -> HubConnectionStatus {
    let base = hub_base_url.trim_end_matches('/').to_string();
    if base.is_empty() {
        return HubConnectionStatus {
            online: false,
            hub_base_url: base,
            message: Some("Hub URL is not configured.".into()),
        };
    }
    let url = format!("{base}/health");
    let client = match http::build_client(proxy_url) {
        Ok(client) => client,
        Err(e) => {
            return HubConnectionStatus {
                online: false,
                hub_base_url: base,
                message: Some(format!("Hub is not accessible: {e}")),
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
            message: Some(format!("Hub is not accessible (HTTP {})", resp.status())),
        },
        Err(e) => HubConnectionStatus {
            online: false,
            hub_base_url: base,
            message: Some(map_hub_http_error("Hub", e).to_string()),
        },
    }
}

/// Download a pack release into `vault/<id>/`, replacing any previous install.
pub async fn download_pack_remote(
    hub_base_url: &str,
    proxy_url: &str,
    pack_id: &str,
    version: Option<&str>,
    vault_root: &Path,
    access_token: Option<&str>,
) -> AppResult<PackMeta> {
    if hub_base_url.trim().is_empty() {
        return Err(AppError::msg(
            "Hub URL is not configured. Set it in Settings.",
        ));
    }
    let base = hub_base_url.trim_end_matches('/');
    let url = match version {
        Some(v) => format!("{base}/packs/{pack_id}/{v}/download"),
        None => format!("{base}/packs/{pack_id}/download"),
    };
    let client = http::build_client(proxy_url)?;
    let mut request = client.get(&url);
    if let Some(token) = access_token {
        request = request.bearer_auth(token);
    }
    let resp = request
        .send()
        .await
        .map_err(|e| map_hub_http_error("Hub download", e))?;
    if !resp.status().is_success() {
        return Err(AppError::msg(format!(
            "Hub download failed: HTTP {}",
            resp.status()
        )));
    }
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| map_hub_http_error("Hub download body", e))?;
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

pub async fn publish_pack_remote(
    hub_base_url: &str,
    proxy_url: &str,
    access_token: &str,
    pack: &PackMeta,
    vault_root: &Path,
) -> AppResult<PublishRequest> {
    if hub_base_url.trim().is_empty() {
        return Err(AppError::msg(
            "Hub URL is not configured. Set it in Settings.",
        ));
    }
    let temp = std::env::temp_dir().join(format!(
        "nest-publish-{}-{}.zip",
        pack.id,
        uuid::Uuid::new_v4()
    ));
    export_pack(pack, vault_root, &temp)?;
    let bytes = fs::read(&temp)?;
    let _ = fs::remove_file(&temp);
    let part = reqwest::multipart::Part::bytes(bytes)
        .file_name(format!("{}-{}.zip", pack.id, pack.version))
        .mime_str("application/zip")?;
    let form = reqwest::multipart::Form::new().part("file", part);
    let url = format!(
        "{}/api/publish-requests",
        hub_base_url.trim_end_matches('/')
    );
    let response = http::build_client(proxy_url)?
        .post(url)
        .bearer_auth(access_token)
        .multipart(form)
        .send()
        .await
        .map_err(|e| map_hub_http_error("Pack publish", e))?;
    if !response.status().is_success() {
        let status = response.status();
        let message = response
            .json::<serde_json::Value>()
            .await
            .ok()
            .and_then(|v| {
                v.get("message").and_then(|message| match message {
                    serde_json::Value::String(value) => Some(value.clone()),
                    serde_json::Value::Array(values) => Some(
                        values
                            .iter()
                            .filter_map(|value| value.as_str())
                            .collect::<Vec<_>>()
                            .join(". "),
                    ),
                    _ => None,
                })
            });
        return Err(AppError::hub_response(
            status.as_u16(),
            message.unwrap_or_else(|| format!("Pack publish failed: HTTP {status}")),
        ));
    }
    Ok(response.json().await?)
}

pub async fn list_publish_requests_remote(
    hub_base_url: &str,
    proxy_url: &str,
    access_token: &str,
) -> AppResult<Vec<PublishRequest>> {
    let url = format!(
        "{}/api/publish-requests/mine",
        hub_base_url.trim_end_matches('/')
    );
    let response = http::build_client(proxy_url)?
        .get(url)
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| map_hub_http_error("Publish request list", e))?;
    if !response.status().is_success() {
        return Err(AppError::msg(format!(
            "Publish request list failed: HTTP {}",
            response.status()
        )));
    }
    Ok(response.json().await?)
}

async fn message_request(
    hub_base_url: &str,
    proxy_url: &str,
    access_token: &str,
    method: reqwest::Method,
    path: &str,
) -> AppResult<reqwest::Response> {
    let url = format!(
        "{}/api/messages{}",
        hub_base_url.trim_end_matches('/'),
        path
    );
    let response = http::build_client(proxy_url)?
        .request(method, url)
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| map_hub_http_error("Hub messages", e))?;
    if !response.status().is_success() {
        return Err(AppError::msg(format!(
            "Hub messages failed: HTTP {}",
            response.status()
        )));
    }
    Ok(response)
}

pub async fn list_messages_remote(
    hub_base_url: &str,
    proxy_url: &str,
    access_token: &str,
    filter: &str,
    cursor: Option<&str>,
) -> AppResult<HubMessagePage> {
    let mut path = format!("?filter={}&limit=30", filter);
    if let Some(cursor) = cursor.filter(|value| !value.is_empty()) {
        path.push_str("&cursor=");
        path.push_str(cursor);
    }
    Ok(message_request(
        hub_base_url,
        proxy_url,
        access_token,
        reqwest::Method::GET,
        &path,
    )
    .await?
    .json()
    .await?)
}

pub async fn unread_count_remote(
    hub_base_url: &str,
    proxy_url: &str,
    access_token: &str,
) -> AppResult<UnreadCount> {
    Ok(message_request(
        hub_base_url,
        proxy_url,
        access_token,
        reqwest::Method::GET,
        "/unread-count",
    )
    .await?
    .json()
    .await?)
}

pub async fn mutate_message_remote(
    hub_base_url: &str,
    proxy_url: &str,
    access_token: &str,
    method: reqwest::Method,
    path: &str,
) -> AppResult<()> {
    message_request(hub_base_url, proxy_url, access_token, method, path).await?;
    Ok(())
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

pub fn record_sync(
    conn: &Connection,
    pack: &PackMeta,
    origin: &str,
    owner_id: Option<&str>,
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
/// A local pack's id/folder is always exactly its display name (the
/// `submitted.id` field is ignored) — see `rename_pack_folder` for why this
/// invariant matters and how it's kept in sync on rename.
pub fn create_empty_pack(submitted: PackMeta, vault_root: &Path) -> AppResult<PackMeta> {
    // Reuses normalize_pack_meta's validation (non-empty checks, folder-name
    // safety, SemVer) by feeding it the display name as the id — the same
    // checks a folder-import would apply, just against `name` instead of a
    // separately-chosen id.
    let pack = normalize_pack_meta(PackMeta {
        id: submitted.name.clone(),
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
        fs::write(
            destination.join("README.md"),
            format!("# {}\n", pack.name),
        )?;
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

/// Inspect and validate a local `.zip` without installing it.
pub fn inspect_local_pack(source: &Path, vault_root: &Path) -> AppResult<PackMeta> {
    let (tmp, _, pack) = prepare_local_pack(source, vault_root)?;
    let _ = fs::remove_dir_all(tmp);
    Ok(pack)
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

fn prepare_local_pack(source: &Path, vault_root: &Path) -> AppResult<(PathBuf, PathBuf, PackMeta)> {
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

    Ok((tmp, content_root, pack))
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
    write_pack_meta(pack_root, &meta)?;
    Ok(meta)
}

/// Renames a local pack: the vault's invariant is that a pack's folder name
/// *is* its id and its display name, so renaming moves the on-disk folder
/// (to `vault_root/{new_name}`) and updates `pack.json`'s id/name/path to
/// match, all in lockstep. Only ever called for `origin == "local"` packs —
/// downloaded packs keep the identity the hub already tracks, and enforcing
/// that is the caller's job (this function only handles the mechanics).
pub fn rename_pack_folder(
    vault_root: &Path,
    old_local_path: &str,
    new_name: &str,
) -> AppResult<PackMeta> {
    let new_name = new_name.trim().to_string();
    if new_name.is_empty() {
        return Err(AppError::msg("Pack name cannot be empty"));
    }
    validate_pack_folder_name(&new_name)?;

    let old_dir = vault_root.join(old_local_path);
    let new_dir = vault_root.join(&new_name);
    if new_name != old_local_path {
        if new_dir.exists() {
            return Err(AppError::msg(format!(
                "A pack named '{new_name}' already exists"
            )));
        }
        fs::rename(&old_dir, &new_dir)?;
    }

    let result = (|| {
        let mut meta = read_required_pack_meta(&new_dir)?;
        meta.id = new_name.clone();
        meta.name = new_name.clone();
        meta.path = new_name.clone();
        write_pack_meta(&new_dir, &meta)?;
        Ok(meta)
    })();
    if result.is_err() && new_name != old_local_path {
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

#[cfg(test)]
mod local_pack_tests {
    use super::*;

    fn test_root(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!("nest-{label}-{}", uuid::Uuid::new_v4()))
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
        assert_eq!(inspected.version, "2.0.0");
        assert!(import_local_pack(&zip_path, &vault, false).is_err());
        assert!(vault.join("sample/old.md").exists());

        let imported = import_local_pack(&zip_path, &vault, true).unwrap();
        assert_eq!(imported.version, "2.0.0");
        assert!(vault.join("sample/new.md").exists());
        assert!(!vault.join("sample/old.md").exists());
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
    fn create_empty_pack_derives_id_and_path_from_name() {
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
        assert_eq!(created.id, "My New Pack", "id must come from name, not the submitted id");
        assert_eq!(created.path, "My New Pack");
        assert!(vault.join("My New Pack/README.md").is_file());
        assert!(vault.join("My New Pack/pack.json").is_file());
        assert!(dir_has_markdown(&vault.join("My New Pack")));
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
        assert_eq!(updated.id, "Original Name", "id must never change here");
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
        assert_eq!(updated.description, "Keep me", "description must never change here");

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

        let renamed = rename_pack_folder(&vault, "Original Name", "New Name").unwrap();
        assert_eq!(renamed.id, "New Name");
        assert_eq!(renamed.name, "New Name");
        assert_eq!(renamed.path, "New Name");
        assert_eq!(renamed.description, "Keep me", "description is untouched by rename");
        assert!(!vault.join("Original Name").exists());
        assert!(vault.join("New Name/README.md").is_file());

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

        assert!(rename_pack_folder(&vault, "Pack A", "Pack B").is_err());
        assert!(vault.join("Pack A").exists(), "source must survive a rejected rename");

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

        assert!(rename_pack_folder(&vault, "Original Name", "   ").is_err());
        let _ = fs::remove_dir_all(root);
    }
}
