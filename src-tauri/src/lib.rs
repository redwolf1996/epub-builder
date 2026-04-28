mod doubao;

use serde::{Deserialize, Serialize};
use std::process::Command;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OcrResult {
    text: String,
    engine: String,
    raw_text: Option<String>,
    corrected: Option<bool>,
    confidence: Option<f32>,
    warning: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalOcrStatus {
    ready: bool,
    needs_python: bool,
    message: Option<String>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OcrPageRange {
    start: u16,
    end: u16,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OcrRequest {
    path: String,
    mode: String,
    engine: Option<String>,
    correct_text: Option<bool>,
    page_range: Option<OcrPageRange>,
}

#[cfg(target_os = "windows")]
mod ocr {
    use std::{
        env, fs,
        os::windows::process::CommandExt,
        path::{Path, PathBuf},
        process::Command,
    };

    use image::{
        imageops::{self, FilterType},
        DynamicImage, GrayImage, ImageFormat, ImageReader, Luma,
    };
    use pdfium_auto::bind_pdfium_silent;
    use pdfium_render::prelude::*;
    use serde::Deserialize;
    use tauri::{AppHandle, Manager};
    use tempfile::{Builder, NamedTempFile};
    use windows::{
        core::HSTRING,
        Globalization::Language,
        Graphics::Imaging::BitmapDecoder,
        Media::Ocr::OcrEngine,
        Storage::{FileAccessMode, StorageFile},
    };

    use crate::{LocalOcrStatus, OcrPageRange, OcrRequest, OcrResult};

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    enum ResolvedSidecar {
        Executable(PathBuf),
        Script(PathBuf),
    }

    #[derive(Clone, Copy)]
    pub enum OcrMode {
        Auto,
        Chinese,
        English,
    }

    #[derive(Clone, Copy)]
    pub enum OcrEnginePreference {
        Auto,
        Local,
        Windows,
    }

    impl OcrMode {
        pub fn from_str(value: &str) -> Self {
            match value {
                "chinese" => Self::Chinese,
                "english" => Self::English,
                _ => Self::Auto,
            }
        }

        fn local_sidecar_arg(self) -> &'static str {
            match self {
                Self::Auto => "auto",
                Self::Chinese => "chinese",
                Self::English => "english",
            }
        }
    }

    impl OcrEnginePreference {
        pub fn from_str(value: &str) -> Self {
            match value {
                "local" => Self::Local,
                "windows" => Self::Windows,
                _ => Self::Auto,
            }
        }
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct LocalOcrOutput {
        text: String,
        raw_text: Option<String>,
        corrected: Option<bool>,
        confidence: Option<f32>,
        warning: Option<String>,
    }

    pub fn ocr_document(app: &AppHandle, request: &OcrRequest) -> Result<OcrResult, String> {
        let mode = OcrMode::from_str(&request.mode);
        let engine = OcrEnginePreference::from_str(request.engine.as_deref().unwrap_or("auto"));
        let correct_text = request.correct_text.unwrap_or(true);
        if is_pdf_path(&request.path) {
            return ocr_pdf_document(
                app,
                &request.path,
                mode,
                engine,
                correct_text,
                request.page_range.as_ref(),
            );
        }

        ocr_bitmap_path(app, &request.path, mode, engine, correct_text)
    }

    pub fn pdf_page_count(_app: &AppHandle, path: &str) -> Result<u16, String> {
        let pdfium = bind_pdfium()?;
        let document = pdfium
            .load_pdf_from_file(path, None)
            .map_err(|error| error.to_string())?;
        u16::try_from(document.pages().len())
            .map_err(|_| "PDF has too many pages for this importer".to_string())
    }

    pub fn prepare_local_ocr(app: &AppHandle) -> Result<LocalOcrStatus, String> {
        let sidecar = match resolve_sidecar_path(app) {
            Ok(sidecar) => sidecar,
            Err(error) => {
                return Ok(LocalOcrStatus {
                    ready: false,
                    needs_python: false,
                    message: Some(error),
                });
            }
        };

        match sidecar {
            ResolvedSidecar::Executable(_) => Ok(LocalOcrStatus {
                ready: true,
                needs_python: false,
                message: None,
            }),
            ResolvedSidecar::Script(script_path) => ensure_local_ocr_environment(&script_path),
        }
    }

    fn ocr_bitmap_path(
        app: &AppHandle,
        path: &str,
        mode: OcrMode,
        engine: OcrEnginePreference,
        correct_text: bool,
    ) -> Result<OcrResult, String> {
        if matches!(engine, OcrEnginePreference::Windows) {
            let text = run_windows_ocr(path, mode)?;
            return Ok(OcrResult {
                text,
                engine: "windows".to_string(),
                raw_text: None,
                corrected: Some(false),
                confidence: None,
                warning: None,
            });
        }

        let has_bundled_local = matches!(resolve_sidecar_path(app), Ok(ResolvedSidecar::Executable(_)));
        let fallback_warning = match run_local_ocr(app, path, mode, correct_text) {
            Ok(output) if !output.text.trim().is_empty() => {
                return Ok(OcrResult {
                    text: normalize_text(&output.text),
                    engine: "local".to_string(),
                    raw_text: output.raw_text,
                    corrected: output.corrected,
                    confidence: output.confidence,
                    warning: output.warning,
                });
            }
            Ok(_) => Some("LOCAL_EMPTY".to_string()),
            Err(error) => {
                if matches!(engine, OcrEnginePreference::Local) {
                    return Err(format!("Sidecar OCR failed: {error}"));
                }
                if has_bundled_local {
                    return Err(format!("Bundled local OCR failed: {error}"));
                }
                Some("LOCAL_UNAVAILABLE".to_string())
            }
        };

        if matches!(engine, OcrEnginePreference::Local) {
            return Err("Sidecar OCR returned no text".to_string());
        }

        if has_bundled_local {
            return Err(
                "Bundled local OCR returned no text, and Windows OCR fallback was skipped"
                    .to_string(),
            );
        }

        let text = run_windows_ocr(path, mode)?;
        Ok(OcrResult {
            text,
            engine: "windows".to_string(),
            raw_text: None,
            corrected: Some(false),
            confidence: None,
            warning: fallback_warning,
        })
    }

    fn ocr_pdf_document(
        app: &AppHandle,
        path: &str,
        mode: OcrMode,
        engine: OcrEnginePreference,
        correct_text: bool,
        page_range: Option<&OcrPageRange>,
    ) -> Result<OcrResult, String> {
        let page_range = page_range
            .cloned()
            .ok_or("PDF OCR requires a page range".to_string())?;
        let pdfium = bind_pdfium()?;
        let document = pdfium
            .load_pdf_from_file(path, None)
            .map_err(|error| error.to_string())?;
        let total_pages = u16::try_from(document.pages().len())
            .map_err(|_| "PDF has too many pages for this importer".to_string())?;
        validate_page_range(&page_range, total_pages)?;

        let mut blocks = Vec::new();
        let mut raw_blocks = Vec::new();
        let mut used_windows = false;
        let mut first_warning = None;
        let mut confidences = Vec::new();

        for page_number in page_range.start..=page_range.end {
            let rendered = render_pdf_page(&document, page_number)?;
            let rendered_path = rendered.path().to_string_lossy().to_string();
            let result = ocr_bitmap_path(app, &rendered_path, mode, engine, correct_text)?;

            if result.engine == "windows" {
                used_windows = true;
                if first_warning.is_none() {
                    first_warning = result.warning.clone();
                }
            } else if let Some(confidence) = result.confidence {
                confidences.push(confidence);
            }

            blocks.push(format_page_text(page_number, &result.text));
            if let Some(raw_text) = result.raw_text.as_ref() {
                raw_blocks.push(format_page_text(page_number, raw_text));
            }
        }

        let has_text = blocks
            .iter()
            .any(|block| block.lines().skip(1).any(|line| !line.trim().is_empty()));
        let text = if has_text {
            blocks.join("\n\n")
        } else {
            String::new()
        };

        Ok(OcrResult {
            text,
            engine: if used_windows {
                "windows".to_string()
            } else {
                "local".to_string()
            },
            raw_text: if raw_blocks.is_empty() {
                None
            } else {
                Some(raw_blocks.join("\n\n"))
            },
            corrected: Some(!raw_blocks.is_empty()),
            confidence: average_confidence(&confidences),
            warning: first_warning,
        })
    }

    fn run_local_ocr(
        app: &AppHandle,
        path: &str,
        mode: OcrMode,
        correct_text: bool,
    ) -> Result<LocalOcrOutput, String> {
        let sidecar = resolve_sidecar_path(app)?;
        let mut errors = Vec::new();

        match sidecar {
            ResolvedSidecar::Executable(sidecar_path) => {
                let mut command = hidden_command(&sidecar_path);
                command.arg(path).arg(mode.local_sidecar_arg());
                if correct_text {
                    command.arg("--correct");
                }
                let output = command.output();

                match output {
                    Ok(output) if output.status.success() => {
                        return parse_local_ocr_output(&output.stdout, &output.stderr);
                    }
                    Ok(output) => {
                        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
                        let reason = if stderr.is_empty() {
                            format!("process exited with status {}", output.status)
                        } else {
                            stderr
                        };
                        errors.push(format!("{}: {reason}", sidecar_path.to_string_lossy()));
                    }
                    Err(error) => {
                        errors.push(format!("{}: {error}", sidecar_path.to_string_lossy()));
                    }
                }
            }
            ResolvedSidecar::Script(sidecar_path) => {
                for (program, extra_args) in python_candidates() {
                    let mut command = hidden_command(&program);
                    command
                        .args(&extra_args)
                        .arg(&sidecar_path)
                        .arg(path)
                        .arg(mode.local_sidecar_arg());
                    if correct_text {
                        command.arg("--correct");
                    }
                    let output = command.output();

                    match output {
                        Ok(output) if output.status.success() => {
                            return parse_local_ocr_output(&output.stdout, &output.stderr);
                        }
                        Ok(output) => {
                            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
                            let reason = if stderr.is_empty() {
                                format!("process exited with status {}", output.status)
                            } else {
                                stderr
                            };
                            errors.push(format!("{program}: {reason}"));
                        }
                        Err(error) => {
                            errors.push(format!("{program}: {error}"));
                        }
                    }
                }
            }
        }

        Err(errors.join(" | "))
    }

    fn parse_local_ocr_output(stdout: &[u8], stderr: &[u8]) -> Result<LocalOcrOutput, String> {
        serde_json::from_slice::<LocalOcrOutput>(stdout).map_err(|error| {
            let stdout_preview = String::from_utf8_lossy(stdout).trim().to_string();
            let stderr_preview = String::from_utf8_lossy(stderr).trim().to_string();

            if stderr_preview.is_empty() {
                format!(
                    "failed to parse local OCR output: {error}; stdout: {stdout_preview}"
                )
            } else {
                format!(
                    "failed to parse local OCR output: {error}; stdout: {stdout_preview}; stderr: {stderr_preview}"
                )
            }
        })
    }

    fn hidden_command(program: impl AsRef<std::ffi::OsStr>) -> Command {
        let mut command = Command::new(program);
        command.creation_flags(CREATE_NO_WINDOW);
        command
    }

    fn python_candidates() -> Vec<(String, Vec<String>)> {
        if let Ok(custom) = env::var("EPUB_OCR_PYTHON") {
            return vec![(custom, Vec::new())];
        }

        let mut candidates = Vec::new();
        let local_venv = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("ocr")
            .join(".venv")
            .join("Scripts")
            .join("python.exe");
        if local_venv.exists() {
            candidates.push((local_venv.to_string_lossy().to_string(), Vec::new()));
        }

        candidates.push(("python".to_string(), Vec::new()));
        candidates.push(("py".to_string(), vec!["-3".to_string()]));
        candidates
    }

    fn system_python_candidates() -> Vec<(String, Vec<String>)> {
        if let Ok(custom) = env::var("EPUB_OCR_PYTHON") {
            return vec![(custom, Vec::new())];
        }

        vec![
            ("python".to_string(), Vec::new()),
            ("py".to_string(), vec!["-3".to_string()]),
        ]
    }

    fn resolve_sidecar_path(app: &AppHandle) -> Result<ResolvedSidecar, String> {
        if let Ok(custom) = env::var("EPUB_OCR_SIDECAR") {
            let path = PathBuf::from(custom);
            if path.exists() {
                return Ok(sidecar_kind(path));
            }
        }

        let dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("ocr")
            .join("sidecar.py");
        if dev_path.exists() {
            return Ok(ResolvedSidecar::Script(dev_path));
        }

        let dev_exe_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("ocr")
            .join("dist")
            .join("rapidocr-sidecar")
            .join("rapidocr-sidecar.exe");
        if dev_exe_path.exists() {
            return Ok(ResolvedSidecar::Executable(dev_exe_path));
        }

        let legacy_dev_exe_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("ocr")
            .join("dist")
            .join("rapidocr-sidecar.exe");
        if legacy_dev_exe_path.exists() {
            return Ok(ResolvedSidecar::Executable(legacy_dev_exe_path));
        }

        let resource_dir = app
            .path()
            .resource_dir()
            .map_err(|error| error.to_string())?
            .join("ocr");
        let resource_exe_path = resource_dir
            .join("dist")
            .join("rapidocr-sidecar")
            .join("rapidocr-sidecar.exe");
        if resource_exe_path.exists() {
            return Ok(ResolvedSidecar::Executable(resource_exe_path));
        }

        let flat_resource_dir_exe_path = resource_dir
            .join("rapidocr-sidecar")
            .join("rapidocr-sidecar.exe");
        if flat_resource_dir_exe_path.exists() {
            return Ok(ResolvedSidecar::Executable(flat_resource_dir_exe_path));
        }

        let legacy_resource_exe_path = resource_dir.join("dist").join("rapidocr-sidecar.exe");
        if legacy_resource_exe_path.exists() {
            return Ok(ResolvedSidecar::Executable(legacy_resource_exe_path));
        }

        let flat_resource_exe_path = resource_dir.join("rapidocr-sidecar.exe");
        if flat_resource_exe_path.exists() {
            return Ok(ResolvedSidecar::Executable(flat_resource_exe_path));
        }

        let resource_script_path = resource_dir.join("sidecar.py");
        if resource_script_path.exists() {
            return Ok(ResolvedSidecar::Script(resource_script_path));
        }

        Err("OCR sidecar script not found".to_string())
    }

    fn sidecar_kind(path: PathBuf) -> ResolvedSidecar {
        if path
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|value| value.eq_ignore_ascii_case("exe"))
        {
            ResolvedSidecar::Executable(path)
        } else {
            ResolvedSidecar::Script(path)
        }
    }

    fn ensure_local_ocr_environment(script_path: &Path) -> Result<LocalOcrStatus, String> {
        let root = script_path
            .parent()
            .ok_or("OCR sidecar directory not found".to_string())?;
        let venv_python = root.join(".venv").join("Scripts").join("python.exe");
        let requirements = root.join("requirements.txt");

        if venv_python.exists()
            && validate_local_ocr_python(&venv_python)
            && warmup_local_ocr(&venv_python, script_path)
        {
            return Ok(LocalOcrStatus {
                ready: true,
                needs_python: false,
                message: None,
            });
        }

        let mut errors = Vec::new();
        for (program, extra_args) in system_python_candidates() {
            let create_venv = hidden_command(&program)
                .args(&extra_args)
                .args(["-m", "venv"])
                .arg(root.join(".venv"))
                .output();

            match create_venv {
                Ok(output) if output.status.success() => {
                    let pip_upgrade = hidden_command(&venv_python)
                        .args(["-m", "pip", "install", "--upgrade", "pip"])
                        .output()
                        .map_err(|error| error.to_string())?;
                    if !pip_upgrade.status.success() {
                        let stderr = String::from_utf8_lossy(&pip_upgrade.stderr)
                            .trim()
                            .to_string();
                        errors.push(format!("pip upgrade failed: {stderr}"));
                        continue;
                    }

                    let install = hidden_command(&venv_python)
                        .args(["-m", "pip", "install", "-r"])
                        .arg(&requirements)
                        .output()
                        .map_err(|error| error.to_string())?;
                    if !install.status.success() {
                        let stderr = String::from_utf8_lossy(&install.stderr).trim().to_string();
                        errors.push(format!("dependency install failed: {stderr}"));
                        continue;
                    }

                    if validate_local_ocr_python(&venv_python)
                        && warmup_local_ocr(&venv_python, script_path)
                    {
                        return Ok(LocalOcrStatus {
                            ready: true,
                            needs_python: false,
                            message: None,
                        });
                    }

                    errors.push(
                        "Local OCR dependencies installed but warmup still failed".to_string(),
                    );
                }
                Ok(output) => {
                    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
                    let reason = if stderr.is_empty() {
                        format!("process exited with status {}", output.status)
                    } else {
                        stderr
                    };
                    errors.push(format!("{program}: {reason}"));
                }
                Err(error) => {
                    errors.push(format!("{program}: {error}"));
                }
            }
        }

        Ok(LocalOcrStatus {
            ready: false,
            needs_python: true,
            message: Some(if errors.is_empty() {
                "Python 3 is required to prepare local OCR".to_string()
            } else {
                errors.join(" | ")
            }),
        })
    }

    fn validate_local_ocr_python(python_path: &Path) -> bool {
        let output = hidden_command(python_path)
            .args([
                "-c",
                "import rapidocr, cv2, numpy; from PIL import Image; print('ok')",
            ])
            .output();

        matches!(output, Ok(result) if result.status.success())
    }

    fn warmup_local_ocr(python_path: &Path, script_path: &Path) -> bool {
        let output = hidden_command(python_path)
            .arg(script_path)
            .arg("--warmup")
            .output();

        matches!(output, Ok(result) if result.status.success())
    }

    fn is_pdf_path(path: &str) -> bool {
        Path::new(path)
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|value| value.eq_ignore_ascii_case("pdf"))
    }

    fn bind_pdfium() -> Result<Pdfium, String> {
        bind_pdfium_silent().map_err(|error| error.to_string())
    }

    fn validate_page_range(page_range: &OcrPageRange, total_pages: u16) -> Result<(), String> {
        if page_range.start == 0 || page_range.end == 0 {
            return Err("Page numbers must start at 1".to_string());
        }

        if page_range.start > page_range.end {
            return Err("Start page must be less than or equal to end page".to_string());
        }

        if page_range.end > total_pages {
            return Err(format!(
                "Page range {}-{} exceeds PDF page count {}",
                page_range.start, page_range.end, total_pages
            ));
        }

        Ok(())
    }

    fn render_pdf_page(
        document: &PdfDocument<'_>,
        page_number: u16,
    ) -> Result<NamedTempFile, String> {
        let page_index = page_number - 1;
        let page = document
            .pages()
            .get(page_index)
            .map_err(|error| format!("Failed to load PDF page {page_number}: {error}"))?;
        let rendered = page
            .render_with_config(
                &PdfRenderConfig::new()
                    .set_target_width(2200)
                    .render_form_data(true),
            )
            .map_err(|error| format!("Failed to render PDF page {page_number}: {error}"))?;
        let image = rendered.as_image();
        let temp_file = Builder::new()
            .suffix(".png")
            .tempfile()
            .map_err(|error| error.to_string())?;
        image
            .save_with_format(temp_file.path(), ImageFormat::Png)
            .map_err(|error| format!("Failed to save rendered PDF page {page_number}: {error}"))?;
        Ok(temp_file)
    }

    fn format_page_text(page_number: u16, text: &str) -> String {
        let normalized = normalize_text(text);
        if normalized.is_empty() {
            format!("--- Page {page_number} ---")
        } else {
            format!("--- Page {page_number} ---\n{normalized}")
        }
    }

    fn average_confidence(confidences: &[f32]) -> Option<f32> {
        if confidences.is_empty() {
            return None;
        }

        Some(confidences.iter().sum::<f32>() / confidences.len() as f32)
    }

    fn run_windows_ocr(path: &str, mode: OcrMode) -> Result<String, String> {
        let preprocessed = preprocess_image(path)?;
        let bitmap = open_image_as_bitmap(preprocessed.path()).map_err(|e| e.to_string())?;
        let language = preferred_windows_language(mode)?;
        let engine = OcrEngine::TryCreateFromLanguage(&language).map_err(|e| e.to_string())?;

        let raw = engine
            .RecognizeAsync(&bitmap)
            .map_err(|e| e.to_string())?
            .get()
            .map_err(|e| e.to_string())?
            .Text()
            .map_err(|e| e.to_string())?
            .to_string_lossy();

        Ok(normalize_text(&raw))
    }

    fn preferred_windows_language(mode: OcrMode) -> Result<Language, String> {
        let available = OcrEngine::AvailableRecognizerLanguages().map_err(|e| e.to_string())?;
        let count = available.Size().map_err(|e| e.to_string())?;
        let mut tags = Vec::new();

        for index in 0..count {
            let language = available.GetAt(index).map_err(|e| e.to_string())?;
            let tag = language
                .LanguageTag()
                .map_err(|e| e.to_string())?
                .to_string_lossy();
            tags.push(tag);
        }

        let preferred_tags: &[&str] = match mode {
            OcrMode::Auto => &["zh-Hans", "zh-CN", "zh", "en-US", "en-GB", "en"],
            OcrMode::Chinese => &["zh-Hans", "zh-CN", "zh"],
            OcrMode::English => &["en-US", "en-GB", "en"],
        };

        for preferred in preferred_tags {
            if let Some(installed_tag) =
                tags.iter().find(|tag| language_tag_matches(tag, preferred))
            {
                return Language::CreateLanguage(&HSTRING::from(installed_tag))
                    .map_err(|e| e.to_string());
            }
        }

        Err(format!(
            "No matching Windows OCR language pack is installed for mode {}. Available OCR languages: {}",
            mode.local_sidecar_arg(),
            tags.join(", ")
        ))
    }

    fn language_tag_matches(installed_tag: &str, preferred_tag: &str) -> bool {
        installed_tag.eq_ignore_ascii_case(preferred_tag)
            || installed_tag
                .strip_prefix(preferred_tag)
                .is_some_and(|suffix| suffix.starts_with('-'))
            || preferred_tag
                .strip_prefix(installed_tag)
                .is_some_and(|suffix| suffix.starts_with('-'))
    }

    fn preprocess_image(path: &str) -> Result<NamedTempFile, String> {
        let image = ImageReader::open(path)
            .map_err(|error| error.to_string())?
            .decode()
            .map_err(|error| error.to_string())?;

        let grayscale = image.grayscale().adjust_contrast(35.0);
        let resized = upscale_if_needed(grayscale);
        let denoised = DynamicImage::ImageLuma8(imageops::blur(&resized.to_luma8(), 0.8));
        let sharpened = imageops::unsharpen(&denoised.to_luma8(), 1.2, 1);
        let binary = otsu_threshold(&sharpened);

        let temp_file = Builder::new()
            .suffix(".png")
            .tempfile()
            .map_err(|error| error.to_string())?;
        DynamicImage::ImageLuma8(binary)
            .save_with_format(temp_file.path(), ImageFormat::Png)
            .map_err(|error| error.to_string())?;
        Ok(temp_file)
    }

    fn upscale_if_needed(image: DynamicImage) -> DynamicImage {
        let width = image.width();
        if width >= 1800 {
            return image;
        }

        let scale = 1800.0 / width.max(1) as f32;
        let height = ((image.height() as f32) * scale).round().max(1.0) as u32;
        image.resize(1800, height, FilterType::Lanczos3)
    }

    fn otsu_threshold(image: &GrayImage) -> GrayImage {
        let threshold = compute_otsu_threshold(image);
        GrayImage::from_fn(image.width(), image.height(), |x, y| {
            let pixel = image.get_pixel(x, y)[0];
            if pixel > threshold {
                Luma([255])
            } else {
                Luma([0])
            }
        })
    }

    fn compute_otsu_threshold(image: &GrayImage) -> u8 {
        let mut histogram = [0u32; 256];
        for pixel in image.pixels() {
            histogram[pixel[0] as usize] += 1;
        }

        let total = (image.width() * image.height()) as f64;
        let mut sum = 0.0;
        for (index, count) in histogram.iter().enumerate() {
            sum += (index as f64) * (*count as f64);
        }

        let mut sum_background = 0.0;
        let mut weight_background = 0.0;
        let mut max_variance = 0.0;
        let mut threshold = 127u8;

        for (index, count) in histogram.iter().enumerate() {
            weight_background += *count as f64;
            if weight_background == 0.0 {
                continue;
            }

            let weight_foreground = total - weight_background;
            if weight_foreground == 0.0 {
                break;
            }

            sum_background += (index as f64) * (*count as f64);
            let mean_background = sum_background / weight_background;
            let mean_foreground = (sum - sum_background) / weight_foreground;
            let variance =
                weight_background * weight_foreground * (mean_background - mean_foreground).powi(2);

            if variance > max_variance {
                max_variance = variance;
                threshold = index as u8;
            }
        }

        threshold
    }

    fn normalize_text(raw: &str) -> String {
        raw.lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .collect::<Vec<_>>()
            .join("\n")
    }

    fn open_image_as_bitmap(
        path: &Path,
    ) -> windows::core::Result<windows::Graphics::Imaging::SoftwareBitmap> {
        let canonical = fs::canonicalize(path).map_err(|_| windows::core::Error::from_win32())?;
        let path_str = canonical.to_string_lossy().replace("\\\\?\\", "");

        let file = StorageFile::GetFileFromPathAsync(&HSTRING::from(path_str))?.get()?;
        let stream = file.OpenAsync(FileAccessMode::Read)?.get()?;
        let decoder = BitmapDecoder::CreateAsync(&stream)?.get()?;
        decoder.GetSoftwareBitmapAsync()?.get()
    }
}

#[tauri::command]
fn ocr_document(app: tauri::AppHandle, request: OcrRequest) -> Result<OcrResult, String> {
    #[cfg(target_os = "windows")]
    {
        ocr::ocr_document(&app, &request)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, request);
        Err("OCR is only supported on Windows".to_string())
    }
}

#[tauri::command]
fn get_pdf_page_count(app: tauri::AppHandle, path: String) -> Result<u16, String> {
    #[cfg(target_os = "windows")]
    {
        ocr::pdf_page_count(&app, &path)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, path);
        Err("OCR is only supported on Windows".to_string())
    }
}

#[tauri::command]
fn prepare_local_ocr(app: tauri::AppHandle) -> Result<LocalOcrStatus, String> {
    #[cfg(target_os = "windows")]
    {
        ocr::prepare_local_ocr(&app)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        Err("OCR is only supported on Windows".to_string())
    }
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
fn continue_doubao_ocr_session(
    state: tauri::State<doubao::DoubaoAutomationState>,
    session_id: String,
) -> Result<doubao::DoubaoOcrResponse, String> {
    doubao::continue_session(&state, &session_id)
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
            ocr_document,
            get_pdf_page_count,
            prepare_local_ocr,
            open_devtools,
            open_external_target,
            start_doubao_ocr_session,
            continue_doubao_ocr_session,
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
