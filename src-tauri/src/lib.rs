#[cfg(target_os = "windows")]
mod ocr {
    use std::fs;
    use windows::{
        core::HSTRING,
        Globalization::Language,
        Graphics::Imaging::BitmapDecoder,
        Media::Ocr::OcrEngine,
        Storage::{FileAccessMode, StorageFile},
    };

    pub fn ocr_image(path: &str, lang: &str) -> Result<String, String> {
        let bitmap = open_image_as_bitmap(path).map_err(|e| e.to_string())?;
        let engine = if lang.is_empty() {
            let available = OcrEngine::AvailableRecognizerLanguages()
                .map_err(|e| e.to_string())?;
            let first = available.First().map_err(|e| e.to_string())?;
            let tag = first.Current().map_err(|e| e.to_string())?.LanguageTag().map_err(|e| e.to_string())?;
            let language = Language::CreateLanguage(&HSTRING::from(tag)).map_err(|e| e.to_string())?;
            OcrEngine::TryCreateFromLanguage(&language).map_err(|e| e.to_string())?
        } else {
            let language = Language::CreateLanguage(&HSTRING::from(lang)).map_err(|e| e.to_string())?;
            OcrEngine::TryCreateFromLanguage(&language).map_err(|e| e.to_string())?
        };

        let raw = engine
            .RecognizeAsync(&bitmap)
            .map_err(|e| e.to_string())?
            .get()
            .map_err(|e| e.to_string())?
            .Text()
            .map_err(|e| e.to_string())?
            .to_string_lossy();

        // 清理多余空格和空行
        let cleaned = raw
            .lines()
            .map(|line| line.split_whitespace().collect::<Vec<_>>().join(""))
            .filter(|line| !line.is_empty())
            .collect::<Vec<_>>()
            .join("\n");

        Ok(cleaned)
    }

    fn open_image_as_bitmap(path: &str) -> windows::core::Result<windows::Graphics::Imaging::SoftwareBitmap> {
        let canonical = fs::canonicalize(path)
            .map_err(|_| windows::core::Error::from_win32())?;
        let path_str = canonical.to_string_lossy().replace("\\\\?\\", "");

        let file = StorageFile::GetFileFromPathAsync(&HSTRING::from(path_str))?.get()?;
        let stream = file.OpenAsync(FileAccessMode::Read)?.get()?;
        let decoder = BitmapDecoder::CreateAsync(&stream)?.get()?;
        decoder.GetSoftwareBitmapAsync()?.get()
    }
}

#[tauri::command]
fn ocr_image(path: String, lang: String) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        ocr::ocr_image(&path, &lang)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (path, lang);
        Err("OCR is only supported on Windows".to_string())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_single_instance::init(|_app, _args, _cwd| {}))
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![ocr_image])
        .setup(|app| {
            use tauri::Emitter;
            use tauri::menu::{MenuBuilder, PredefinedMenuItem, SubmenuBuilder};

            let file_menu = SubmenuBuilder::new(app, "File")
                .text("new_book", "New Book")
                .separator()
                .text("export_epub", "Export EPUB")
                .separator()
                .item(&PredefinedMenuItem::quit(app, None)?)
                .build()?;

            let edit_menu = SubmenuBuilder::new(app, "Edit")
                .item(&PredefinedMenuItem::undo(app, None)?)
                .item(&PredefinedMenuItem::redo(app, None)?)
                .separator()
                .item(&PredefinedMenuItem::cut(app, None)?)
                .item(&PredefinedMenuItem::copy(app, None)?)
                .item(&PredefinedMenuItem::paste(app, None)?)
                .item(&PredefinedMenuItem::select_all(app, None)?)
                .separator()
                .text("find_replace", "Find && Replace")
                .build()?;

            let view_menu = SubmenuBuilder::new(app, "View")
                .text("toggle_theme", "Toggle Theme")
                .text("toggle_fullscreen", "Toggle Fullscreen")
                .text("toggle_scroll_sync", "Toggle Scroll Sync")
                .build()?;

            let help_menu = SubmenuBuilder::new(app, "Help")
                .text("about", "About EPUB Builder")
                .build()?;

            let menu = MenuBuilder::new(app)
                .items(&[&file_menu, &edit_menu, &view_menu, &help_menu])
                .build()?;

            app.set_menu(menu)?;

            app.on_menu_event(move |app_handle, event| {
                let id = event.id().0.as_str();
                match id {
                    "new_book" | "export_epub" | "find_replace" | "toggle_theme"
                    | "toggle_fullscreen" | "toggle_scroll_sync" | "about" => {
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
