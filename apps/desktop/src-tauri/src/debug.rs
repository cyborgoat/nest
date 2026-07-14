//! Debug logging gated by `NEST_DEBUG` (1/true/yes/on).

use std::path::PathBuf;

/// Load `.env` files from common locations (desktop / src-tauri / cwd).
pub fn init() {
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let candidates = [
        manifest.join(".env"),
        manifest.join("../.env"),
        manifest.join("../../.env"),
        PathBuf::from(".env"),
    ];
    for path in candidates {
        if path.is_file() {
            let _ = dotenvy::from_path(&path);
            log("env", format_args!("loaded {}", path.display()));
            break;
        }
    }
    // Also merge any process-cwd `.env` without overriding existing vars.
    let _ = dotenvy::dotenv();

    if enabled() {
        log("env", format_args!("NEST_DEBUG is on"));
    }
}

pub fn enabled() -> bool {
    match std::env::var("NEST_DEBUG") {
        Ok(v) => matches!(
            v.trim().to_ascii_lowercase().as_str(),
            "1" | "true" | "yes" | "on"
        ),
        Err(_) => false,
    }
}

pub fn log(target: &str, args: std::fmt::Arguments<'_>) {
    if enabled() {
        eprintln!("[nest:debug:{target}] {args}");
    }
}

#[macro_export]
macro_rules! nest_debug {
    ($target:expr, $($arg:tt)*) => {{
        $crate::debug::log($target, format_args!($($arg)*));
    }};
}
