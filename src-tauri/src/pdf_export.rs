use serde::Deserialize;
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};
use lopdf::{Dictionary, Document, Object, ObjectId, StringFormat};

const EDGE_PATHS: [&str; 2] = [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportPdfRequest {
    pub html: String,
    pub title: String,
    pub file_path: String,
    pub outline_items: Vec<PdfOutlineItem>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfOutlineItem {
    pub title: String,
    pub anchor: String,
    pub depth: usize,
}

pub fn log_export_event(message: &str) {
    let log_path = export_log_path();
    if let Some(parent) = log_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or(0);

    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path)
    {
        let _ = writeln!(file, "[{timestamp}] {message}");
    }
}

fn export_log_path() -> PathBuf {
    std::env::temp_dir().join("epub-builder").join("pdf-export.log")
}

pub fn export_pdf_file(request: ExportPdfRequest) -> Result<(), String> {
    log_export_event(&format!(
        "start export path={} title={} html_bytes={}",
        request.file_path,
        request.title,
        request.html.len()
    ));

    let edge_path = find_edge_path().ok_or_else(|| {
        let message = "Microsoft Edge not found. PDF export requires Edge on Windows.".to_string();
        log_export_event(&message);
        message
    })?;

    let temp_html_path = create_temp_html(&request.title, &request.html)?;
    log_export_event(&format!("temp html path={}", temp_html_path.display()));

    let file_uri = path_to_file_uri(&temp_html_path);
    let output = Command::new(&edge_path)
        .args([
            "--headless=new",
            "--disable-gpu",
            "--run-all-compositor-stages-before-draw",
            "--virtual-time-budget=120000",
            "--no-pdf-header-footer",
            &format!("--print-to-pdf={}", request.file_path),
            &file_uri,
        ])
        .output()
        .map_err(|error| {
            let message = format!("Failed to launch Edge for PDF export: {error}");
            log_export_event(&message);
            message
        })?;

    log_export_event(&format!(
        "edge exit status={:?} stdout={} stderr={}",
        output.status.code(),
        shorten_for_log(&String::from_utf8_lossy(&output.stdout)),
        shorten_for_log(&String::from_utf8_lossy(&output.stderr))
    ));

    let remove_result = std::fs::remove_file(&temp_html_path);
    if let Err(error) = remove_result {
        log_export_event(&format!(
            "failed to remove temp html path={} error={}",
            temp_html_path.display(),
            error
        ));
    }

    if !output.status.success() {
        return Err("Edge PDF export failed".to_string());
    }

    let output_path = Path::new(&request.file_path);
    if !output_path.exists() {
        let message = "PDF export did not produce an output file".to_string();
        log_export_event(&message);
        return Err(message);
    }

    if !request.outline_items.is_empty() {
        attach_pdf_outlines(output_path, &request.outline_items)?;
    }

    let file_size = std::fs::metadata(output_path)
        .map(|meta| meta.len())
        .unwrap_or(0);
    log_export_event(&format!("render complete file_size={file_size}"));
    Ok(())
}

fn find_edge_path() -> Option<PathBuf> {
    EDGE_PATHS
        .iter()
        .map(PathBuf::from)
        .find(|path| path.exists())
}

fn create_temp_html(title: &str, html: &str) -> Result<PathBuf, String> {
    let temp_dir = std::env::temp_dir().join("epub-builder");
    std::fs::create_dir_all(&temp_dir)
        .map_err(|error| format!("Failed to create temp export directory: {error}"))?;

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis())
        .unwrap_or(0);
    let temp_path = temp_dir.join(format!("pdf-export-{timestamp}.html"));
    let document = wrap_html_document(title, html);
    std::fs::write(&temp_path, document)
        .map_err(|error| format!("Failed to write temp HTML for PDF export: {error}"))?;
    Ok(temp_path)
}

fn wrap_html_document(title: &str, body_html: &str) -> String {
    format!(
        "<!DOCTYPE html><html lang=\"zh-CN\"><head><meta charset=\"UTF-8\" /><meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\" /><title>{}</title></head><body>{}</body></html>",
        escape_html(title),
        body_html
    )
}

fn escape_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

fn path_to_file_uri(path: &Path) -> String {
    let normalized = path.to_string_lossy().replace('\\', "/");
    format!("file:///{}", normalized)
}

fn shorten_for_log(value: &str) -> String {
    const LIMIT: usize = 240;
    if value.chars().count() <= LIMIT {
        return value.to_string();
    }
    let shortened = value.chars().take(LIMIT).collect::<String>();
    format!("{shortened}...")
}

#[derive(Clone, Debug)]
struct OutlineNode {
    title: String,
    anchor: String,
    children: Vec<usize>,
}

fn attach_pdf_outlines(path: &Path, items: &[PdfOutlineItem]) -> Result<(), String> {
    log_export_event(&format!("attach outlines count={}", items.len()));
    let mut doc = Document::load(path)
        .map_err(|error| format!("Failed to load generated PDF for outlines: {error}"))?;

    let tree = build_outline_tree(items);
    if tree.is_empty() {
        return Ok(());
    }

    let root_id = doc
        .trailer
        .get(b"Root")
        .and_then(Object::as_reference)
        .map_err(|error| format!("Failed to locate PDF catalog: {error}"))?;

    let outline_root_id = doc.new_object_id();
    let mut nodes = Vec::with_capacity(tree.len());
    let top_level = tree[0].children.clone();
    build_outline_objects(&mut doc, &tree, &top_level, outline_root_id, &mut nodes);

    let mut outline_root = Dictionary::new();
    outline_root.set("Type", "Outlines");
    outline_root.set("Count", count_visible_children(&tree, &top_level) as i64);
    if let Some(first) = top_level.first().and_then(|index| nodes[*index].as_ref()) {
        outline_root.set("First", first.id);
    }
    if let Some(last) = top_level.last().and_then(|index| nodes[*index].as_ref()) {
        outline_root.set("Last", last.id);
    }
    doc.objects.insert(outline_root_id, Object::Dictionary(outline_root));

    let catalog = doc
        .get_object_mut(root_id)
        .and_then(Object::as_dict_mut)
        .map_err(|error| format!("Failed to mutate PDF catalog: {error}"))?;
    catalog.set("Outlines", outline_root_id);
    catalog.set("PageMode", "UseOutlines");

    doc.save(path)
        .map_err(|error| format!("Failed to save PDF outlines: {error}"))?;
    log_export_event("outline attachment complete");
    Ok(())
}

#[derive(Clone, Debug)]
struct BuiltOutlineNode {
    id: ObjectId,
}

fn build_outline_tree(items: &[PdfOutlineItem]) -> Vec<OutlineNode> {
    let mut tree = vec![OutlineNode {
        title: String::new(),
        anchor: String::new(),
        children: Vec::new(),
    }];
    let mut stack: Vec<usize> = Vec::new();

    for item in items {
        let node_index = tree.len();
        tree.push(OutlineNode {
            title: item.title.clone(),
            anchor: item.anchor.clone(),
            children: Vec::new(),
        });

        let normalized_depth = item.depth.min(stack.len());
        stack.truncate(normalized_depth);
        let parent_index = stack.last().copied().unwrap_or(0);
        tree[parent_index].children.push(node_index);
        stack.push(node_index);
    }

    tree
}

fn build_outline_objects(
    doc: &mut Document,
    tree: &[OutlineNode],
    node_indices: &[usize],
    parent_id: ObjectId,
    built: &mut Vec<Option<BuiltOutlineNode>>,
) {
    if built.len() < tree.len() {
        built.resize_with(tree.len(), || None);
    }

    let object_ids = node_indices
        .iter()
        .map(|_| doc.new_object_id())
        .collect::<Vec<_>>();

    for (position, node_index) in node_indices.iter().enumerate() {
        let node = &tree[*node_index];
        let id = object_ids[position];
        let prev = position.checked_sub(1).map(|idx| object_ids[idx]);
        let next = object_ids.get(position + 1).copied();

        let mut dict = Dictionary::new();
        dict.set("Title", pdf_text_string(&node.title));
        dict.set("Parent", parent_id);
        dict.set("Dest", Object::Name(node.anchor.as_bytes().to_vec()));

        if let Some(prev_id) = prev {
            dict.set("Prev", prev_id);
        }
        if let Some(next_id) = next {
            dict.set("Next", next_id);
        }

        if !node.children.is_empty() {
            let child_ids = node
                .children
                .iter()
                .map(|_| doc.new_object_id())
                .collect::<Vec<_>>();
            dict.set("First", child_ids[0]);
            dict.set("Last", *child_ids.last().unwrap_or(&child_ids[0]));
            dict.set("Count", count_visible_children(tree, &node.children) as i64);
            doc.objects.insert(id, Object::Dictionary(dict));
            built[*node_index] = Some(BuiltOutlineNode { id });
            build_outline_children_with_ids(doc, tree, &node.children, id, built, &child_ids);
            continue;
        }

        doc.objects.insert(id, Object::Dictionary(dict));
        built[*node_index] = Some(BuiltOutlineNode { id });
    }
}

fn build_outline_children_with_ids(
    doc: &mut Document,
    tree: &[OutlineNode],
    node_indices: &[usize],
    parent_id: ObjectId,
    built: &mut Vec<Option<BuiltOutlineNode>>,
    object_ids: &[ObjectId],
) {
    for (position, node_index) in node_indices.iter().enumerate() {
        let node = &tree[*node_index];
        let id = object_ids[position];
        let prev = position.checked_sub(1).map(|idx| object_ids[idx]);
        let next = object_ids.get(position + 1).copied();

        let mut dict = Dictionary::new();
        dict.set("Title", pdf_text_string(&node.title));
        dict.set("Parent", parent_id);
        dict.set("Dest", Object::Name(node.anchor.as_bytes().to_vec()));

        if let Some(prev_id) = prev {
            dict.set("Prev", prev_id);
        }
        if let Some(next_id) = next {
            dict.set("Next", next_id);
        }

        if !node.children.is_empty() {
            let child_ids = node
                .children
                .iter()
                .map(|_| doc.new_object_id())
                .collect::<Vec<_>>();
            dict.set("First", child_ids[0]);
            dict.set("Last", *child_ids.last().unwrap_or(&child_ids[0]));
            dict.set("Count", count_visible_children(tree, &node.children) as i64);
            doc.objects.insert(id, Object::Dictionary(dict));
            built[*node_index] = Some(BuiltOutlineNode { id });
            build_outline_children_with_ids(doc, tree, &node.children, id, built, &child_ids);
            continue;
        }

        doc.objects.insert(id, Object::Dictionary(dict));
        built[*node_index] = Some(BuiltOutlineNode { id });
    }
}

fn count_visible_children(tree: &[OutlineNode], node_indices: &[usize]) -> usize {
    node_indices
        .iter()
        .map(|node_index| 1 + count_visible_children(tree, &tree[*node_index].children))
        .sum()
}

fn pdf_text_string(value: &str) -> Object {
    let mut bytes = vec![0xFE, 0xFF];
    for unit in value.encode_utf16() {
        bytes.push((unit >> 8) as u8);
        bytes.push((unit & 0xFF) as u8);
    }
    Object::String(bytes, StringFormat::Hexadecimal)
}

#[cfg(test)]
mod tests {
    use super::{Object, PdfOutlineItem, StringFormat, build_outline_tree, escape_html, path_to_file_uri, pdf_text_string, wrap_html_document};
    use std::path::Path;

    #[test]
    fn wraps_document_with_utf8_meta() {
        let html = wrap_html_document("测试", "<main>body</main>");
        assert!(html.contains("<meta charset=\"UTF-8\" />"));
        assert!(html.contains("<main>body</main>"));
        assert!(html.contains("<title>测试</title>"));
    }

    #[test]
    fn escapes_title_html() {
        assert_eq!(escape_html("<demo>"), "&lt;demo&gt;");
    }

    #[test]
    fn converts_windows_path_to_file_uri() {
        let uri = path_to_file_uri(Path::new(r"C:\temp\demo.html"));
        assert_eq!(uri, "file:///C:/temp/demo.html");
    }

    #[test]
    fn builds_outline_tree_with_nested_items() {
        let tree = build_outline_tree(&[
            PdfOutlineItem { title: "A".into(), anchor: "chapter-a".into(), depth: 0 },
            PdfOutlineItem { title: "B".into(), anchor: "chapter-b".into(), depth: 1 },
            PdfOutlineItem { title: "C".into(), anchor: "chapter-c".into(), depth: 0 },
        ]);

        assert_eq!(tree[0].children, vec![1, 3]);
        assert_eq!(tree[1].children, vec![2]);
    }

    #[test]
    fn encodes_outline_title_as_utf16_hex() {
        match pdf_text_string("中文") {
            Object::String(bytes, StringFormat::Hexadecimal) => assert!(bytes.starts_with(&[0xFE, 0xFF])),
            _ => panic!("unexpected object type"),
        }
    }
}
