use crate::error::{AppError, AppResult};
use std::time::Duration;

/// Default Hub / outbound request timeout (matches Hub DOWNLOAD_TIMEOUT_MS).
pub const DEFAULT_HTTP_TIMEOUT: Duration = Duration::from_secs(120);

/// Build an HTTP client that ignores system `HTTP(S)_PROXY` unless the user
/// configured an explicit Nest proxy URL in Settings.
pub fn build_client(proxy_url: &str) -> AppResult<reqwest::Client> {
    build_client_with_timeout(proxy_url, DEFAULT_HTTP_TIMEOUT)
}

pub fn build_client_with_timeout(proxy_url: &str, timeout: Duration) -> AppResult<reqwest::Client> {
    let proxy = proxy_url.trim();
    let builder = reqwest::Client::builder().timeout(timeout);
    if proxy.is_empty() {
        return Ok(builder.no_proxy().build()?);
    }
    let proxy = reqwest::Proxy::all(proxy)
        .map_err(|e| AppError::msg(format!("Proxy URL is invalid: {e}")))?;
    Ok(builder.no_proxy().proxy(proxy).build()?)
}

/// Validate an optional proxy URL (`http`, `https`, or `socks5`). Empty is ok.
pub fn validate_proxy_url(value: &str) -> AppResult<()> {
    let value = value.trim();
    if value.is_empty() {
        return Ok(());
    }
    let url = reqwest::Url::parse(value)
        .map_err(|e| AppError::msg(format!("Proxy URL is invalid: {e}")))?;
    if !matches!(url.scheme(), "http" | "https" | "socks5" | "socks5h") {
        return Err(AppError::msg("Proxy URL must use http, https, or socks5"));
    }
    if url.host_str().is_none() {
        return Err(AppError::msg("Proxy URL must include a host"));
    }
    Ok(())
}
