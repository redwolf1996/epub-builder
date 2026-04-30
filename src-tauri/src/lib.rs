mod doubao;

use image::{ImageReader, Rgba, RgbaImage};
use serde::Serialize;
use std::ffi::OsStr;
use std::fs;
use std::process::Command;
use std::path::Path;

const MAX_MERGE_TOTAL_PIXELS: u64 = 30_000_000;
const MAX_MERGE_TOTAL_HEIGHT: u32 = 20_000;
const MERGED_TEMP_PREFIX: &str = "merged-";
const MERGED_TEMP_EXTENSION: &str = "png";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MergeImagesCheckResponse {
    ok: bool,
    reason: Option<String>,
}

#[derive(Clone, Copy)]
struct MergeImagesPlan {
    max_width: u32,
    total_height: u32,
}

fn is_pdf_path(path: &Path) -> bool {
    path
        .extension()
        .and_then(OsStr::to_str)
        .is_some_and(|extension| extension.eq_ignore_ascii_case("pdf"))
}

fn merged_temp_dir() -> std::path::PathBuf {
    std::env::temp_dir().join("epub-builder")
}

fn analyze_merge_images(file_paths: &[String]) -> Result<MergeImagesPlan, String> {
    if file_paths.is_empty() {
        return Err("No image files provided".to_string());
    }

    let mut max_width = 0u32;
    let mut total_height = 0u32;
    let mut total_pixels = 0u64;

    for path_str in file_paths {
        let path = Path::new(path_str);
        if !path.exists() {
            return Err(format!("File not found: {path_str}"));
        }
        if is_pdf_path(path) {
            return Err("PDF files cannot be merged with images".to_string());
        }

        let reader = ImageReader::open(path)
            .map_err(|error| format!("Failed to open image {path_str}: {error}"))?
            .with_guessed_format()
            .map_err(|error| format!("Failed to inspect image {path_str}: {error}"))?;
        let (width, height) = reader
            .into_dimensions()
            .map_err(|error| format!("Failed to read image dimensions {path_str}: {error}"))?;

        max_width = max_width.max(width);
        total_height = total_height.checked_add(height).ok_or(
            "Merged image is too large. Reduce the number of images or split OCR into batches."
                .to_string(),
        )?;
        total_pixels = total_pixels
            .checked_add(u64::from(width) * u64::from(height))
            .ok_or(
                "Merged image is too large. Reduce the number of images or split OCR into batches."
                    .to_string(),
            )?;
    }

    if total_height > MAX_MERGE_TOTAL_HEIGHT || total_pixels > MAX_MERGE_TOTAL_PIXELS {
        return Err(
            "Merged image is too large. Reduce the number of images or split OCR into batches."
                .to_string(),
        );
    }

    Ok(MergeImagesPlan {
        max_width,
        total_height,
    })
}

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
fn check_doubao_executable(
    request: doubao::DoubaoExecutableCheckRequest,
) -> Result<doubao::DoubaoExecutableCheckResponse, String> {
    doubao::check_executable(&request)
}

#[tauri::command]
fn check_doubao_running() -> doubao::DoubaoRunningCheckResponse {
    doubao::check_running()
}

#[tauri::command]
fn check_merge_images(file_paths: Vec<String>) -> MergeImagesCheckResponse {
    if file_paths.len() <= 1 {
        return MergeImagesCheckResponse {
            ok: true,
            reason: None,
        };
    }

    match analyze_merge_images(&file_paths) {
        Ok(_) => MergeImagesCheckResponse {
            ok: true,
            reason: None,
        },
        Err(reason) => MergeImagesCheckResponse {
            ok: false,
            reason: Some(reason),
        },
    }
}

#[tauri::command]
fn merge_images(file_paths: Vec<String>) -> Result<String, String> {
    if file_paths.is_empty() {
        return Err("No image files provided".to_string());
    }
    if file_paths.len() == 1 {
        return Ok(file_paths[0].clone());
    }

    let plan = analyze_merge_images(&file_paths)?;
    let mut canvas = RgbaImage::from_pixel(
        plan.max_width,
        plan.total_height,
        Rgba([255, 255, 255, 255]),
    );
    let mut y_offset = 0u32;

    for path_str in &file_paths {
        let path = Path::new(path_str);
        let img = image::open(path).map_err(|error| format!("Failed to open image {path_str}: {error}"))?;
        let rgba = img.to_rgba8();
        image::imageops::overlay(&mut canvas, &rgba, 0, i64::from(y_offset));
        y_offset += img.height();
    }

    let temp_dir = merged_temp_dir();
    let _ = fs::create_dir_all(&temp_dir);
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|v| v.as_millis())
        .unwrap_or(0);
    let output_path = temp_dir.join(format!("{MERGED_TEMP_PREFIX}{timestamp}.{MERGED_TEMP_EXTENSION}"));

    canvas
        .save_with_format(&output_path, image::ImageFormat::Png)
        .map_err(|e| format!("Failed to save merged image: {e}"))?;

    Ok(output_path.to_string_lossy().to_string())
}

#[tauri::command]
fn delete_merged_temp_file(path: String) -> Result<(), String> {
    let candidate = Path::new(&path);
    let temp_dir = merged_temp_dir();

    if !candidate.starts_with(&temp_dir) {
        return Err("Refusing to delete a non-merged temp file".to_string());
    }

    let file_name = candidate
        .file_name()
        .and_then(OsStr::to_str)
        .ok_or("Merged temp file name is invalid".to_string())?;
    if !file_name.starts_with(MERGED_TEMP_PREFIX)
        || candidate.extension().and_then(OsStr::to_str) != Some(MERGED_TEMP_EXTENSION)
    {
        return Err("Refusing to delete a non-merged temp file".to_string());
    }

    match fs::remove_file(candidate) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("Failed to delete merged temp file: {error}")),
    }
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
            check_doubao_executable,
            check_doubao_running,
            check_merge_images,
            merge_images,
            delete_merged_temp_file,
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
