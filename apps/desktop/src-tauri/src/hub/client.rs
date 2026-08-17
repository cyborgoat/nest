use crate::db::PackMeta;
use crate::error::{AppError, AppResult};
use crate::http;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

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
    #[serde(default)]
    pub commit_message: String,
    pub status: String,
    pub request_type: String,
    #[serde(default)]
    pub patch_revision: Option<i64>,
    #[serde(default)]
    pub base_patch_revision: Option<i64>,
    pub review_note: Option<String>,
    pub created_at: String,
    pub reviewed_at: Option<String>,
    #[serde(default)]
    pub submitter_id: Option<String>,
    #[serde(default)]
    pub submitter_name: Option<String>,
    #[serde(default)]
    pub can_cancel: bool,
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
    let response = http::build_hub_client(proxy_url)?
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
    let response = http::build_hub_client(proxy_url)?
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
    let response = http::build_hub_client(proxy_url)?
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
    Err(hub_error_from_response(response, label).await)
}

/// A 3xx from the Hub means a proxy/load-balancer redirected the request
/// instead of a plain success/failure — since Hub calls use a client with
/// redirects disabled (see `http::build_hub_client`), this always indicates
/// a URL/infra mismatch (commonly an http vs https scheme mismatch) rather
/// than a normal HTTP outcome, and is worth calling out explicitly: a
/// followed redirect would otherwise have silently dropped the
/// Authorization header and/or the POST body.
fn redirect_message(
    status: reqwest::StatusCode,
    headers: &reqwest::header::HeaderMap,
) -> Option<String> {
    if !status.is_redirection() {
        return None;
    }
    let location = headers
        .get(reqwest::header::LOCATION)
        .and_then(|value| value.to_str().ok());
    Some(match location {
        Some(location) => format!(
            "Hub redirected ({status}) to {location}. Check that the Hub URL in Settings uses the correct scheme (http vs https)."
        ),
        None => format!("Hub returned a redirect ({status}) with no Location header."),
    })
}

/// Turn a non-2xx Hub response into an `AppError`, reading a `{"message": ...}`
/// body when present (Nest's default error shape) and logging the outcome via
/// `nest_debug!` so `NEST_DEBUG=1` actually shows something for these
/// failures instead of nothing.
async fn hub_error_from_response(response: reqwest::Response, label: &str) -> AppError {
    let status = response.status();
    let url = response.url().to_string();
    if let Some(redirect_detail) = redirect_message(status, response.headers()) {
        let detail = format!("{label} failed: {redirect_detail}");
        crate::nest_debug!("hub", "{detail} request_url={url}");
        return AppError::hub_response(status.as_u16(), detail);
    }
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
    let detail = message.unwrap_or_else(|| format!("{label} failed: HTTP {status}"));
    crate::nest_debug!(
        "hub",
        "{label} failed status={status} request_url={url} message={detail}"
    );
    AppError::hub_response(status.as_u16(), detail)
}

fn map_hub_http_error(label: &str, err: reqwest::Error) -> AppError {
    let url = err
        .url()
        .map(|url| url.to_string())
        .unwrap_or_else(|| "?".into());
    if err.is_timeout() {
        let detail = format!(
            "{label} timed out after {}s",
            http::DEFAULT_HTTP_TIMEOUT.as_secs()
        );
        crate::nest_debug!("hub", "{detail} request_url={url}");
        return AppError::msg(detail);
    }
    if let Some(status) = err.status() {
        let detail = format!("{label} failed: HTTP {status}");
        crate::nest_debug!("hub", "{detail} request_url={url}");
        return AppError::msg(detail);
    }
    let detail = format!("{label} failed: {}", describe_error_chain(&err));
    crate::nest_debug!("hub", "{detail} request_url={url}");
    AppError::msg(detail)
}

/// reqwest::Error's own Display is often shallow (e.g. just "error sending
/// request for url (...)") for connection/TLS failures — the useful part
/// (DNS failure, certificate error, connection refused, ...) lives deeper in
/// the `source()` chain. Walk it so cloud-deployment issues like a bad/self-
/// signed certificate are actually visible instead of a generic message.
fn describe_error_chain(err: &dyn std::error::Error) -> String {
    let mut parts = vec![err.to_string()];
    let mut cause = err.source();
    while let Some(source) = cause {
        parts.push(source.to_string());
        cause = source.source();
    }
    parts.join(" — caused by: ")
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PackProject {
    pub id: String,
    pub name: String,
    pub description: String,
    pub latest_version: String,
    pub versions: Vec<String>,
    #[serde(default)]
    pub releases: Vec<PackReleaseSummary>,
    #[serde(default)]
    pub visibility: Option<String>,
    #[serde(default)]
    pub author: Option<PackAuthor>,
    #[serde(default)]
    pub maintainers: Vec<PackAuthor>,
    #[serde(default)]
    pub owner_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PackAuthor {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PackReleaseSummary {
    pub version: String,
    #[serde(default)]
    pub yanked: bool,
    #[serde(default)]
    pub patch_revision: i64,
    #[serde(default)]
    pub patched_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PackRelease {
    pub id: String,
    pub name: String,
    pub description: String,
    pub version: String,
    pub path: String,
    #[serde(default)]
    pub yanked: bool,
    #[serde(default)]
    pub patch_revision: i64,
    #[serde(default)]
    pub patched_at: Option<String>,
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
    let client = http::build_hub_client(proxy_url)?;
    let mut request = client.get(&url);
    if let Some(token) = access_token {
        request = request.bearer_auth(token);
    }
    let resp = request
        .send()
        .await
        .map_err(|e| map_hub_http_error("Hub list", e))?;
    if !resp.status().is_success() {
        return Err(hub_error_from_response(resp, "Hub list").await);
    }
    Ok(resp.json().await?)
}

pub async fn get_release_remote(
    hub_base_url: &str,
    proxy_url: &str,
    access_token: &str,
    pack_id: &str,
    version: &str,
) -> AppResult<PackRelease> {
    let url = format!(
        "{}/packs/{pack_id}/{version}",
        hub_base_url.trim_end_matches('/')
    );
    let response = http::build_hub_client(proxy_url)?
        .get(url)
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| map_hub_http_error("Hub release lookup", e))?;
    parse_hub_response(response, "Hub release lookup").await
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HubConnectionStatus {
    pub online: bool,
    pub hub_base_url: String,
    pub message: Option<String>,
}

pub struct DownloadedPack {
    pub pack: PackMeta,
    pub patch_revision: i64,
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
    let client = match http::build_hub_client(proxy_url) {
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
        Ok(resp) => {
            let status = resp.status();
            let message = redirect_message(status, resp.headers())
                .unwrap_or_else(|| format!("Hub is not accessible (HTTP {status})"));
            crate::nest_debug!("hub", "health check failed status={status} url={url}");
            HubConnectionStatus {
                online: false,
                hub_base_url: base,
                message: Some(message),
            }
        }
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
) -> AppResult<DownloadedPack> {
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
    let client = http::build_hub_client(proxy_url)?;
    let mut request = client.get(&url);
    if let Some(token) = access_token {
        request = request.bearer_auth(token);
    }
    let resp = request
        .send()
        .await
        .map_err(|e| map_hub_http_error("Hub download", e))?;
    if !resp.status().is_success() {
        return Err(hub_error_from_response(resp, "Hub download").await);
    }
    crate::nest_debug!("hub", "download start pack_id={pack_id} url={url}");
    let patch_revision = resp
        .headers()
        .get("x-pack-patch-revision")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(0);
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

    let extracted = super::zip::extract_zip_to_dir(&tmp, vault_root)?;
    let _ = fs::remove_file(&tmp);

    let mut meta = super::local_packs::read_required_pack_meta(&extracted)?;
    if meta.path.trim().is_empty() {
        meta.path = meta.id.clone();
    }
    if meta.version.is_empty() {
        if let Some(v) = version {
            meta.version = v.to_string();
        }
    }
    Ok(DownloadedPack {
        pack: meta,
        patch_revision,
    })
}

pub async fn publish_release_remote(
    hub_base_url: &str,
    proxy_url: &str,
    access_token: &str,
    pack: &PackMeta,
    source_local_path: &str,
    vault_root: &Path,
    commit_message: &str,
) -> AppResult<PublishRequest> {
    if hub_base_url.trim().is_empty() {
        return Err(AppError::msg(
            "Hub URL is not configured. Set it in Settings.",
        ));
    }
    let endpoint = format!(
        "{}/api/publish-requests/releases",
        hub_base_url.trim_end_matches('/')
    );
    upload_publish_archive(
        proxy_url,
        access_token,
        pack,
        source_local_path,
        vault_root,
        PublishUploadTarget {
            endpoint,
            label: "Release publish",
        },
        commit_message,
    )
    .await
}

pub async fn publish_live_patch_remote(
    hub_base_url: &str,
    proxy_url: &str,
    access_token: &str,
    pack: &PackMeta,
    source_local_path: &str,
    vault_root: &Path,
    commit_message: &str,
) -> AppResult<PublishRequest> {
    if hub_base_url.trim().is_empty() {
        return Err(AppError::msg(
            "Hub URL is not configured. Set it in Settings.",
        ));
    }
    let endpoint = format!(
        "{}/api/publish-requests/live-patches/{}/{}",
        hub_base_url.trim_end_matches('/'),
        pack.id,
        pack.version
    );
    upload_publish_archive(
        proxy_url,
        access_token,
        pack,
        source_local_path,
        vault_root,
        PublishUploadTarget {
            endpoint,
            label: "Live patch publish",
        },
        commit_message,
    )
    .await
}

struct PublishUploadTarget<'a> {
    endpoint: String,
    label: &'a str,
}

async fn upload_publish_archive(
    proxy_url: &str,
    access_token: &str,
    pack: &PackMeta,
    source_local_path: &str,
    vault_root: &Path,
    target: PublishUploadTarget<'_>,
    commit_message: &str,
) -> AppResult<PublishRequest> {
    let PublishUploadTarget { endpoint, label } = target;
    let temp = std::env::temp_dir().join(format!(
        "nest-publish-{}-{}.zip",
        pack.id,
        uuid::Uuid::new_v4()
    ));
    super::local_packs::export_pack_from_source(pack, source_local_path, vault_root, &temp)?;
    let bytes = fs::read(&temp)?;
    let _ = fs::remove_file(&temp);
    let part = reqwest::multipart::Part::bytes(bytes)
        .file_name(format!("{}-{}.zip", pack.id, pack.version))
        .mime_str("application/zip")?;
    let form = reqwest::multipart::Form::new()
        .text("commit_message", commit_message.to_string())
        .part("file", part);
    crate::nest_debug!(
        "hub",
        "{label} start pack_id={} endpoint={endpoint}",
        pack.id
    );
    let response = http::build_hub_client(proxy_url)?
        .post(&endpoint)
        .bearer_auth(access_token)
        .multipart(form)
        .send()
        .await
        .map_err(|e| map_hub_http_error(label, e))?;
    if !response.status().is_success() {
        return Err(hub_error_from_response(response, label).await);
    }
    Ok(response.json().await?)
}

pub async fn get_publish_request_remote(
    hub_base_url: &str,
    proxy_url: &str,
    access_token: &str,
    request_id: &str,
) -> AppResult<PublishRequest> {
    let url = format!(
        "{}/api/publish-requests/{}",
        hub_base_url.trim_end_matches('/'),
        request_id
    );
    let response = http::build_hub_client(proxy_url)?
        .get(url)
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| map_hub_http_error("Publish request lookup", e))?;
    if !response.status().is_success() {
        return Err(hub_error_from_response(response, "Publish request lookup").await);
    }
    Ok(response.json().await?)
}

#[derive(Debug, Clone, Deserialize)]
struct PackPendingStatus {
    pending: Option<PublishRequest>,
    #[serde(default)]
    can_cancel: bool,
}

/// The pack's current pending request, if any — reflects the Hub's true
/// state even for a request this device didn't submit (a teammate or admin
/// publishing the same pack from elsewhere).
pub async fn get_pack_pending_remote(
    hub_base_url: &str,
    proxy_url: &str,
    access_token: &str,
    pack_id: &str,
) -> AppResult<Option<PublishRequest>> {
    let url = format!(
        "{}/api/publish-requests/pack/{}/pending",
        hub_base_url.trim_end_matches('/'),
        pack_id
    );
    let response = http::build_hub_client(proxy_url)?
        .get(url)
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| map_hub_http_error("Pack pending status", e))?;
    if !response.status().is_success() {
        return Err(hub_error_from_response(response, "Pack pending status").await);
    }
    let status: PackPendingStatus = response.json().await?;
    Ok(status.pending.map(|mut pending| {
        pending.can_cancel = status.can_cancel;
        pending
    }))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CancelPublishResult {
    pub success: bool,
    pub request_id: String,
    pub pack_id: String,
}

pub async fn cancel_publish_request_remote(
    hub_base_url: &str,
    proxy_url: &str,
    access_token: &str,
    request_id: &str,
) -> AppResult<CancelPublishResult> {
    let url = format!(
        "{}/api/publish-requests/{}",
        hub_base_url.trim_end_matches('/'),
        request_id
    );
    let response = http::build_hub_client(proxy_url)?
        .delete(url)
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| map_hub_http_error("Cancel publish request", e))?;
    if !response.status().is_success() {
        return Err(hub_error_from_response(response, "Cancel publish request").await);
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
    let response = http::build_hub_client(proxy_url)?
        .request(method, url)
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| map_hub_http_error("Hub messages", e))?;
    if !response.status().is_success() {
        return Err(hub_error_from_response(response, "Hub messages").await);
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

#[cfg(test)]
mod hub_redirect_tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    /// A cloud Hub sitting behind a reverse proxy that issues a scheme
    /// upgrade (or trailing-slash) redirect must never be silently followed:
    /// reqwest's default redirect policy strips the Authorization header on
    /// any redirect that changes the effective port (http -> https always
    /// does), so a followed redirect would turn a real request into an
    /// unauthenticated one with no indication anything went wrong. Assert
    /// the Hub client reports the redirect explicitly instead.
    #[tokio::test]
    async fn list_packs_reports_redirects_instead_of_silently_following_them() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut buf = [0u8; 1024];
            let _ = socket.read(&mut buf).await;
            let response = "HTTP/1.1 302 Found\r\nLocation: https://example.invalid/packs\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
            let _ = socket.write_all(response.as_bytes()).await;
            let _ = socket.shutdown().await;
        });

        let base = format!("http://{addr}");
        let result = list_packs_remote(&base, "", None).await;
        server.await.unwrap();

        let err = result.expect_err("a 302 must be reported, not silently followed");
        let message = err.to_string();
        assert!(
            message.contains("redirected"),
            "expected a redirect-specific error, got: {message}"
        );
        assert!(
            message.contains("example.invalid"),
            "expected the Location target to be mentioned, got: {message}"
        );
    }
}
