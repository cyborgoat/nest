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
    apply_proxy(reqwest::Client::builder().timeout(timeout), proxy_url)
}

/// Apply the configured proxy (or explicitly opt out of the system default)
/// to a client builder and finish building it. Shared by
/// `build_client_with_timeout` and `build_hub_client`, which only differ in
/// their builder's own config (timeout, redirect policy) before this step.
fn apply_proxy(builder: reqwest::ClientBuilder, proxy_url: &str) -> AppResult<reqwest::Client> {
    let proxy = proxy_url.trim();
    let builder = builder.no_proxy();
    if proxy.is_empty() {
        return Ok(builder.build()?);
    }
    let proxy = reqwest::Proxy::all(proxy)
        .map_err(|e| AppError::msg(format!("Proxy URL is invalid: {e}")))?;
    Ok(builder.proxy(proxy).build()?)
}

/// Build an HTTP client for talking to the Nest Hub specifically. Unlike
/// `build_client`, this never auto-follows redirects: a reverse proxy or
/// load balancer in front of a cloud-hosted Hub that issues a scheme-upgrade
/// (http -> https) or trailing-slash redirect would otherwise silently lose
/// the `Authorization` header (reqwest strips it on any redirect that
/// changes the effective port, and http->https always does) and drop the
/// request body on a 301/302 POST — turning a real failure into a
/// misleading 401/404 with no indication a redirect ever happened. Callers
/// should treat a 3xx response as an explicit, reportable error instead.
pub fn build_hub_client(proxy_url: &str) -> AppResult<reqwest::Client> {
    apply_proxy(
        reqwest::Client::builder()
            .timeout(DEFAULT_HTTP_TIMEOUT)
            .redirect(reqwest::redirect::Policy::none()),
        proxy_url,
    )
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

/// Validate a required Hub / LLM base URL (`http` or `https` with a host).
/// Callers skip this when the setting is empty (those fields are optional).
pub fn validate_http_base_url(label: &str, value: &str) -> AppResult<()> {
    let url = reqwest::Url::parse(value)
        .map_err(|e| AppError::msg(format!("{label} is invalid: {e}")))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(AppError::msg(format!("{label} must use http or https")));
    }
    if url.host_str().is_none() {
        return Err(AppError::msg(format!("{label} must include a host")));
    }
    Ok(())
}
