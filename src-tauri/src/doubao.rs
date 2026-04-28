#![allow(dead_code)]

use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    path::Path,
    process::Command,
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
const PROMPT_PASTE_DELAY: Duration = Duration::from_millis(300);
const WINDOW_FOCUS_DELAY: Duration = Duration::from_millis(400);
const NEW_CHAT_DELAY: Duration = Duration::from_millis(700);
const CLIPBOARD_WATCH_INTERVAL: Duration = Duration::from_millis(900);
const CLIPBOARD_WATCH_TIMEOUT: Duration = Duration::from_secs(600);
const REPLY_POLL_INTERVAL: Duration = Duration::from_millis(1800);
const REPLY_READY_TIMEOUT: Duration = Duration::from_secs(600);
const DOUBAO_EXE_PATH: &str = r"C:\Users\Administrator\AppData\Local\Doubao\Application\app\Doubao.exe";
const DOUBAO_EXE_FALLBACK_PATH: &str =
    r"C:\Users\Administrator\AppData\Local\Doubao\Application\Doubao.exe";
const OCR_PROMPT: &str = "请帮我提取文件中的文字，只保留提取的文字，不要加其他任何信息";

const INPUT_X_RATIO: f64 = 0.5;
const INPUT_Y_OFFSET: i32 = 132;
const NEW_CHAT_FALLBACK_POINTS: [(f64, f64); 3] = [
    (0.19, 0.07),
    (0.168, 0.07),
    (0.205, 0.07),
];
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
    if request.provider != "doubao" {
        return Err("Unsupported AI OCR provider".to_string());
    }

    if !Path::new(&request.file_path).exists() {
        return Err("Selected file does not exist".to_string());
    }

    debug_log("========================================");
    debug_log(&format!("start_session file={}", request.file_path));

    let hwnd = ensure_doubao_window()?;
    start_new_conversation(hwnd)?;
    submit_ocr_request(hwnd, &request.file_path)?;

    let marker_seed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_nanos();
    let marker = format!("__doubao_manual_copy_marker_{marker_seed}__");
    let backup = replace_clipboard_text(&marker)?;
    restore_clipboard_text(backup);

    let session_id = state.next_session_id();
    let session = DoubaoSession {
        session_id: session_id.clone(),
        provider: request.provider.clone(),
        status: "needsManual".to_string(),
        stage: "manualTakeover".to_string(),
        message: Some(
            "Doubao request sent. Wait for the reply in Doubao, click copy manually, and the app will import it automatically."
                .to_string(),
        ),
        result_text: None,
        clipboard_marker: Some(marker),
    };

    state.save(session.clone())?;
    start_manual_watch(
        app.clone(),
        state.clipboard_watch_id.clone(),
        session.session_id.clone(),
        read_clipboard_text().unwrap_or_default(),
        request.file_path.clone(),
    );
    Ok(to_response(session))
}

pub fn continue_session(
    state: &DoubaoAutomationState,
    session_id: &str,
) -> Result<DoubaoOcrResponse, String> {
    let mut session = state.get(session_id)?;

    if session.status == "completed" {
        return Ok(to_response(session));
    }

    ensure_doubao_window()?;
    session.status = "running".to_string();
    session.stage = "waitingResult".to_string();
    session.message = Some("Reading the copied Doubao response".to_string());
    state.save(session.clone())?;

    match read_manual_copied_response(session.clipboard_marker.as_deref()) {
        Ok(result_text) => {
            session.status = "completed".to_string();
            session.stage = "completed".to_string();
            session.message = Some("Doubao OCR completed".to_string());
            session.result_text = Some(result_text);
        }
        Err(error) => {
            session.status = "needsManual".to_string();
            session.stage = "manualTakeover".to_string();
            session.message = Some(format!(
                "No copied reply was detected yet. Finish the reply in Doubao, click copy manually, then try again. {error}"
            ));
        }
    }

    state.save(session.clone())?;
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
) {
    let current_watch = watch_id.fetch_add(1, Ordering::Relaxed) + 1;

    start_clipboard_watch(
        app,
        watch_id,
        current_watch,
        session_id,
        baseline,
        file_path,
    );
}

fn start_clipboard_watch(
    app: AppHandle,
    watch_id: Arc<AtomicU64>,
    current_watch: u64,
    session_id: String,
    baseline: String,
    file_path: String,
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
                    && try_emit_result(&app, &watch_id, current_watch, &session_id, text)
                {
                    return;
                }
            }

            thread::sleep(CLIPBOARD_WATCH_INTERVAL);
        }
    });
}

fn start_reply_watch(
    app: AppHandle,
    watch_id: Arc<AtomicU64>,
    current_watch: u64,
    session_id: String,
    hwnd: isize,
) {
    thread::spawn(move || {
        if let Ok(text) = wait_for_latest_reply_text(hwnd, &watch_id, current_watch) {
            let _ = try_emit_result(&app, &watch_id, current_watch, &session_id, text);
        }
    });
}

fn submit_ocr_request(hwnd: isize, file_path: &str) -> Result<(), String> {
    focus_doubao_window(hwnd);
    click_input_box(hwnd)?;
    thread::sleep(WINDOW_FOCUS_DELAY);

    set_clipboard_file(file_path)?;
    paste_shortcut()?;
    thread::sleep(FILE_PASTE_DELAY);

    let backup = replace_clipboard_text(OCR_PROMPT)?;
    paste_shortcut()?;
    thread::sleep(PROMPT_PASTE_DELAY);
    restore_clipboard_text(backup);

    press_enter()?;
    Ok(())
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
fn start_new_conversation(hwnd: isize) -> Result<(), String> {
    focus_doubao_window(hwnd);
    let session = AutomationSession::new(hwnd)?;
    if let Some(target) = session.find_new_chat_target()? {
        let rect = unsafe { target.CurrentBoundingRectangle() }.map_err(|error| {
            format!("Failed to inspect Doubao new conversation button: {error}")
        })?;
        click_rect_center(rect)?;
    } else {
        click_new_chat_fallback(session.window_rect)?;
    }
    thread::sleep(NEW_CHAT_DELAY);
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn start_new_conversation(_hwnd: isize) -> Result<(), String> {
    Err("Doubao desktop automation is only supported on Windows".to_string())
}

#[cfg(target_os = "windows")]
fn click_new_chat_fallback(window_rect: RECT) -> Result<(), String> {
    let width = window_rect.right - window_rect.left;
    let height = window_rect.bottom - window_rect.top;

    let mut last_error: Option<String> = None;
    for (x_ratio, y_ratio) in NEW_CHAT_FALLBACK_POINTS {
        let x = window_rect.left + (width as f64 * x_ratio) as i32;
        let y = window_rect.top + (height as f64 * y_ratio) as i32;
        if let Err(error) = click_screen_point(x, y) {
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
    if compact.contains("请帮我提取文件中的文字") {
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
    let _ = message;
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
    let escaped = file_path.replace('\'', "''");
    Command::new("powershell")
        .args([
            "-NoProfile",
            "-Command",
            &format!("Set-Clipboard -LiteralPath '{}'", escaped),
        ])
        .output()
        .map_err(|error| format!("Failed to stage file on clipboard: {error}"))
        .and_then(|output| {
            if output.status.success() {
                Ok(())
            } else {
                Err(format!(
                    "Failed to stage file on clipboard: {}",
                    String::from_utf8_lossy(&output.stderr).trim()
                ))
            }
        })
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

fn available_exe_paths() -> Vec<&'static str> {
    [DOUBAO_EXE_PATH, DOUBAO_EXE_FALLBACK_PATH]
        .into_iter()
        .filter(|path| Path::new(path).exists())
        .collect()
}

#[cfg(target_os = "windows")]
fn ensure_doubao_window() -> Result<isize, String> {
    if let Some(hwnd) = find_doubao_window() {
        return Ok(hwnd);
    }

    let mut attempts = Vec::new();

    for exe_path in available_exe_paths() {
        match Command::new(exe_path).spawn() {
            Ok(_) => {
                let start = Instant::now();
                while start.elapsed() < WINDOW_START_TIMEOUT {
                    if let Some(hwnd) = find_doubao_window() {
                        return Ok(hwnd);
                    }
                    thread::sleep(Duration::from_millis(500));
                }
                attempts.push(format!(
                    "{exe_path}: window did not appear within {}s",
                    WINDOW_START_TIMEOUT.as_secs()
                ));
            }
            Err(error) => {
                attempts.push(format!("{exe_path}: failed to start: {error}"));
            }
        }
    }

    Err(format!(
        "Doubao window did not become ready in time. {}",
        attempts.join(" | ")
    ))
}

#[cfg(not(target_os = "windows"))]
fn ensure_doubao_window() -> Result<isize, String> {
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
            Input::KeyboardAndMouse::{
                SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, INPUT_MOUSE, KEYBDINPUT,
                KEYEVENTF_KEYUP, MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP, MOUSEINPUT,
                VIRTUAL_KEY, VK_CONTROL,
            },
            WindowsAndMessaging::{
                EnumWindows, GetClientRect, GetCursorPos, GetWindowTextLengthW, GetWindowTextW,
                IsIconic, IsWindowVisible, SetCursorPos, SetForegroundWindow, ShowWindow,
                SW_RESTORE,
            },
        },
    },
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
            let candidate = (score, width, rect.top, element);

            if best
                .as_ref()
                .is_none_or(|current| compare_input_candidate(&candidate, current).is_gt())
            {
                best = Some(candidate);
            }
        }

        Ok(best.map(|(_, _, _, element)| element))
    }

    fn find_new_chat_target(&self) -> Result<Option<IUIAutomationElement>, String> {
        let mut candidates: Vec<(i32, i32, IUIAutomationElement)> = Vec::new();
        let window_width = self.window_rect.right - self.window_rect.left;
        let window_height = self.window_rect.bottom - self.window_rect.top;
        let left_bound = self.window_rect.left + (window_width / 10);
        let right_bound = self.window_rect.left + (window_width / 3);
        let top_bound = self.window_rect.top + (window_height / 6);

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
            if rect.top > top_bound || rect.left < left_bound || rect.right > right_bound {
                continue;
            }

            let width = rect.right - rect.left;
            let height = rect.bottom - rect.top;
            if width < 16 || height < 16 || width > 96 || height > 96 {
                continue;
            }

            let blob = element_text_blob(&element);
            let label_bonus = if contains_any_label(&blob, &NEW_CHAT_HINT_LABELS) {
                10_000
            } else {
                0
            };
            let score = label_bonus + rect.left;
            candidates.push((score, rect.left, element));
        }

        candidates.sort_by(|left, right| left.0.cmp(&right.0).then(left.1.cmp(&right.1)));
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
fn click_rect_center(rect: RECT) -> Result<(), String> {
    let x = rect.left + ((rect.right - rect.left) / 2);
    let y = rect.top + ((rect.bottom - rect.top) / 2);
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
    click_rect_center(rect)?;
    Ok(true)
}

#[cfg(target_os = "windows")]
fn click_input_box(hwnd: isize) -> Result<(), String> {
    if focus_input_with_uia(hwnd)? {
        return Ok(());
    }

    let rect = client_rect_screen(HWND(hwnd as *mut core::ffi::c_void))?;
    let x = rect.left + ((rect.right - rect.left) as f64 * INPUT_X_RATIO) as i32;
    let y = rect.bottom - INPUT_Y_OFFSET;
    click_screen_point(x, y)
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
    send_key_down(VK_CONTROL)?;
    send_key_press(VIRTUAL_KEY(b'V' as u16))?;
    send_key_up(VK_CONTROL)
}

#[cfg(target_os = "windows")]
fn press_enter() -> Result<(), String> {
    send_key_press(VIRTUAL_KEY(0x0D))
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
    unsafe extern "system" fn enum_windows_callback(hwnd: HWND, lparam: LPARAM) -> BOOL {
        if !unsafe { IsWindowVisible(hwnd).as_bool() } {
            return BOOL(1);
        }

        let len = unsafe { GetWindowTextLengthW(hwnd) };
        if len <= 0 {
            return BOOL(1);
        }

        let mut buffer = vec![0u16; len as usize + 1];
        let copied = unsafe { GetWindowTextW(hwnd, &mut buffer) };
        if copied <= 0 {
            return BOOL(1);
        }

        let title = String::from_utf16_lossy(&buffer[..copied as usize]);
        if title.trim() == "豆包" {
            let target = lparam.0 as *mut isize;
            unsafe { *target = hwnd.0 as isize };
            return BOOL(0);
        }

        BOOL(1)
    }

    let mut found = 0isize;
    unsafe {
        let _ = EnumWindows(
            Some(enum_windows_callback),
            LPARAM((&mut found as *mut isize) as isize),
        );
    }

    if found == 0 {
        None
    } else {
        Some(found)
    }
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

#[cfg(not(target_os = "windows"))]
fn focus_doubao_window(_hwnd: isize) {}

#[cfg(not(target_os = "windows"))]
fn paste_shortcut() -> Result<(), String> {
    Err("Doubao desktop automation is only supported on Windows".to_string())
}

#[cfg(not(target_os = "windows"))]
fn press_enter() -> Result<(), String> {
    Err("Doubao desktop automation is only supported on Windows".to_string())
}

#[cfg(not(target_os = "windows"))]
fn click_input_box(_hwnd: isize) -> Result<(), String> {
    Err("Doubao desktop automation is only supported on Windows".to_string())
}
