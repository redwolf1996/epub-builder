mod doubao;

use std::process::Command;

#[tauri::command]
fn open_devtools(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    let win = app
        .get_webview_window("main")
        .ok_or("main window not found")?;
    #[cfg(debug_assertions)]
    {
        win.open_devtools();
        Ok(())
    }
    #[cfg(not(debug_assertions))]
    {
        let _ = win;
        Err("Developer tools are not enabled in this build".to_string())
    }
}

#[tauri::command]
fn open_external_target(target: String) -> Result<(), String> {
    if target.trim().is_empty() {
        return Err("target is required".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        let is_url = target.starts_with("http://") || target.starts_with("https://");
        let mut command = if is_url {
            let mut command = Command::new("cmd");
            command.args(["/C", "start", "", &target]);
            command
        } else {
            let mut command = Command::new("explorer.exe");
            command.arg(&target);
            command
        };

        command.spawn().map_err(|error| error.to_string())?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&target)
            .spawn()
            .map_err(|error| error.to_string())?;
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(&target)
            .spawn()
            .map_err(|error| error.to_string())?;
        return Ok(());
    }

    #[allow(unreachable_code)]
    Err("Opening external targets is not supported on this platform".to_string())
}

#[tauri::command]
fn start_doubao_ocr_session(
    app: tauri::AppHandle,
    state: tauri::State<doubao::DoubaoAutomationState>,
    request: doubao::DoubaoOcrRequest,
) -> Result<doubao::DoubaoOcrResponse, String> {
    doubao::start_session(&app, &state, &request)
}

#[tauri::command]
fn cancel_doubao_ocr_session(
    state: tauri::State<doubao::DoubaoAutomationState>,
    session_id: String,
) -> Result<doubao::DoubaoOcrResponse, String> {
    doubao::cancel_session(&state, &session_id)
}

#[tauri::command]
async fn toggle_menu(app: tauri::AppHandle, visible: bool) -> Result<bool, String> {
    use tauri::Manager;
    let win = app
        .get_webview_window("main")
        .ok_or("main window not found")?;
    if visible {
        win.show_menu().map_err(|e| e.to_string())?;
    } else {
        win.hide_menu().map_err(|e| e.to_string())?;
    }
    Ok(visible)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_single_instance::init(|_app, _args, _cwd| {}))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(doubao::DoubaoAutomationState::default())
        .invoke_handler(tauri::generate_handler![
            open_devtools,
            open_external_target,
            start_doubao_ocr_session,
            cancel_doubao_ocr_session,
            toggle_menu
        ])
        .setup(|app| {
            use tauri::Emitter;

            app.on_menu_event(move |app_handle, event| {
                let id = event.id().0.as_str();
                match id {
                    "new_book" | "export_epub" | "find_replace" | "toggle_theme"
                    | "app_fullscreen" | "toggle_scroll_sync" | "about" => {
                        let _ = app_handle.emit("menu-event", id);
                    }
                    _ => {}
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
