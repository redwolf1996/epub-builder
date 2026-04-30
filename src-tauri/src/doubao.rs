#![allow(dead_code)]

use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    env,
    fs::{File, OpenOptions, create_dir_all, metadata},
    io::Write,
    path::Path,
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager};

const WINDOW_START_TIMEOUT: Duration = Duration::from_secs(20);
const FILE_PASTE_DELAY: Duration = Duration::from_millis(1800);
const FILE_PASTE_DELAY_PER_MB: Duration = Duration::from_millis(700);
const FILE_PASTE_DELAY_MAX: Duration = Duration::from_millis(12_000);
const PROMPT_PASTE_DELAY: Duration = Duration::from_millis(300);
const WINDOW_FOCUS_DELAY: Duration = Duration::from_millis(400);
const NEW_CHAT_DELAY: Duration = Duration::from_millis(700);
const SMALL_WINDOW_READY_DELAY: Duration = Duration::from_millis(900);
const CLIPBOARD_WATCH_INTERVAL: Duration = Duration::from_millis(900);
const CLIPBOARD_WATCH_TIMEOUT: Duration = Duration::from_secs(600);
const REPLY_POLL_INTERVAL: Duration = Duration::from_millis(1800);
const REPLY_READY_TIMEOUT: Duration = Duration::from_secs(600);
const SMALL_WINDOW_TOGGLE_ATTEMPTS: usize = 3;
const DOUBAO_EXE_RELATIVE_PATHS: [&str; 2] = [
    r"Doubao\Application\app\Doubao.exe",
    r"Doubao\Application\Doubao.exe",
];
const OCR_PROMPT: &str = "请返回所传文件的文本，不作其他说明";

const INPUT_X_RATIO: f64 = 0.5;
const INPUT_Y_OFFSET: i32 = 132;
const SMALL_WINDOW_INPUT_FALLBACK_POINTS: [(f64, f64); 4] = [
    (0.32, 0.90),
    (0.5, 0.90),
    (0.68, 0.90),
    (0.5, 0.84),
];
const MAIN_WINDOW_NEW_CHAT_FALLBACK_POINTS: [(f64, f64); 3] = [
    (0.19, 0.07),
    (0.168, 0.07),
    (0.205, 0.07),
];
const SMALL_WINDOW_NEW_CHAT_FALLBACK_POINTS: [(f64, f64); 4] = [
    (0.08, 0.09),
    (0.12, 0.09),
    (0.16, 0.09),
    (0.10, 0.14),
];
const SMALL_WINDOW_TOGGLE_DELAY: Duration = Duration::from_millis(650);
const SMALL_WINDOW_MIN_WIDTH: i32 = 240;
const SMALL_WINDOW_BOTTOM_CLEARANCE: i32 = 32;
const SMALL_WINDOW_REPOSITION_PADDING: i32 = 12;
const SMALL_WINDOW_LAYOUT_UNSAFE_ERROR: &str =
    "Doubao small window layout is unsafe for automatic input. Please reopen or resize the small window and try again.";
#[cfg(target_os = "windows")]
const INPUT_HINT_LABELS: [&str; 6] = ["输入", "提问", "发送", "message", "prompt", "chat"];
#[cfg(target_os = "windows")]
const NEW_CHAT_HINT_LABELS: [&str; 10] = [
    "新建",
    "新对话",
    "新聊天",
    "创建",
    "compose",
    "new",
    "edit",
    "write",
    "pencil",
    "chat",
];
const HEADER_NOISE_LINES: [&str; 4] = ["提取文字", "豆包", "内容由豆包 AI 生成，请仔细甄别", "内容由豆包ai生成，请仔细甄别"];
#[cfg(target_os = "windows")]
const REPLY_CLUSTER_GAP: i32 = 96;

#[derive(Default)]
pub struct DoubaoAutomationState {
    next_id: AtomicU64,
    sessions: Mutex<HashMap<String, DoubaoSession>>,
    clipboard_watch_id: Arc<AtomicU64>,
}

#[derive(Clone)]
struct DoubaoSession {
    session_id: String,
    provider: String,
    status: String,
    stage: String,
    message: Option<String>,
    result_text: Option<String>,
    clipboard_marker: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum DoubaoWindowMode {
    MainWindow,
    SmallWindow,
}

#[derive(Clone, Copy, Debug)]
struct DoubaoWindowTarget {
    hwnd: isize,
    mode: DoubaoWindowMode,
}

#[cfg(target_os = "windows")]
#[derive(Clone, Debug)]
struct WindowCandidate {
    hwnd: isize,
    title: String,
    rect: RECT,
    process_id: u32,
}

#[cfg(target_os = "windows")]
#[derive(Clone)]
struct VisibleTextNode {
    rect: RECT,
    text: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DoubaoClipboardImportedEvent {
    pub session_id: String,
    pub text: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DoubaoOcrRequest {
    pub provider: String,
    pub file_path: String,
    pub doubao_exe_path: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DoubaoOcrResponse {
    pub session_id: String,
    pub provider: String,
    pub status: String,
    pub stage: String,
    pub message: Option<String>,
    pub result_text: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DoubaoExecutableCheckRequest {
    pub doubao_exe_path: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DoubaoExecutableCheckResponse {
    pub resolved_path: String,
    pub source: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DoubaoRunningCheckResponse {
    pub running: bool,
}

impl DoubaoAutomationState {
    fn next_session_id(&self) -> String {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed) + 1;
        format!("doubao-session-{id}")
    }

    fn save(&self, session: DoubaoSession) -> Result<(), String> {
        self.sessions
            .lock()
            .map_err(|_| "Failed to lock AI OCR session store".to_string())?
            .insert(session.session_id.clone(), session);
        Ok(())
    }

    fn get(&self, session_id: &str) -> Result<DoubaoSession, String> {
        self.sessions
            .lock()
            .map_err(|_| "Failed to lock AI OCR session store".to_string())?
            .get(session_id)
            .cloned()
            .ok_or("AI OCR session not found".to_string())
    }
}

pub fn start_session(
    app: &AppHandle,
    state: &DoubaoAutomationState,
    request: &DoubaoOcrRequest,
) -> Result<DoubaoOcrResponse, String> {
    debug_log("========================================");
    if request.provider != "doubao" {
        return Err("Unsupported AI OCR provider".to_string());
    }

    if !Path::new(&request.file_path).exists() {
        return Err("Selected file does not exist".to_string());
    }

    debug_log(&format!("start_session file={}", request.file_path));

    let target = ensure_doubao_small_window(request.doubao_exe_path.as_deref())?;
    debug_capture_window_snapshot(target.hwnd, "target-detected");
    start_new_conversation(target)?;
    debug_capture_window_snapshot(target.hwnd, "after-new-conversation");
    submit_ocr_request(target, &request.file_path)?;
    debug_capture_window_snapshot(target.hwnd, "after-submit-request");

    let marker_seed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_nanos();
    let marker = format!("__doubao_manual_copy_marker_{marker_seed}__");
    replace_clipboard_text(&marker)?;

    let session_id = state.next_session_id();
    let session = DoubaoSession {
        session_id: session_id.clone(),
        provider: request.provider.clone(),
        status: "needsManual".to_string(),
        stage: "manualTakeover".to_string(),
        message: Some(
            "Doubao small window is ready. Wait for the reply, copy it in Doubao, and the app will minimize the small window and import the text automatically."
                .to_string(),
        ),
        result_text: None,
        clipboard_marker: Some(marker.clone()),
    };

    state.save(session.clone())?;
    start_manual_watch(
        app.clone(),
        state.clipboard_watch_id.clone(),
        session.session_id.clone(),
        marker.clone(),
        request.file_path.clone(),
        Some(target),
    );
    Ok(to_response(session))
}

pub fn cancel_session(
    state: &DoubaoAutomationState,
    session_id: &str,
) -> Result<DoubaoOcrResponse, String> {
    state.clipboard_watch_id.fetch_add(1, Ordering::Relaxed);
    let mut session = state.get(session_id)?;
    session.status = "cancelled".to_string();
    session.stage = "cancelled".to_string();
    session.message = Some("Doubao OCR cancelled".to_string());
    state.save(session.clone())?;
    Ok(to_response(session))
}

pub fn check_executable(
    request: &DoubaoExecutableCheckRequest,
) -> Result<DoubaoExecutableCheckResponse, String> {
    if let Some(requested_path) = resolve_requested_exe_path(request.doubao_exe_path.as_deref())? {
        return Ok(DoubaoExecutableCheckResponse {
            resolved_path: requested_path,
            source: "manual".to_string(),
        });
    }

    if let Some(auto_path) = available_exe_paths().into_iter().next() {
        return Ok(DoubaoExecutableCheckResponse {
            resolved_path: auto_path,
            source: "auto".to_string(),
        });
    }

    let local_app_data = env::var("LOCALAPPDATA")
        .unwrap_or_else(|_| "%LOCALAPPDATA%".to_string());
    Err(format!(
        "Doubao executable was not found automatically. Please install Doubao desktop or configure the executable path manually. Tried common paths under {}\\{} and {}\\{}",
        local_app_data,
        DOUBAO_EXE_RELATIVE_PATHS[0],
        local_app_data,
        DOUBAO_EXE_RELATIVE_PATHS[1]
    ))
}

pub fn check_running() -> DoubaoRunningCheckResponse {
    DoubaoRunningCheckResponse {
        running: find_doubao_window().is_some(),
    }
}

fn to_response(session: DoubaoSession) -> DoubaoOcrResponse {
    DoubaoOcrResponse {
        session_id: session.session_id,
        provider: session.provider,
        status: session.status,
        stage: session.stage,
        message: session.message,
        result_text: session.result_text,
    }
}

fn read_latest_response_text(marker: Option<&str>) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        if let Some(hwnd) = find_doubao_window() {
            if let Some(text) = extract_visible_reply_text(hwnd)? {
                return Ok(text);
            }
        }
    }

    read_manual_copied_response(marker)
}

fn read_manual_copied_response(marker: Option<&str>) -> Result<String, String> {
    let Some(text) = read_clipboard_text() else {
        return Err("Clipboard does not contain text yet".to_string());
    };
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err("Clipboard text is empty".to_string());
    }
    if marker.is_some_and(|value| trimmed == value) {
        return Err("Clipboard still contains the previous marker".to_string());
    }
    if !is_importable_ocr_text(trimmed) {
        return Err("Clipboard text does not look like OCR content yet".to_string());
    }
    Ok(trimmed.to_string())
}

fn start_manual_watch(
    app: AppHandle,
    watch_id: Arc<AtomicU64>,
    session_id: String,
    baseline: String,
    file_path: String,
    target: Option<DoubaoWindowTarget>,
) {
    let current_watch = watch_id.fetch_add(1, Ordering::Relaxed) + 1;

    start_clipboard_watch(
        app,
        watch_id,
        current_watch,
        session_id,
        baseline,
        file_path,
        target,
    );
}

fn start_clipboard_watch(
    app: AppHandle,
    watch_id: Arc<AtomicU64>,
    current_watch: u64,
    session_id: String,
    baseline: String,
    file_path: String,
    target: Option<DoubaoWindowTarget>,
) {
    thread::spawn(move || {
        let start = Instant::now();
        let baseline_trimmed = baseline.trim().to_string();
        let file_path_trimmed = file_path.trim().to_string();

        while start.elapsed() < CLIPBOARD_WATCH_TIMEOUT {
            if !watch_is_current(&watch_id, current_watch) {
                return;
            }

            if let Some(text) = read_clipboard_text() {
                let trimmed = text.trim();
                if !trimmed.is_empty()
                    && trimmed != baseline_trimmed
                    && trimmed != OCR_PROMPT
                    && trimmed != file_path_trimmed
                    && is_importable_ocr_text(trimmed)
                    && try_emit_result(&app, &watch_id, current_watch, &session_id, text, target)
                {
                    return;
                }
            }

            thread::sleep(CLIPBOARD_WATCH_INTERVAL);
        }
    });
}

fn submit_ocr_request(target: DoubaoWindowTarget, file_path: &str) -> Result<(), String> {
    debug_log(&format!(
        "submit_ocr_request hwnd={} mode={:?} file={}",
        target.hwnd, target.mode, file_path
    ));
    ensure_target_foreground(target.hwnd)?;
    click_input_box(target)?;
    thread::sleep(WINDOW_FOCUS_DELAY);

    ensure_target_foreground(target.hwnd)?;
    set_clipboard_file(file_path)?;
    debug_log("clipboard_file_staged");
    paste_shortcut()?;
    let file_paste_delay = file_paste_delay_for(file_path);
    debug_log(&format!(
        "file_paste_wait_ms={} file={}",
        file_paste_delay.as_millis(),
        file_path
    ));
    thread::sleep(file_paste_delay);
    debug_log("file_paste_sent");

    ensure_target_foreground(target.hwnd)?;
    let backup = replace_clipboard_text(OCR_PROMPT)?;
    debug_log("prompt_staged");
    paste_shortcut()?;
    thread::sleep(PROMPT_PASTE_DELAY);
    restore_clipboard_text(backup);
    debug_log("prompt_paste_sent");

    ensure_target_foreground(target.hwnd)?;
    press_enter()?;
    debug_log("enter_sent");
    Ok(())
}

fn file_paste_delay_for(file_path: &str) -> Duration {
    let Ok(file_metadata) = metadata(file_path) else {
        return FILE_PASTE_DELAY;
    };

    let bytes = file_metadata.len();
    let mega_bytes = bytes.div_ceil(1024 * 1024);
    let extra = duration_mul(FILE_PASTE_DELAY_PER_MB, mega_bytes.saturating_sub(1));
    let delay = FILE_PASTE_DELAY.saturating_add(extra);
    delay.min(FILE_PASTE_DELAY_MAX)
}

fn duration_mul(duration: Duration, times: u64) -> Duration {
    let millis = duration.as_millis();
    let total = millis.saturating_mul(u128::from(times));
    let capped = total.min(u128::from(u64::MAX));
    Duration::from_millis(capped as u64)
}

fn watch_is_current(watch_id: &AtomicU64, current_watch: u64) -> bool {
    watch_id.load(Ordering::Relaxed) == current_watch
}

fn try_emit_result(
    app: &AppHandle,
    watch_id: &AtomicU64,
    current_watch: u64,
    session_id: &str,
    text: String,
    target: Option<DoubaoWindowTarget>,
) -> bool {
    if watch_id
        .compare_exchange(
            current_watch,
            current_watch + 1,
            Ordering::SeqCst,
            Ordering::SeqCst,
        )
        .is_err()
    {
        return false;
    }

    debug_log(&format!(
        "emit_result session={session_id} chars={} preview={}",
        text.chars().count(),
        preview_text(&text, 160)
    ));

    if let Some(target) = target {
        maybe_minimize_small_window(target);
    }

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
    let _ = app.emit(
        "ai-ocr-clipboard-imported",
        DoubaoClipboardImportedEvent {
            session_id: session_id.to_string(),
            text,
        },
    );
    true
}

#[cfg(target_os = "windows")]
fn start_new_conversation(target: DoubaoWindowTarget) -> Result<(), String> {
    debug_log(&format!(
        "start_new_conversation hwnd={} mode={:?}",
        target.hwnd, target.mode
    ));
    focus_doubao_window(target.hwnd);
    let session = AutomationSession::new(target.hwnd)?;
    if let Some(button) = session.find_new_chat_target()? {
        let rect = unsafe { button.CurrentBoundingRectangle() }.map_err(|error| {
            format!("Failed to inspect Doubao new conversation button: {error}")
        })?;
        debug_log(&format!(
            "new_chat_click rect=({}, {}, {}, {})",
            rect.left, rect.top, rect.right, rect.bottom
        ));
        click_rect_center_in_window(target.hwnd, rect)?;
    } else {
        debug_log("new_chat_uia_not_found_fallback");
        click_new_chat_fallback(session.window_rect, target.hwnd, target.mode)?;
    }
    thread::sleep(NEW_CHAT_DELAY);
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn start_new_conversation(_target: DoubaoWindowTarget) -> Result<(), String> {
    Err("Doubao desktop automation is only supported on Windows".to_string())
}

#[cfg(target_os = "windows")]
fn click_new_chat_fallback(
    window_rect: RECT,
    hwnd: isize,
    mode: DoubaoWindowMode,
) -> Result<(), String> {
    let width = window_rect.right - window_rect.left;
    let height = window_rect.bottom - window_rect.top;
    let fallback_points = match mode {
        DoubaoWindowMode::MainWindow => MAIN_WINDOW_NEW_CHAT_FALLBACK_POINTS.as_slice(),
        DoubaoWindowMode::SmallWindow => SMALL_WINDOW_NEW_CHAT_FALLBACK_POINTS.as_slice(),
    };

    let mut last_error: Option<String> = None;
    for (x_ratio, y_ratio) in fallback_points {
        let x = window_rect.left + (width as f64 * x_ratio) as i32;
        let y = window_rect.top + (height as f64 * y_ratio) as i32;
        debug_log(&format!("new_chat_fallback_click x={} y={} mode={:?}", x, y, mode));
        if let Err(error) = click_point_in_window(hwnd, window_rect, x, y) {
            last_error = Some(error);
            continue;
        }
        thread::sleep(Duration::from_millis(250));
        return Ok(());
    }

    Err(last_error.unwrap_or("Failed to click the Doubao new conversation fallback point".to_string()))
}

#[cfg(target_os = "windows")]
fn wait_for_latest_reply_text(
    hwnd: isize,
    watch_id: &AtomicU64,
    current_watch: u64,
) -> Result<String, String> {
    let start = Instant::now();
    let mut last_text = String::new();
    let mut stable_hits = 0;

    while start.elapsed() < REPLY_READY_TIMEOUT {
        if !watch_is_current(watch_id, current_watch) {
            debug_log("reply_watch superseded");
            return Err("AI OCR session was superseded".to_string());
        }

        if let Some(text) = extract_visible_reply_text(hwnd)? {
            debug_log(&format!(
                "reply_watch candidate chars={} preview={}",
                text.chars().count(),
                preview_text(&text, 160)
            ));
            if text == last_text {
                stable_hits += 1;
            } else {
                last_text = text.clone();
                stable_hits = 1;
            }

            if stable_hits >= 2 {
                debug_log("reply_watch stable candidate accepted");
                return Ok(text);
            }
        }

        thread::sleep(REPLY_POLL_INTERVAL);
    }

    if last_text.chars().count() >= 16 {
        debug_log("reply_watch timeout fallback accepted");
        return Ok(last_text);
    }

    debug_log("reply_watch timed out without valid candidate");
    Err("Timed out while waiting for the latest Doubao reply".to_string())
}

#[cfg(not(target_os = "windows"))]
fn wait_for_latest_reply_text(
    _hwnd: isize,
    _watch_id: &AtomicU64,
    _current_watch: u64,
) -> Result<String, String> {
    Err("Doubao desktop automation is only supported on Windows".to_string())
}

#[cfg(target_os = "windows")]
fn extract_visible_reply_text(hwnd: isize) -> Result<Option<String>, String> {
    let session = AutomationSession::new(hwnd)?;
    let candidates = session.reply_text_candidates()?;
    debug_log_reply_candidates(&candidates);
    Ok(candidates
        .into_iter()
        .max_by(|left, right| left.0.cmp(&right.0))
        .map(|(_, rect, text)| {
            debug_log(&format!(
                "reply_pick rect=({}, {}, {}, {}) chars={} preview={}",
                rect.left,
                rect.top,
                rect.right,
                rect.bottom,
                text.chars().count(),
                preview_text(&text, 160)
            ));
            text
        }))
}

#[cfg(not(target_os = "windows"))]
fn extract_visible_reply_text(_hwnd: isize) -> Result<Option<String>, String> {
    Err("Doubao desktop automation is only supported on Windows".to_string())
}

fn sanitize_reply_text(raw: &str) -> String {
    let normalized = raw.replace("\r\n", "\n").replace('\r', "\n");
    let mut blocks: Vec<Vec<String>> = Vec::new();
    let mut current: Vec<String> = Vec::new();

    for line in normalized.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || should_skip_reply_line(trimmed) {
            if !current.is_empty() {
                blocks.push(current);
                current = Vec::new();
            }
            continue;
        }

        current.push(trimmed.to_string());
    }

    if !current.is_empty() {
        blocks.push(current);
    }

    blocks
        .into_iter()
        .max_by(|left, right| {
            left.join("\n")
                .chars()
                .count()
                .cmp(&right.join("\n").chars().count())
                .then(left.len().cmp(&right.len()))
        })
        .map(|lines| lines.join("\n").trim().to_string())
        .unwrap_or_default()
}

fn should_skip_reply_line(line: &str) -> bool {
    let compact = line.to_lowercase();
    if compact == OCR_PROMPT {
        return true;
    }
    if HEADER_NOISE_LINES
        .iter()
        .any(|value| compact == value.to_lowercase())
    {
        return true;
    }
    if compact.contains(&OCR_PROMPT.to_lowercase()) {
        return true;
    }
    if compact.contains("doubao small window is ready")
        || compact.contains("main window fallback flow")
        || compact.contains("copy it in doubao")
        || compact.contains("import the text automatically")
    {
        return true;
    }
    if compact == "复制" || compact == "继续导入" {
        return true;
    }
    line.ends_with('→')
}

fn is_importable_ocr_text(text: &str) -> bool {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return false;
    }
    if looks_like_local_path(trimmed) {
        return false;
    }
    if trimmed.eq_ignore_ascii_case("copy") || trimmed == "复制" || trimmed == "继续导入" {
        return false;
    }
    let lowered = trimmed.to_lowercase();
    if lowered.contains("doubao small window is ready")
        || lowered.contains("main window fallback flow")
        || lowered.contains("copy it in doubao")
        || lowered.contains("import the text automatically")
    {
        return false;
    }

    let char_count = trimmed.chars().count();
    let line_count = trimmed.lines().filter(|line| !line.trim().is_empty()).count();
    if line_count >= 2 {
        return true;
    }

    char_count >= 20
}

fn looks_like_local_path(text: &str) -> bool {
    let trimmed = text.trim();
    if trimmed.contains('\n') || trimmed.contains('\r') {
        return false;
    }

    let normalized = trimmed.replace('/', "\\");
    let has_drive_prefix = normalized
        .chars()
        .nth(1)
        .is_some_and(|value| value == ':')
        && normalized.contains('\\');
    let has_known_suffix = [
        ".log", ".txt", ".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff", ".pdf", ".md",
    ]
    .iter()
    .any(|suffix| normalized.to_lowercase().ends_with(suffix));

    has_drive_prefix && has_known_suffix
}

fn preview_text(text: &str, max_chars: usize) -> String {
    let compact = text.replace("\r\n", "\n").replace('\r', "\n").replace('\n', "\\n");
    let preview: String = compact.chars().take(max_chars).collect();
    if compact.chars().count() > max_chars {
        format!("{preview}...")
    } else {
        preview
    }
}

fn debug_log(message: &str) {
    let log_dir = std::env::temp_dir().join("epub-builder");
    let _ = create_dir_all(&log_dir);
    let log_path = log_dir.join("doubao-ocr.log");
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(log_path) {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|value| value.as_millis())
            .unwrap_or_default();
        let _ = writeln!(file, "[{timestamp}] {message}");
    }
}

#[cfg(target_os = "windows")]
fn debug_capture_window_snapshot(hwnd: isize, label: &str) {
    let hwnd = HWND(hwnd as *mut core::ffi::c_void);
    let Some(rect) = window_rect(hwnd) else {
        debug_log(&format!("snapshot_skip label={label} reason=no-window-rect"));
        return;
    };

    let width = rect.right - rect.left;
    let height = rect.bottom - rect.top;
    if width <= 0 || height <= 0 {
        debug_log(&format!(
            "snapshot_skip label={label} reason=invalid-size width={} height={}",
            width, height
        ));
        return;
    }

    let Some(buffer) = capture_screen_rect_bgra(rect, width, height) else {
        debug_log(&format!("snapshot_skip label={label} reason=capture-failed"));
        return;
    };

    let captures_dir = std::env::temp_dir().join("epub-builder").join("captures");
    let _ = create_dir_all(&captures_dir);
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis())
        .unwrap_or_default();
    let safe_label = label
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>();
    let path = captures_dir.join(format!("{timestamp}-{safe_label}.bmp"));

    match write_bmp_file(&path, width, height, &buffer) {
        Ok(()) => debug_log(&format!(
            "snapshot_saved label={label} path={} rect=({}, {}, {}, {}) size={}x{}",
            path.display(),
            rect.left,
            rect.top,
            rect.right,
            rect.bottom,
            width,
            height
        )),
        Err(error) => debug_log(&format!("snapshot_skip label={label} reason={error}")),
    }
}

#[cfg(not(target_os = "windows"))]
fn debug_capture_window_snapshot(_hwnd: isize, _label: &str) {}

#[cfg(target_os = "windows")]
fn capture_screen_rect_bgra(rect: RECT, width: i32, height: i32) -> Option<Vec<u8>> {
    unsafe {
        let screen_dc = GetDC(None);
        if screen_dc.0.is_null() {
            return None;
        }

        let memory_dc = CreateCompatibleDC(Some(screen_dc));
        if memory_dc.0.is_null() {
            let _ = ReleaseDC(None, screen_dc);
            return None;
        }

        let bitmap = CreateCompatibleBitmap(screen_dc, width, height);
        if bitmap.0.is_null() {
            let _ = DeleteDC(memory_dc);
            let _ = ReleaseDC(None, screen_dc);
            return None;
        }

        let old = SelectObject(memory_dc, HGDIOBJ(bitmap.0));
        let blit_ok = BitBlt(
            memory_dc,
            0,
            0,
            width,
            height,
            Some(screen_dc),
            rect.left,
            rect.top,
            SRCCOPY,
        )
        .is_ok();

        let mut bmi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: width,
                biHeight: -height,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut buffer = vec![0u8; (width * height * 4) as usize];
        let rows = if blit_ok {
            GetDIBits(
                memory_dc,
                bitmap,
                0,
                height as u32,
                Some(buffer.as_mut_ptr() as *mut core::ffi::c_void),
                &mut bmi,
                DIB_RGB_COLORS,
            )
        } else {
            0
        };

        let _ = SelectObject(memory_dc, old);
        let _ = DeleteObject(HGDIOBJ(bitmap.0));
        let _ = DeleteDC(memory_dc);
        let _ = ReleaseDC(None, screen_dc);

        if rows == 0 {
            None
        } else {
            Some(buffer)
        }
    }
}

#[cfg(target_os = "windows")]
fn write_bmp_file(path: &Path, width: i32, height: i32, buffer: &[u8]) -> Result<(), String> {
    let mut file = File::create(path).map_err(|error| error.to_string())?;
    let file_header_size = 14u32;
    let info_header_size = 40u32;
    let pixel_bytes = buffer.len() as u32;
    let file_size = file_header_size + info_header_size + pixel_bytes;

    file.write_all(b"BM").map_err(|error| error.to_string())?;
    file.write_all(&file_size.to_le_bytes())
        .map_err(|error| error.to_string())?;
    file.write_all(&0u16.to_le_bytes())
        .map_err(|error| error.to_string())?;
    file.write_all(&0u16.to_le_bytes())
        .map_err(|error| error.to_string())?;
    file.write_all(&(file_header_size + info_header_size).to_le_bytes())
        .map_err(|error| error.to_string())?;

    file.write_all(&info_header_size.to_le_bytes())
        .map_err(|error| error.to_string())?;
    file.write_all(&width.to_le_bytes())
        .map_err(|error| error.to_string())?;
    file.write_all(&(-height).to_le_bytes())
        .map_err(|error| error.to_string())?;
    file.write_all(&1u16.to_le_bytes())
        .map_err(|error| error.to_string())?;
    file.write_all(&32u16.to_le_bytes())
        .map_err(|error| error.to_string())?;
    file.write_all(&0u32.to_le_bytes())
        .map_err(|error| error.to_string())?;
    file.write_all(&pixel_bytes.to_le_bytes())
        .map_err(|error| error.to_string())?;
    file.write_all(&0u32.to_le_bytes())
        .map_err(|error| error.to_string())?;
    file.write_all(&0u32.to_le_bytes())
        .map_err(|error| error.to_string())?;
    file.write_all(&0u32.to_le_bytes())
        .map_err(|error| error.to_string())?;
    file.write_all(&0u32.to_le_bytes())
        .map_err(|error| error.to_string())?;
    file.write_all(buffer).map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(target_os = "windows")]
fn debug_log_reply_candidates(candidates: &[(usize, RECT, String)]) {
    if candidates.is_empty() {
        debug_log("reply_candidates none");
        return;
    }

    debug_log(&format!("reply_candidates count={}", candidates.len()));
    for (index, (chars, rect, text)) in candidates.iter().take(8).enumerate() {
        debug_log(&format!(
            "reply_candidate[{index}] rect=({}, {}, {}, {}) chars={} preview={}",
            rect.left,
            rect.top,
            rect.right,
            rect.bottom,
            chars,
            preview_text(text, 160)
        ));
    }
}

#[cfg(target_os = "windows")]
fn debug_log_visible_nodes(nodes: &[VisibleTextNode]) {
    if nodes.is_empty() {
        debug_log("visible_nodes none");
        return;
    }

    debug_log(&format!("visible_nodes count={}", nodes.len()));
    for (index, node) in nodes.iter().take(16).enumerate() {
        debug_log(&format!(
            "visible_node[{index}] rect=({}, {}, {}, {}) chars={} preview={}",
            node.rect.left,
            node.rect.top,
            node.rect.right,
            node.rect.bottom,
            node.text.chars().count(),
            preview_text(&node.text, 120)
        ));
    }
}

fn set_clipboard_file(file_path: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        set_windows_clipboard_file(file_path)
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = file_path;
        Err("Doubao desktop automation is only supported on Windows".to_string())
    }
}

struct ClipboardBackup {
    text: Option<String>,
}

fn replace_clipboard_text(text: &str) -> Result<ClipboardBackup, String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|error| error.to_string())?;
    let backup = clipboard.get_text().ok();
    clipboard
        .set_text(text.to_string())
        .map_err(|error| error.to_string())?;
    Ok(ClipboardBackup { text: backup })
}

fn restore_clipboard_text(backup: ClipboardBackup) {
    if let Some(text) = backup.text {
        if let Ok(mut clipboard) = arboard::Clipboard::new() {
            let _ = clipboard.set_text(text);
        }
    }
}

fn read_clipboard_text() -> Option<String> {
    let mut clipboard = arboard::Clipboard::new().ok()?;
    clipboard.get_text().ok()
}

#[cfg(target_os = "windows")]
fn set_windows_clipboard_file(file_path: &str) -> Result<(), String> {
    let mut wide_path: Vec<u16> = file_path.encode_utf16().collect();
    wide_path.push(0);
    wide_path.push(0);

    let dropfiles_size = std::mem::size_of::<DROPFILES>();
    let payload_size = wide_path.len() * std::mem::size_of::<u16>();
    let total_size = dropfiles_size + payload_size;

    unsafe {
        let handle = GlobalAlloc(GMEM_MOVEABLE, total_size)
            .map_err(|error| format!("Failed to allocate file clipboard buffer: {error}"))?;

        let locked = GlobalLock(handle) as *mut u8;
        if locked.is_null() {
            let _ = GlobalFree(Some(handle));
            return Err("Failed to lock file clipboard buffer".to_string());
        }

        let dropfiles = locked as *mut DROPFILES;
        (*dropfiles).pFiles = dropfiles_size as u32;
        (*dropfiles).pt.x = 0;
        (*dropfiles).pt.y = 0;
        (*dropfiles).fNC = false.into();
        (*dropfiles).fWide = true.into();

        std::ptr::copy_nonoverlapping(
            wide_path.as_ptr() as *const u8,
            locked.add(dropfiles_size),
            payload_size,
        );
        let _ = GlobalUnlock(handle);

        OpenClipboard(None).map_err(|error| {
            let _ = GlobalFree(Some(handle));
            format!("Failed to open the clipboard: {error}")
        })?;

        let result = (|| -> Result<(), String> {
            EmptyClipboard().map_err(|error| format!("Failed to clear the clipboard: {error}"))?;
            SetClipboardData(CF_HDROP.0 as u32, Some(HANDLE(handle.0)))
                .map_err(|error| format!("Failed to set the file clipboard data: {error}"))?;
            Ok(())
        })();

        let _ = CloseClipboard();
        if result.is_err() {
            let _ = GlobalFree(Some(handle));
        }

        result
    }
}

fn resolve_requested_exe_path(requested_path: Option<&str>) -> Result<Option<String>, String> {
    let Some(path) = requested_path.map(str::trim).filter(|path| !path.is_empty()) else {
        return Ok(None);
    };

    let candidate = Path::new(path);
    if !candidate.exists() {
        return Err("Configured Doubao executable path does not exist".to_string());
    }

    Ok(Some(path.to_string()))
}

fn available_exe_paths() -> Vec<String> {
    let mut paths = Vec::new();

    if let Ok(local_app_data) = env::var("LOCALAPPDATA") {
        for relative_path in DOUBAO_EXE_RELATIVE_PATHS {
            let candidate = Path::new(&local_app_data).join(relative_path);
            if candidate.exists() {
                paths.push(candidate.to_string_lossy().into_owned());
            }
        }
    }

    paths
}

fn manual_launch_required_error() -> String {
    "Doubao desktop must already be running for AI OCR. Please launch Doubao desktop manually and try again.".to_string()
}

#[cfg(target_os = "windows")]
fn ensure_doubao_small_window(_requested_exe_path: Option<&str>) -> Result<DoubaoWindowTarget, String> {
    debug_log("ensure_doubao_small_window begin");
    if let Some(hwnd) = find_existing_doubao_small_window() {
        debug_log(&format!("existing_small_window hwnd={hwnd}"));
        return Ok(DoubaoWindowTarget {
            hwnd,
            mode: DoubaoWindowMode::SmallWindow,
        });
    }

    let main_hwnd = match find_doubao_window() {
        Some(hwnd) => hwnd,
        None => return Err(manual_launch_required_error()),
    };
    debug_log(&format!("main_hwnd_for_small_window={main_hwnd}"));
    let known_process_id = window_process_id(HWND(main_hwnd as *mut core::ffi::c_void));

    for attempt in 0..SMALL_WINDOW_TOGGLE_ATTEMPTS {
        let baseline_hwnds = collect_doubao_window_hwnds();
        debug_log(&format!(
            "baseline_hwnds_attempt_{}={:?}",
            attempt + 1,
            baseline_hwnds
        ));
        debug_log(&format!("small_window_activation attempt={} strategy=background_first", attempt + 1));
        if try_activate_small_window(main_hwnd, &baseline_hwnds, known_process_id, false)?.is_some() {
            return activate_detected_small_window(main_hwnd, &baseline_hwnds, known_process_id);
        }

        debug_log(&format!("small_window_activation attempt={} strategy=foreground_fallback", attempt + 1));
        if try_activate_small_window(main_hwnd, &baseline_hwnds, known_process_id, true)?.is_some() {
            return activate_detected_small_window(main_hwnd, &baseline_hwnds, known_process_id);
        }
    }

    Err("Doubao small window did not appear in time".to_string())
}

#[cfg(not(target_os = "windows"))]
fn ensure_doubao_small_window(_requested_exe_path: Option<&str>) -> Result<DoubaoWindowTarget, String> {
    Err("Doubao desktop automation is only supported on Windows".to_string())
}

#[cfg(target_os = "windows")]
fn toggle_small_window() -> Result<(), String> {
    debug_log("toggle_small_window alt+space");
    press_alt_space()?;
    thread::sleep(SMALL_WINDOW_TOGGLE_DELAY);
    Ok(())
}

#[cfg(target_os = "windows")]
fn maybe_minimize_small_window(target: DoubaoWindowTarget) {
    if target.mode != DoubaoWindowMode::SmallWindow {
        return;
    }

    let _ = focus_window_without_restore(target.hwnd);
    let _ = toggle_small_window();
}

#[cfg(not(target_os = "windows"))]
fn maybe_minimize_small_window(_target: DoubaoWindowTarget) {}

#[cfg(target_os = "windows")]
fn activate_detected_small_window(
    main_hwnd: isize,
    baseline_hwnds: &[isize],
    known_process_id: Option<u32>,
) -> Result<DoubaoWindowTarget, String> {
    let hwnd = find_recent_doubao_small_window(baseline_hwnds, known_process_id)
        .or_else(|| find_doubao_small_window(main_hwnd))
        .ok_or_else(|| "Doubao small window did not appear in time".to_string())?;

    debug_log(&format!("small_window_detected hwnd={hwnd}"));
    let target = DoubaoWindowTarget {
        hwnd,
        mode: DoubaoWindowMode::SmallWindow,
    };
    validate_small_window_geometry(hwnd)?;
    wait_for_small_window_ready(target)?;
    Ok(target)
}

#[cfg(target_os = "windows")]
fn try_activate_small_window(
    main_hwnd: isize,
    baseline_hwnds: &[isize],
    known_process_id: Option<u32>,
    restore_main_window: bool,
) -> Result<Option<isize>, String> {
    if restore_main_window {
        focus_doubao_window(main_hwnd);
    } else if let Err(error) = focus_window_without_restore(main_hwnd) {
        debug_log(&format!("background_first_focus_failed error={error}"));
    }

    toggle_small_window()?;
    wait_for_detected_small_window(main_hwnd, baseline_hwnds, known_process_id)
}

#[cfg(target_os = "windows")]
fn wait_for_detected_small_window(
    main_hwnd: isize,
    baseline_hwnds: &[isize],
    known_process_id: Option<u32>,
) -> Result<Option<isize>, String> {
    let start = Instant::now();

    while start.elapsed() < WINDOW_START_TIMEOUT {
        if let Some(hwnd) = find_recent_doubao_small_window(baseline_hwnds, known_process_id) {
            debug_log(&format!("recent_small_window hwnd={hwnd}"));
            return Ok(Some(hwnd));
        }
        if let Some(hwnd) = find_doubao_small_window(main_hwnd) {
            debug_log(&format!("derived_small_window hwnd={hwnd}"));
            return Ok(Some(hwnd));
        }

        thread::sleep(Duration::from_millis(250));
    }

    Ok(None)
}

#[cfg(target_os = "windows")]
fn wait_for_small_window_ready(target: DoubaoWindowTarget) -> Result<(), String> {
    let start = Instant::now();

    while start.elapsed() < WINDOW_START_TIMEOUT {
        if validate_small_window_geometry(target.hwnd).is_ok()
            && ensure_target_foreground(target.hwnd).is_ok()
            && click_input_box(target).is_ok()
        {
            thread::sleep(SMALL_WINDOW_READY_DELAY);
            ensure_target_foreground(target.hwnd)?;
            debug_log(&format!("small_window_ready hwnd={}", target.hwnd));
            return Ok(());
        }

        thread::sleep(Duration::from_millis(250));
    }

    Err("Doubao small window did not become ready for input in time".to_string())
}

#[cfg(not(target_os = "windows"))]
fn wait_for_small_window_ready(_target: DoubaoWindowTarget) -> Result<(), String> {
    Err("Doubao desktop automation is only supported on Windows".to_string())
}

#[cfg(target_os = "windows")]
use windows::{
    core::BOOL,
    Win32::{
        Foundation::{HWND, LPARAM, POINT, RECT, RPC_E_CHANGED_MODE},
        Graphics::Gdi::ClientToScreen,
        System::Com::{
            CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
            COINIT_APARTMENTTHREADED,
        },
        UI::{
            Accessibility::{
                CUIAutomation, IUIAutomation, IUIAutomationElement, IUIAutomationElementArray,
                IUIAutomationTextPattern, TreeScope_Descendants, UIA_ButtonControlTypeId,
                UIA_DocumentControlTypeId, UIA_EditControlTypeId, UIA_GroupControlTypeId,
                UIA_HyperlinkControlTypeId, UIA_ListItemControlTypeId, UIA_PaneControlTypeId,
                UIA_TextControlTypeId, UIA_TextPatternId,
            },
            Shell::DROPFILES,
            Input::KeyboardAndMouse::{
                SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, INPUT_MOUSE, KEYBDINPUT,
                KEYEVENTF_KEYUP, MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP, MOUSEINPUT,
                VIRTUAL_KEY, VK_CONTROL, VK_MENU, VK_SPACE,
            },
            WindowsAndMessaging::{
                EnumWindows, GetClientRect, GetCursorPos, GetForegroundWindow, GetWindowRect,
                GetSystemMetrics, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId,
                IsIconic, IsWindowVisible, SetCursorPos, SetForegroundWindow, SetWindowPos,
                ShowWindow, SM_CYSCREEN, SW_RESTORE, SWP_NOSIZE, SWP_NOZORDER,
            },
        },
    },
};

#[cfg(target_os = "windows")]
use windows::Win32::{
    Foundation::{GlobalFree, HANDLE},
    System::{
        DataExchange::{CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData},
        Memory::{GMEM_MOVEABLE, GlobalAlloc, GlobalLock, GlobalUnlock},
        Ole::CF_HDROP,
    },
};

#[cfg(target_os = "windows")]
use windows::Win32::Graphics::Gdi::{
    BI_RGB, BITMAPINFO, BITMAPINFOHEADER, BitBlt, CreateCompatibleBitmap, CreateCompatibleDC,
    DIB_RGB_COLORS, DeleteDC, DeleteObject, GetDC, GetDIBits, HGDIOBJ, ReleaseDC, SRCCOPY,
    SelectObject,
};

#[cfg(target_os = "windows")]
struct ComApartment {
    initialized: bool,
}

#[cfg(target_os = "windows")]
impl ComApartment {
    fn new() -> Result<Self, String> {
        let result = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
        if result.is_ok() {
            return Ok(Self { initialized: true });
        }

        if result == RPC_E_CHANGED_MODE {
            return Ok(Self { initialized: false });
        }

        Err(format!("CoInitializeEx failed: {result:?}"))
    }
}

#[cfg(target_os = "windows")]
impl Drop for ComApartment {
    fn drop(&mut self) {
        if self.initialized {
            unsafe { CoUninitialize() }
        }
    }
}

#[cfg(target_os = "windows")]
struct AutomationSession {
    _com: ComApartment,
    automation: IUIAutomation,
    root: IUIAutomationElement,
    window_rect: RECT,
}

#[cfg(target_os = "windows")]
impl AutomationSession {
    fn new(hwnd: isize) -> Result<Self, String> {
        let com = ComApartment::new()?;
        let hwnd = HWND(hwnd as *mut core::ffi::c_void);
        let automation: IUIAutomation =
            unsafe { CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER) }
                .map_err(|error| format!("Failed to create UI Automation client: {error}"))?;
        let root = unsafe { automation.ElementFromHandle(hwnd) }
            .map_err(|error| format!("Failed to attach UI Automation to Doubao window: {error}"))?;
        let window_rect = client_rect_screen(hwnd)?;

        Ok(Self {
            _com: com,
            automation,
            root,
            window_rect,
        })
    }

    fn descendants(&self) -> Result<Vec<IUIAutomationElement>, String> {
        let condition = unsafe { self.automation.CreateTrueCondition() }
            .map_err(|error| format!("Failed to create UI Automation condition: {error}"))?;
        let elements = unsafe { self.root.FindAll(TreeScope_Descendants, &condition) }
            .map_err(|error| format!("Failed to enumerate Doubao controls: {error}"))?;
        element_array_to_vec(elements)
    }

    fn find_input_target(&self) -> Result<Option<IUIAutomationElement>, String> {
        let mut best: Option<(i32, i32, i32, IUIAutomationElement)> = None;
        let window_height = self.window_rect.bottom - self.window_rect.top;
        let window_width = self.window_rect.right - self.window_rect.left;
        let mut inspected = 0;

        for element in self.descendants()? {
            let control_type =
                unsafe { element.CurrentControlType() }.map_err(|error| error.to_string())?;
            if !matches!(
                control_type,
                value if value == UIA_EditControlTypeId
                    || value == UIA_DocumentControlTypeId
                    || value == UIA_TextControlTypeId
            ) {
                continue;
            }

            let rect = match element_rect_if_visible(&element, self.window_rect) {
                Some(rect) => rect,
                None => continue,
            };
            let width = rect.right - rect.left;
            if width < window_width / 3 {
                continue;
            }
            if rect.bottom < self.window_rect.top + (window_height * 3 / 5) {
                continue;
            }

            let blob = element_text_blob(&element);
            let name_bonus = if contains_any_label(&blob, &INPUT_HINT_LABELS) {
                2000
            } else {
                0
            };
            let score = rect.bottom + name_bonus;
            if inspected < 24 {
                debug_log(&format!(
                    "input_candidate rect=({}, {}, {}, {}) width={} score={} blob={}",
                    rect.left,
                    rect.top,
                    rect.right,
                    rect.bottom,
                    width,
                    score,
                    preview_text(&blob, 160)
                ));
                inspected += 1;
            }
            let candidate = (score, width, rect.top, element);

            if best
                .as_ref()
                .is_none_or(|current| compare_input_candidate(&candidate, current).is_gt())
            {
                best = Some(candidate);
            }
        }

        debug_log(&format!("input_target_found={}", best.is_some()));
        Ok(best.map(|(_, _, _, element)| element))
    }

    fn find_new_chat_target(&self) -> Result<Option<IUIAutomationElement>, String> {
        let mut candidates: Vec<(i32, i32, IUIAutomationElement)> = Vec::new();
        let window_width = self.window_rect.right - self.window_rect.left;
        let window_height = self.window_rect.bottom - self.window_rect.top;
        let left_bound = self.window_rect.left;
        let right_bound = self.window_rect.left + (window_width / 2);
        let top_bound = self.window_rect.top + (window_height / 6);
        let mut inspected = 0;

        for element in self.descendants()? {
            let control_type =
                unsafe { element.CurrentControlType() }.map_err(|error| error.to_string())?;
            if !matches!(
                control_type,
                value if value == UIA_ButtonControlTypeId
                    || value == UIA_HyperlinkControlTypeId
                    || value == UIA_GroupControlTypeId
            ) {
                continue;
            }

            let rect = match element_rect_if_visible(&element, self.window_rect) {
                Some(rect) => rect,
                None => continue,
            };
            if rect.top > top_bound || rect.left < left_bound || rect.left > right_bound {
                continue;
            }

            let width = rect.right - rect.left;
            let height = rect.bottom - rect.top;
            if width < 16 || height < 16 || width > 160 || height > 96 {
                continue;
            }

            let blob = element_text_blob(&element);
            let label_bonus = if contains_any_label(&blob, &NEW_CHAT_HINT_LABELS) {
                10_000
            } else {
                0
            };
            let score = label_bonus - rect.left;
            if inspected < 24 {
                debug_log(&format!(
                    "new_chat_candidate rect=({}, {}, {}, {}) width={} height={} score={} blob={}",
                    rect.left,
                    rect.top,
                    rect.right,
                    rect.bottom,
                    width,
                    height,
                    score,
                    preview_text(&blob, 160)
                ));
                inspected += 1;
            }
            candidates.push((score, rect.left, element));
        }

        candidates.sort_by(|left, right| left.0.cmp(&right.0).then(left.1.cmp(&right.1)));
        debug_log(&format!("new_chat_target_found={}", !candidates.is_empty()));
        Ok(candidates.pop().map(|(_, _, element)| element))
    }

    fn reply_text_candidates(&self) -> Result<Vec<(usize, RECT, String)>, String> {
        let mut result = Vec::new();
        let window_width = self.window_rect.right - self.window_rect.left;
        let window_height = self.window_rect.bottom - self.window_rect.top;
        let right_pane_left = self.window_rect.left + (window_width / 4);
        let lower_bound = self.window_rect.bottom - (window_height / 5);

        for element in self.descendants()? {
            let control_type =
                unsafe { element.CurrentControlType() }.map_err(|error| error.to_string())?;
            if !matches!(
                control_type,
                value if value == UIA_DocumentControlTypeId
                    || value == UIA_TextControlTypeId
                    || value == UIA_GroupControlTypeId
                    || value == UIA_ListItemControlTypeId
                    || value == UIA_PaneControlTypeId
            ) {
                continue;
            }

            let rect = match element_rect_if_visible(&element, self.window_rect) {
                Some(rect) => rect,
                None => continue,
            };
            if rect.left < right_pane_left || rect.top > lower_bound {
                continue;
            }

            let raw = element_full_text(&element);
            let text = sanitize_reply_text(&raw);
            if text.len() < 8 {
                continue;
            }

            result.push((text.chars().count(), rect, text));
        }

        result.sort_by(|left, right| {
            left.0
                .cmp(&right.0)
                .then((left.1.right - left.1.left).cmp(&(right.1.right - right.1.left)))
        });

        if let Some(clustered) =
            build_reply_candidate_from_nodes(self.visible_text_nodes(right_pane_left, lower_bound)?)
        {
            result.push(clustered);
        }

        Ok(result)
    }

    fn visible_text_nodes(
        &self,
        right_pane_left: i32,
        lower_bound: i32,
    ) -> Result<Vec<VisibleTextNode>, String> {
        let mut result = Vec::new();

        for element in self.descendants()? {
            let rect = match element_rect_if_visible(&element, self.window_rect) {
                Some(rect) => rect,
                None => continue,
            };
            if rect.left < right_pane_left || rect.top > lower_bound {
                continue;
            }

            let text = sanitize_reply_text(&element_full_text(&element));
            if text.len() < 2 || text == OCR_PROMPT || should_skip_reply_line(&text) {
                continue;
            }

            result.push(VisibleTextNode { rect, text });
        }

        result.sort_by(|left, right| {
            left.rect
                .top
                .cmp(&right.rect.top)
                .then(left.rect.left.cmp(&right.rect.left))
        });
        debug_log_visible_nodes(&result);
        Ok(result)
    }
}

#[cfg(target_os = "windows")]
fn compare_input_candidate(
    left: &(i32, i32, i32, IUIAutomationElement),
    right: &(i32, i32, i32, IUIAutomationElement),
) -> std::cmp::Ordering {
    left.0
        .cmp(&right.0)
        .then(left.1.cmp(&right.1))
        .then(right.2.cmp(&left.2))
}

#[cfg(target_os = "windows")]
fn build_reply_candidate_from_nodes(nodes: Vec<VisibleTextNode>) -> Option<(usize, RECT, String)> {
    if nodes.is_empty() {
        debug_log("reply_clusters none");
        return None;
    }

    let mut clusters: Vec<(RECT, Vec<String>)> = Vec::new();

    for node in nodes {
        let Some((rect, texts)) = clusters.last_mut() else {
            clusters.push((node.rect, vec![node.text]));
            continue;
        };

        if node.rect.top - rect.bottom <= REPLY_CLUSTER_GAP {
            rect.left = rect.left.min(node.rect.left);
            rect.top = rect.top.min(node.rect.top);
            rect.right = rect.right.max(node.rect.right);
            rect.bottom = rect.bottom.max(node.rect.bottom);
            if texts.last() != Some(&node.text) {
                texts.push(node.text);
            }
        } else {
            clusters.push((node.rect, vec![node.text]));
        }
    }

    let result = clusters
        .into_iter()
        .filter_map(|(rect, texts)| {
            let text = sanitize_reply_text(&texts.join("\n"));
            let chars = text.chars().count();
            if chars < 12 {
                return None;
            }
            Some((chars, rect, text))
        })
        .max_by(|left, right| {
            left.2
                .chars()
                .count()
                .cmp(&right.2.chars().count())
                .then(left.1.bottom.cmp(&right.1.bottom))
        });

    if let Some((chars, rect, text)) = result.as_ref() {
        debug_log(&format!(
            "reply_cluster_pick rect=({}, {}, {}, {}) chars={} preview={}",
            rect.left,
            rect.top,
            rect.right,
            rect.bottom,
            chars,
            preview_text(text, 160)
        ));
    } else {
        debug_log("reply_cluster_pick none");
    }

    result
}

#[cfg(target_os = "windows")]
fn element_array_to_vec(
    elements: IUIAutomationElementArray,
) -> Result<Vec<IUIAutomationElement>, String> {
    let length = unsafe { elements.Length() }.map_err(|error| error.to_string())?;
    let mut result = Vec::with_capacity(length.max(0) as usize);

    for index in 0..length {
        let element = unsafe { elements.GetElement(index) }.map_err(|error| error.to_string())?;
        result.push(element);
    }

    Ok(result)
}

#[cfg(target_os = "windows")]
fn element_text_blob(element: &IUIAutomationElement) -> String {
    [
        element_name(element),
        element_automation_id(element),
        element_help_text(element),
        element_class_name(element),
    ]
    .into_iter()
    .filter(|value| !value.is_empty())
    .collect::<Vec<_>>()
    .join(" ")
    .to_lowercase()
}

#[cfg(target_os = "windows")]
fn element_name(element: &IUIAutomationElement) -> String {
    unsafe { element.CurrentName() }
        .ok()
        .map(|value| value.to_string())
        .unwrap_or_default()
}

#[cfg(target_os = "windows")]
fn element_automation_id(element: &IUIAutomationElement) -> String {
    unsafe { element.CurrentAutomationId() }
        .ok()
        .map(|value| value.to_string())
        .unwrap_or_default()
}

#[cfg(target_os = "windows")]
fn element_help_text(element: &IUIAutomationElement) -> String {
    unsafe { element.CurrentHelpText() }
        .ok()
        .map(|value| value.to_string())
        .unwrap_or_default()
}

#[cfg(target_os = "windows")]
fn element_class_name(element: &IUIAutomationElement) -> String {
    unsafe { element.CurrentClassName() }
        .ok()
        .map(|value| value.to_string())
        .unwrap_or_default()
}

#[cfg(target_os = "windows")]
fn contains_any_label(text: &str, labels: &[&str]) -> bool {
    labels.iter().any(|label| text.contains(label))
}

#[cfg(target_os = "windows")]
fn element_full_text(element: &IUIAutomationElement) -> String {
    element_text_pattern_text(element)
        .filter(|text| !text.trim().is_empty())
        .unwrap_or_else(|| element_name(element))
}

#[cfg(target_os = "windows")]
fn element_text_pattern_text(element: &IUIAutomationElement) -> Option<String> {
    let pattern = unsafe { element.GetCurrentPatternAs::<IUIAutomationTextPattern>(UIA_TextPatternId) }
        .ok()?;
    let range = unsafe { pattern.DocumentRange() }.ok()?;
    unsafe { range.GetText(-1) }
        .ok()
        .map(|value| value.to_string())
}

#[cfg(target_os = "windows")]
fn element_rect_if_visible(element: &IUIAutomationElement, window_rect: RECT) -> Option<RECT> {
    let is_enabled = unsafe { element.CurrentIsEnabled() }.ok()?.as_bool();
    let is_offscreen = unsafe { element.CurrentIsOffscreen() }.ok()?.as_bool();
    let rect = unsafe { element.CurrentBoundingRectangle() }.ok()?;

    if !is_enabled || is_offscreen || !rect_has_area(rect) || !rect_intersects(rect, window_rect) {
        return None;
    }

    Some(rect)
}

#[cfg(target_os = "windows")]
fn rect_has_area(rect: RECT) -> bool {
    rect.right > rect.left && rect.bottom > rect.top
}

#[cfg(target_os = "windows")]
fn rect_intersects(left: RECT, right: RECT) -> bool {
    left.left < right.right
        && left.right > right.left
        && left.top < right.bottom
        && left.bottom > right.top
}

#[cfg(target_os = "windows")]
fn rect_contains_point(rect: RECT, x: i32, y: i32) -> bool {
    x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom
}

#[cfg(target_os = "windows")]
fn click_rect_center(rect: RECT) -> Result<(), String> {
    let x = rect.left + ((rect.right - rect.left) / 2);
    let y = rect.top + ((rect.bottom - rect.top) / 2);
    click_screen_point(x, y)
}

#[cfg(target_os = "windows")]
fn click_rect_center_in_window(hwnd: isize, rect: RECT) -> Result<(), String> {
    let window_rect = client_rect_screen(HWND(hwnd as *mut core::ffi::c_void))?;
    let x = rect.left + ((rect.right - rect.left) / 2);
    let y = rect.top + ((rect.bottom - rect.top) / 2);
    if !rect_contains_point(window_rect, x, y) {
        debug_log(&format!(
            "guarded_click_outside_window hwnd={} point=({}, {}) window_rect=({}, {}, {}, {})",
            hwnd,
            x,
            y,
            window_rect.left,
            window_rect.top,
            window_rect.right,
            window_rect.bottom
        ));
        return Err(SMALL_WINDOW_LAYOUT_UNSAFE_ERROR.to_string());
    }
    ensure_target_foreground(hwnd)?;
    click_screen_point(x, y)
}

#[cfg(target_os = "windows")]
fn focus_input_with_uia(hwnd: isize) -> Result<bool, String> {
    let session = AutomationSession::new(hwnd)?;
    let Some(input) = session.find_input_target()? else {
        return Ok(false);
    };

    unsafe { input.SetFocus() }.map_err(|error| format!("Failed to focus Doubao input: {error}"))?;
    let rect = unsafe { input.CurrentBoundingRectangle() }
        .map_err(|error| format!("Failed to inspect Doubao input bounds: {error}"))?;
    click_rect_center_in_window(hwnd, rect)?;
    Ok(true)
}

#[cfg(target_os = "windows")]
fn click_input_box(target: DoubaoWindowTarget) -> Result<(), String> {
    if focus_input_with_uia(target.hwnd)? {
        debug_log("input_focus_by_uia");
        return Ok(());
    }

    let rect = client_rect_screen(HWND(target.hwnd as *mut core::ffi::c_void))?;
    match target.mode {
        DoubaoWindowMode::MainWindow => {
            let x = rect.left + ((rect.right - rect.left) as f64 * INPUT_X_RATIO) as i32;
            let y = rect.bottom - INPUT_Y_OFFSET;
            debug_log(&format!("input_fallback_main x={} y={}", x, y));
            click_screen_point(x, y)
        }
        DoubaoWindowMode::SmallWindow => {
            let width = rect.right - rect.left;
            let height = rect.bottom - rect.top;
            let mut last_error: Option<String> = None;

            for (x_ratio, y_ratio) in SMALL_WINDOW_INPUT_FALLBACK_POINTS {
                let x = rect.left + (width as f64 * x_ratio) as i32;
                let y = rect.top + (height as f64 * y_ratio) as i32;
                debug_log(&format!("input_fallback_small_guarded x={} y={}", x, y));
                if let Err(error) = click_point_in_window(target.hwnd, rect, x, y) {
                    last_error = Some(error);
                    continue;
                }
                thread::sleep(Duration::from_millis(120));
                return Ok(());
            }

            debug_log("input_fallback_small_exhausted");
            Err(last_error.unwrap_or(SMALL_WINDOW_LAYOUT_UNSAFE_ERROR.to_string()))
        }
    }
}

#[cfg(target_os = "windows")]
fn client_rect_screen(hwnd: HWND) -> Result<RECT, String> {
    let mut rect = RECT::default();
    unsafe {
        GetClientRect(hwnd, &mut rect).map_err(|error| error.to_string())?;
        let mut origin = POINT {
            x: rect.left,
            y: rect.top,
        };
        if !ClientToScreen(hwnd, &mut origin).as_bool() {
            return Err("ClientToScreen failed".to_string());
        }
        let width = rect.right - rect.left;
        let height = rect.bottom - rect.top;
        Ok(RECT {
            left: origin.x,
            top: origin.y,
            right: origin.x + width,
            bottom: origin.y + height,
        })
    }
}


#[cfg(target_os = "windows")]
fn click_screen_point(x: i32, y: i32) -> Result<(), String> {
    unsafe {
        let mut original = POINT::default();
        GetCursorPos(&mut original).map_err(|error| error.to_string())?;
        SetCursorPos(x, y).map_err(|error| error.to_string())?;
        send_mouse_input(MOUSEEVENTF_LEFTDOWN)?;
        send_mouse_input(MOUSEEVENTF_LEFTUP)?;
        SetCursorPos(original.x, original.y).map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn click_point_in_window(hwnd: isize, window_rect: RECT, x: i32, y: i32) -> Result<(), String> {
    if !rect_contains_point(window_rect, x, y) {
        debug_log(&format!(
            "guarded_point_outside_window hwnd={} point=({}, {}) window_rect=({}, {}, {}, {})",
            hwnd,
            x,
            y,
            window_rect.left,
            window_rect.top,
            window_rect.right,
            window_rect.bottom
        ));
        return Err(SMALL_WINDOW_LAYOUT_UNSAFE_ERROR.to_string());
    }

    ensure_target_foreground(hwnd)?;
    click_screen_point(x, y)
}

#[cfg(target_os = "windows")]
fn send_mouse_input(
    flags: windows::Win32::UI::Input::KeyboardAndMouse::MOUSE_EVENT_FLAGS,
) -> Result<(), String> {
    let inputs = [INPUT {
        r#type: INPUT_MOUSE,
        Anonymous: INPUT_0 {
            mi: MOUSEINPUT {
                dx: 0,
                dy: 0,
                mouseData: 0,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    }];
    unsafe {
        let sent = SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);
        if sent == inputs.len() as u32 {
            Ok(())
        } else {
            Err("SendInput mouse event failed".to_string())
        }
    }
}

#[cfg(target_os = "windows")]
fn paste_shortcut() -> Result<(), String> {
    send_modified_key(VK_CONTROL, VIRTUAL_KEY(b'V' as u16))
}

#[cfg(target_os = "windows")]
fn press_enter() -> Result<(), String> {
    send_key_press(VIRTUAL_KEY(0x0D))
}

#[cfg(target_os = "windows")]
fn press_alt_space() -> Result<(), String> {
    send_modified_key(VK_MENU, VK_SPACE)
}

#[cfg(target_os = "windows")]
fn send_modified_key(modifier: VIRTUAL_KEY, key: VIRTUAL_KEY) -> Result<(), String> {
    send_key_down(modifier)?;
    let press_result = send_key_press(key);
    let release_result = send_key_up(modifier);

    press_result?;
    release_result
}

#[cfg(target_os = "windows")]
fn send_key_press(key: VIRTUAL_KEY) -> Result<(), String> {
    send_key_down(key)?;
    send_key_up(key)
}

#[cfg(target_os = "windows")]
fn send_key_down(key: VIRTUAL_KEY) -> Result<(), String> {
    send_keyboard_input(key, false)
}

#[cfg(target_os = "windows")]
fn send_key_up(key: VIRTUAL_KEY) -> Result<(), String> {
    send_keyboard_input(key, true)
}

#[cfg(target_os = "windows")]
fn send_keyboard_input(key: VIRTUAL_KEY, key_up: bool) -> Result<(), String> {
    let flags = if key_up {
        KEYEVENTF_KEYUP
    } else {
        Default::default()
    };
    let inputs = [INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: key,
                wScan: 0,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    }];
    unsafe {
        let sent = SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);
        if sent == inputs.len() as u32 {
            Ok(())
        } else {
            Err("SendInput keyboard event failed".to_string())
        }
    }
}

#[cfg(target_os = "windows")]
fn find_doubao_window() -> Option<isize> {
    find_doubao_windows()
        .into_iter()
        .find(|candidate| is_main_doubao_title(&candidate.title))
        .map(|candidate| candidate.hwnd)
}

#[cfg(target_os = "windows")]
fn find_doubao_small_window(main_hwnd: isize) -> Option<isize> {
    let main_process_id = window_process_id(HWND(main_hwnd as *mut core::ffi::c_void))?;
    let main_rect = window_rect(HWND(main_hwnd as *mut core::ffi::c_void))?;
    let main_area = rect_area(main_rect);

    find_doubao_windows()
        .into_iter()
        .filter(|candidate| candidate.hwnd != main_hwnd)
        .filter(|candidate| candidate.process_id == main_process_id)
        .filter(|candidate| rect_area(candidate.rect) > 120_000)
        .filter(|candidate| rect_area(candidate.rect) < main_area)
        .min_by_key(|candidate| rect_area(candidate.rect))
        .map(|candidate| candidate.hwnd)
}

#[cfg(target_os = "windows")]
fn find_existing_doubao_small_window() -> Option<isize> {
    let main_hwnd = find_doubao_window()?;
    find_doubao_small_window(main_hwnd)
}

#[cfg(target_os = "windows")]
fn find_recent_doubao_small_window(
    baseline_hwnds: &[isize],
    known_process_id: Option<u32>,
) -> Option<isize> {
    if let Some(foreground) = foreground_doubao_small_window(known_process_id) {
        return Some(foreground);
    }

    let baseline: std::collections::HashSet<isize> = baseline_hwnds.iter().copied().collect();
    let mut candidates: Vec<WindowCandidate> = find_doubao_windows()
        .into_iter()
        .filter(|candidate| !baseline.contains(&candidate.hwnd))
        .filter(|candidate| !is_main_doubao_title(&candidate.title))
        .collect();

    candidates.sort_by_key(|candidate| rect_area(candidate.rect));
    candidates.first().map(|candidate| candidate.hwnd)
}

#[cfg(target_os = "windows")]
fn foreground_doubao_small_window(known_process_id: Option<u32>) -> Option<isize> {
    let hwnd = unsafe { GetForegroundWindow() };
    if hwnd.0.is_null() {
        return None;
    }

    let process_id = window_process_id(hwnd)?;
    if let Some(known_process_id) = known_process_id {
        if process_id != known_process_id {
            return None;
        }
    }

    let title = window_title(hwnd);
    if is_main_doubao_title(&title) {
        return None;
    }

    let rect = window_rect(hwnd)?;
    if rect_area(rect) < 120_000 {
        return None;
    }

    Some(hwnd.0 as isize)
}

#[cfg(target_os = "windows")]
fn collect_doubao_window_hwnds() -> Vec<isize> {
    find_doubao_windows()
        .into_iter()
        .map(|candidate| candidate.hwnd)
        .collect()
}

#[cfg(target_os = "windows")]
fn find_doubao_windows() -> Vec<WindowCandidate> {
    unsafe extern "system" fn enum_windows_callback(hwnd: HWND, lparam: LPARAM) -> BOOL {
        if !unsafe { IsWindowVisible(hwnd).as_bool() } {
            return BOOL(1);
        }

        let Some(rect) = window_rect(hwnd) else {
            return BOOL(1);
        };
        if !rect_has_area(rect) {
            return BOOL(1);
        }

        let process_id = match window_process_id(hwnd) {
            Some(process_id) if process_id != 0 => process_id,
            _ => return BOOL(1),
        };
        let title = window_title(hwnd);

        if title.trim().is_empty() && rect_area(rect) < 120_000 {
            return BOOL(1);
        }

        let target = lparam.0 as *mut Vec<WindowCandidate>;
        unsafe {
            (*target).push(WindowCandidate {
                hwnd: hwnd.0 as isize,
                title,
                rect,
                process_id,
            });
        }
        BOOL(1)
    }

    let mut windows = Vec::new();
    unsafe {
        let _ = EnumWindows(
            Some(enum_windows_callback),
            LPARAM((&mut windows as *mut Vec<WindowCandidate>) as isize),
        );
    }

    let known_process_id = doubao_process_id();

    windows
        .into_iter()
        .filter(|candidate: &WindowCandidate| {
            is_main_doubao_title(&candidate.title)
                || (known_process_id != 0 && candidate.process_id == known_process_id)
        })
        .collect()
}

#[cfg(target_os = "windows")]
fn is_main_doubao_title(title: &str) -> bool {
    let trimmed = title.trim();
    trimmed == "豆包" || trimmed.starts_with("豆包 -")
}

#[cfg(target_os = "windows")]
fn doubao_process_id() -> u32 {
    find_known_doubao_process_id().unwrap_or(0)
}

#[cfg(target_os = "windows")]
fn find_known_doubao_process_id() -> Option<u32> {
    find_doubao_windows_by_title()
        .into_iter()
        .find(|candidate| is_main_doubao_title(&candidate.title))
        .map(|candidate| candidate.process_id)
}

#[cfg(target_os = "windows")]
fn find_doubao_windows_by_title() -> Vec<WindowCandidate> {
    unsafe extern "system" fn enum_windows_callback(hwnd: HWND, lparam: LPARAM) -> BOOL {
        if !unsafe { IsWindowVisible(hwnd).as_bool() } {
            return BOOL(1);
        }

        let title = window_title(hwnd);
        if title.trim().is_empty() {
            return BOOL(1);
        }

        let Some(rect) = window_rect(hwnd) else {
            return BOOL(1);
        };
        let process_id = match window_process_id(hwnd) {
            Some(process_id) if process_id != 0 => process_id,
            _ => return BOOL(1),
        };

        let target = lparam.0 as *mut Vec<WindowCandidate>;
        unsafe {
            (*target).push(WindowCandidate {
                hwnd: hwnd.0 as isize,
                title,
                rect,
                process_id,
            });
        }
        BOOL(1)
    }

    let mut windows = Vec::new();
    unsafe {
        let _ = EnumWindows(
            Some(enum_windows_callback),
            LPARAM((&mut windows as *mut Vec<WindowCandidate>) as isize),
        );
    }
    windows
}

#[cfg(target_os = "windows")]
fn window_title(hwnd: HWND) -> String {
    let len = unsafe { GetWindowTextLengthW(hwnd) };
    if len <= 0 {
        return String::new();
    }

    let mut buffer = vec![0u16; len as usize + 1];
    let copied = unsafe { GetWindowTextW(hwnd, &mut buffer) };
    if copied <= 0 {
        return String::new();
    }

    String::from_utf16_lossy(&buffer[..copied as usize])
}

#[cfg(target_os = "windows")]
fn window_process_id(hwnd: HWND) -> Option<u32> {
    let mut process_id = 0u32;
    unsafe {
        let _ = GetWindowThreadProcessId(hwnd, Some(&mut process_id));
    }
    (process_id != 0).then_some(process_id)
}

#[cfg(target_os = "windows")]
fn window_rect(hwnd: HWND) -> Option<RECT> {
    let mut rect = RECT::default();
    unsafe { GetWindowRect(hwnd, &mut rect).ok()? };
    Some(rect)
}

#[cfg(target_os = "windows")]
fn rect_area(rect: RECT) -> i64 {
    i64::from(rect.right - rect.left) * i64::from(rect.bottom - rect.top)
}

#[cfg(target_os = "windows")]
fn focus_doubao_window(hwnd: isize) {
    let hwnd = HWND(hwnd as *mut core::ffi::c_void);
    unsafe {
        if IsIconic(hwnd).as_bool() {
            let _ = ShowWindow(hwnd, SW_RESTORE);
        }
        let _ = SetForegroundWindow(hwnd);
    }
    thread::sleep(WINDOW_FOCUS_DELAY);
}

#[cfg(target_os = "windows")]
fn focus_window_without_restore(hwnd: isize) -> Result<(), String> {
    let hwnd = HWND(hwnd as *mut core::ffi::c_void);
    unsafe { SetForegroundWindow(hwnd) }.ok().map_err(|error| error.to_string())?;
    thread::sleep(WINDOW_FOCUS_DELAY);
    Ok(())
}

#[cfg(target_os = "windows")]
fn ensure_target_foreground(hwnd: isize) -> Result<(), String> {
    focus_window_without_restore(hwnd)?;
    let foreground = unsafe { GetForegroundWindow() };
    if foreground.0 == hwnd as *mut core::ffi::c_void {
        debug_log(&format!("foreground_ok hwnd={hwnd}"));
        return Ok(());
    }

    debug_log(&format!(
        "foreground_mismatch expected={} actual={}",
        hwnd, foreground.0 as isize
    ));
    Err("Failed to keep Doubao small window in the foreground".to_string())
}

#[cfg(target_os = "windows")]
fn validate_small_window_geometry(hwnd: isize) -> Result<(), String> {
    let hwnd = HWND(hwnd as *mut core::ffi::c_void);

    for pass in 0..2 {
        let rect = client_rect_screen(hwnd)
            .map_err(|_| SMALL_WINDOW_LAYOUT_UNSAFE_ERROR.to_string())?;
        let outer_rect = window_rect(hwnd)
            .ok_or_else(|| SMALL_WINDOW_LAYOUT_UNSAFE_ERROR.to_string())?;
        let width = rect.right - rect.left;
        let height = rect.bottom - rect.top;
        let screen_height = unsafe { GetSystemMetrics(SM_CYSCREEN) };
        let bottom_gap = screen_height - rect.bottom;
        let mut reasons: Vec<&str> = Vec::new();

        if width < SMALL_WINDOW_MIN_WIDTH {
            reasons.push("width_too_small");
        }
        if height <= 0 {
            reasons.push("height_invalid");
        }
        if rect.left < 0 {
            reasons.push("left_out_of_bounds");
        }
        if rect.top < 0 {
            reasons.push("top_out_of_bounds");
        }
        if bottom_gap < SMALL_WINDOW_BOTTOM_CLEARANCE {
            reasons.push("too_close_to_taskbar");
        }

        let unsafe_layout = !reasons.is_empty();
        let reason_text = if reasons.is_empty() {
            "ok".to_string()
        } else {
            reasons.join(",")
        };

        debug_log(&format!(
            "small_window_geometry hwnd={} pass={} client_rect=({}, {}, {}, {}) outer_rect=({}, {}, {}, {}) size={}x{} screen_height={} bottom_gap={} unsafe={} reasons={}",
            hwnd.0 as isize,
            pass + 1,
            rect.left,
            rect.top,
            rect.right,
            rect.bottom,
            outer_rect.left,
            outer_rect.top,
            outer_rect.right,
            outer_rect.bottom,
            width,
            height,
            screen_height,
            bottom_gap,
            unsafe_layout,
            reason_text
        ));

        if !unsafe_layout {
            return Ok(());
        }

        if pass == 0 && reasons.len() == 1 && reasons[0] == "too_close_to_taskbar" {
            if try_reposition_small_window_up(hwnd, bottom_gap, outer_rect).is_ok() {
                thread::sleep(Duration::from_millis(180));
                continue;
            }
        }

        return Err(SMALL_WINDOW_LAYOUT_UNSAFE_ERROR.to_string());
    }

    Err(SMALL_WINDOW_LAYOUT_UNSAFE_ERROR.to_string())
}

#[cfg(target_os = "windows")]
fn try_reposition_small_window_up(hwnd: HWND, bottom_gap: i32, outer_rect: RECT) -> Result<(), String> {
    let needed_shift = SMALL_WINDOW_BOTTOM_CLEARANCE - bottom_gap + SMALL_WINDOW_REPOSITION_PADDING;
    if needed_shift <= 0 {
        return Ok(());
    }

    let target_y = (outer_rect.top - needed_shift).max(0);
    debug_log(&format!(
        "small_window_reposition hwnd={} from_top={} from_bottom={} shift={} target_y={}",
        hwnd.0 as isize,
        outer_rect.top,
        outer_rect.bottom,
        needed_shift,
        target_y
    ));

    unsafe {
        SetWindowPos(
            hwnd,
            None,
            outer_rect.left,
            target_y,
            0,
            0,
            SWP_NOSIZE | SWP_NOZORDER,
        )
        .map_err(|error| format!("Failed to reposition the Doubao small window: {error}"))?;
    }

    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn focus_doubao_window(_hwnd: isize) {}

#[cfg(not(target_os = "windows"))]
fn focus_window_without_restore(_hwnd: isize) -> Result<(), String> {
    Err("Doubao desktop automation is only supported on Windows".to_string())
}

#[cfg(not(target_os = "windows"))]
fn ensure_target_foreground(_hwnd: isize) -> Result<(), String> {
    Err("Doubao desktop automation is only supported on Windows".to_string())
}

#[cfg(not(target_os = "windows"))]
fn paste_shortcut() -> Result<(), String> {
    Err("Doubao desktop automation is only supported on Windows".to_string())
}

#[cfg(not(target_os = "windows"))]
fn press_enter() -> Result<(), String> {
    Err("Doubao desktop automation is only supported on Windows".to_string())
}

#[cfg(not(target_os = "windows"))]
fn click_input_box(_target: DoubaoWindowTarget) -> Result<(), String> {
    Err("Doubao desktop automation is only supported on Windows".to_string())
}
