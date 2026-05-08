mod doubao;
mod pdf_export;

use image::{
    ImageEncoder, ImageReader, Rgba, RgbaImage,
    codecs::png::{CompressionType as PngCompressionType, FilterType as PngFilterType, PngEncoder},
    imageops::{self, FilterType},
};
use serde::Serialize;
use std::ffi::OsStr;
use std::fs::{self, File};
use std::path::Path;
use std::process::Command;
use std::time::Instant;

const MAX_MERGE_TOTAL_PIXELS: u64 = 30_000_000;
const MAX_MERGE_TOTAL_HEIGHT: u32 = 20_000;
const MAX_MERGE_OUTPUT_WIDTH: u32 = 1600;
const MAX_MERGED_FILE_BYTES: u64 = 20 * 1024 * 1024;
const MAX_RECENT_MERGED_TEMP_FILES: usize = 3;
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
    canvas_width: u32,
    total_height: u32,
    total_pixels: u64,
}

#[derive(Clone, Copy)]
struct MergeImageItemPlan {
    output_width: u32,
    output_height: u32,
    x_offset: i64,
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

fn scaled_height_for(target_width: u32, width: u32, height: u32) -> Result<u32, String> {
    if width == 0 || height == 0 || target_width == 0 {
        return Err("Image dimensions must be greater than zero".to_string());
    }

    let scaled = u64::from(height) * u64::from(target_width);
    let scaled = scaled.div_ceil(u64::from(width));
    u32::try_from(scaled).map_err(|_| {
        "Merged image is too large. Reduce the number of images or split OCR into batches."
            .to_string()
    })
}

fn build_merge_plan_from_dimensions(
    dimensions: &[(u32, u32)],
) -> Result<(MergeImagesPlan, Vec<MergeImageItemPlan>), String> {
    if dimensions.is_empty() {
        return Err("No image files provided".to_string());
    }

    let source_max_width = dimensions.iter().map(|(width, _)| *width).max().unwrap_or(0);
    if source_max_width == 0 {
        return Err("Image dimensions must be greater than zero".to_string());
    }
    let canvas_width = source_max_width.min(MAX_MERGE_OUTPUT_WIDTH);

    let mut total_height = 0u32;
    let mut total_pixels = 0u64;
    let mut items = Vec::with_capacity(dimensions.len());

    for (width, height) in dimensions {
        let output_width = (*width).min(canvas_width);
        let output_height = if output_width == *width {
            *height
        } else {
            scaled_height_for(output_width, *width, *height)?
        };
        let x_offset = i64::from((canvas_width - output_width) / 2);

        total_height = total_height.checked_add(output_height).ok_or(
            "Merged image is too large. Reduce the number of images or split OCR into batches."
                .to_string(),
        )?;
        total_pixels = total_pixels
            .checked_add(u64::from(canvas_width) * u64::from(output_height))
            .ok_or(
                "Merged image is too large. Reduce the number of images or split OCR into batches."
                    .to_string(),
            )?;
        items.push(MergeImageItemPlan {
            output_width,
            output_height,
            x_offset,
        });
    }

    if total_height > MAX_MERGE_TOTAL_HEIGHT || total_pixels > MAX_MERGE_TOTAL_PIXELS {
        return Err(
            "Merged image is too large. Reduce the number of images or split OCR into batches."
                .to_string(),
        );
    }

    Ok((
        MergeImagesPlan {
            canvas_width,
            total_height,
            total_pixels,
        },
        items,
    ))
}

fn analyze_merge_images(file_paths: &[String]) -> Result<MergeImagesPlan, String> {
    if file_paths.is_empty() {
        return Err("No image files provided".to_string());
    }

    let mut dimensions = Vec::with_capacity(file_paths.len());

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
        dimensions.push((width, height));
    }

    build_merge_plan_from_dimensions(&dimensions).map(|(plan, _)| plan)
}

fn encode_png_file(
    output_path: &Path,
    canvas: &RgbaImage,
    compression: PngCompressionType,
    filter: PngFilterType,
) -> Result<(), String> {
    let file = File::create(output_path)
        .map_err(|error| format!("Failed to create merged image file: {error}"))?;
    let encoder = PngEncoder::new_with_quality(file, compression, filter);
    encoder
        .write_image(
            canvas.as_raw(),
            canvas.width(),
            canvas.height(),
            image::ExtendedColorType::Rgba8,
        )
        .map_err(|error| format!("Failed to save merged image: {error}"))
}

fn merged_file_size(path: &Path) -> Result<u64, String> {
    fs::metadata(path)
        .map(|metadata| metadata.len())
        .map_err(|error| format!("Failed to inspect merged image size: {error}"))
}

fn is_merged_temp_file(candidate: &Path) -> bool {
    let Some(file_name) = candidate.file_name().and_then(OsStr::to_str) else {
        return false;
    };
    file_name.starts_with(MERGED_TEMP_PREFIX)
        && candidate.extension().and_then(OsStr::to_str) == Some(MERGED_TEMP_EXTENSION)
}

fn prune_merged_temp_files(temp_dir: &Path, keep_count: usize) -> Result<(), String> {
    let entries = fs::read_dir(temp_dir)
        .map_err(|error| format!("Failed to enumerate merged temp files: {error}"))?;

    let mut merged_files = entries
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let path = entry.path();
            if !is_merged_temp_file(&path) {
                return None;
            }
            let modified = entry.metadata().ok()?.modified().ok()?;
            Some((modified, path))
        })
        .collect::<Vec<_>>();

    if merged_files.len() <= keep_count {
        return Ok(());
    }

    merged_files.sort_by(|left, right| right.0.cmp(&left.0));
    for (_, path) in merged_files.into_iter().skip(keep_count) {
        match fs::remove_file(&path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(format!("Failed to delete merged temp file {}: {error}", path.display()));
            }
        }
    }

    Ok(())
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

    let mut images = Vec::with_capacity(file_paths.len());
    let mut dimensions = Vec::with_capacity(file_paths.len());

    for path_str in &file_paths {
        let path = Path::new(path_str);
        let img = image::open(path)
            .map_err(|error| format!("Failed to open image {path_str}: {error}"))?;
        dimensions.push((img.width(), img.height()));
        images.push((path_str, img));
    }

    let (plan, item_plans) = build_merge_plan_from_dimensions(&dimensions)?;
    let render_started_at = Instant::now();
    let mut canvas = RgbaImage::from_pixel(
        plan.canvas_width,
        plan.total_height,
        Rgba([255, 255, 255, 255]),
    );
    let mut y_offset = 0u32;

    for ((_path_str, img), item_plan) in images.iter().zip(item_plans.iter()) {
        debug_assert!(plan.total_pixels >= u64::from(plan.canvas_width) * u64::from(item_plan.output_height));
        let resized = if img.width() == item_plan.output_width && img.height() == item_plan.output_height {
            img.to_rgba8()
        } else {
            imageops::resize(
                &img.to_rgba8(),
                item_plan.output_width,
                item_plan.output_height,
                FilterType::Triangle,
            )
        };
        let resized_height = resized.height();
        imageops::overlay(&mut canvas, &resized, item_plan.x_offset, i64::from(y_offset));
        y_offset += resized_height;
    }

    let temp_dir = merged_temp_dir();
    let _ = fs::create_dir_all(&temp_dir);
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|v| v.as_millis())
        .unwrap_or(0);
    let output_path = temp_dir.join(format!("{MERGED_TEMP_PREFIX}{timestamp}.{MERGED_TEMP_EXTENSION}"));
    let encode_started_at = Instant::now();
    encode_png_file(&output_path, &canvas, PngCompressionType::Fast, PngFilterType::NoFilter)?;
    let mut merged_size = merged_file_size(&output_path)?;

    if merged_size > MAX_MERGED_FILE_BYTES {
        encode_png_file(
            &output_path,
            &canvas,
            PngCompressionType::Best,
            PngFilterType::Adaptive,
        )?;
        merged_size = merged_file_size(&output_path)?;
    }

    if merged_size > MAX_MERGED_FILE_BYTES {
        let _ = fs::remove_file(&output_path);
        return Err(format!(
            "Merged image exceeds 20 MB upload limit after lossless compression ({} MB). Reduce the number of images or split OCR into batches.",
            merged_size.div_ceil(1024 * 1024)
        ));
    }

    doubao::debug_log(&format!(
        "merge_images file_count={} canvas={}x{} size_bytes={} render_ms={} encode_ms={} total_ms={}",
        file_paths.len(),
        plan.canvas_width,
        plan.total_height,
        merged_size,
        render_started_at.elapsed().as_millis(),
        encode_started_at.elapsed().as_millis(),
        render_started_at.elapsed().as_millis()
    ));

    Ok(output_path.to_string_lossy().to_string())
}

#[tauri::command]
fn export_pdf(request: pdf_export::ExportPdfRequest) -> Result<(), String> {
    let export_path = request.file_path.clone();
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        pdf_export::export_pdf_file(request)
    })) {
        Ok(result) => result,
        Err(payload) => {
            let panic_message = if let Some(message) = payload.downcast_ref::<&str>() {
                (*message).to_string()
            } else if let Some(message) = payload.downcast_ref::<String>() {
                message.clone()
            } else {
                "unknown panic".to_string()
            };
            let message = format!("PDF export panicked for {}: {}", export_path, panic_message);
            pdf_export::log_export_event(&message);
            Err(message)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{MAX_MERGE_TOTAL_HEIGHT, build_merge_plan_from_dimensions};

    #[test]
    fn merge_plan_caps_width_without_upscaling_smaller_images() {
        let (plan, items) =
            build_merge_plan_from_dimensions(&[(1440, 2000), (720, 1000), (1080, 1500)])
                .expect("merge plan");

        assert_eq!(plan.canvas_width, 1440);
        assert_eq!(items[0].output_width, 1440);
        assert_eq!(items[0].output_height, 2000);
        assert_eq!(items[0].x_offset, 0);
        assert_eq!(items[1].output_width, 720);
        assert_eq!(items[1].output_height, 1000);
        assert_eq!(items[1].x_offset, 360);
        assert_eq!(items[2].output_width, 1080);
        assert_eq!(items[2].output_height, 1500);
        assert_eq!(items[2].x_offset, 180);
        assert_eq!(plan.total_height, 4500);
    }

    #[test]
    fn merge_plan_downscales_wider_images_to_output_cap() {
        let (plan, items) =
            build_merge_plan_from_dimensions(&[(2400, 1800), (1200, 900)])
                .expect("merge plan");

        assert_eq!(plan.canvas_width, 1600);
        assert_eq!(items[0].output_width, 1600);
        assert_eq!(items[0].output_height, 1200);
        assert_eq!(items[0].x_offset, 0);
        assert_eq!(items[1].output_width, 1200);
        assert_eq!(items[1].output_height, 900);
        assert_eq!(items[1].x_offset, 200);
    }

    #[test]
    fn merge_plan_rejects_scaled_output_that_exceeds_height_limit() {
        let result = build_merge_plan_from_dimensions(&[
            (2400, 15_000),
            (1200, 11_000),
        ]);

        assert!(result.is_err());
        let message = result.err().unwrap_or_default();
        assert!(message.contains("Merged image is too large"));
        assert!(MAX_MERGE_TOTAL_HEIGHT < 22_000);
    }
}

#[tauri::command]
fn delete_merged_temp_file(path: String) -> Result<(), String> {
    let candidate = Path::new(&path);
    let temp_dir = merged_temp_dir();

    if !candidate.starts_with(&temp_dir) {
        return Err("Refusing to delete a non-merged temp file".to_string());
    }

    if !is_merged_temp_file(candidate) {
        return Err("Refusing to delete a non-merged temp file".to_string());
    }

    prune_merged_temp_files(&temp_dir, MAX_RECENT_MERGED_TEMP_FILES)
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
            export_pdf,
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
