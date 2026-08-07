//! System tray for Nest.
//!
//! macOS uses a white template glyph that follows the menu-bar theme. Windows
//! uses a colored icon because its notification area does not tint templates.
//! See `scripts/generate-tray-icon.py` and `scripts/generate-windows-icons.py`.

use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

pub fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let show_i = MenuItem::with_id(app, "show", "Show Nest", true, None::<&str>)?;
    let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_i, &quit_i])?;

    #[cfg(target_os = "windows")]
    let icon_bytes = include_bytes!("../icons/windows-tray-icon.png");
    #[cfg(not(target_os = "windows"))]
    let icon_bytes = include_bytes!("../icons/tray-icon.png");

    let icon = Image::from_bytes(icon_bytes)?;

    let _tray = TrayIconBuilder::with_id("main")
        .icon(icon)
        // Only macOS should tint the white template glyph.
        .icon_as_template(cfg!(target_os = "macos"))
        .tooltip("Nest")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}
