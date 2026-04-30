# 多图 OCR 功能实现计划

## 目标
AI OCR 支持上传多张图片，合并这些图片为一张拼接图，然后发送给豆包 AI 分析。

## 当前状态
- 当前 `handleAiOcr` 只支持单文件选择（`multiple: false`）
- Rust 端 `DoubaoOcrRequest` 只接受单个 `file_path`
- `submit_ocr_request` 通过剪贴板粘贴单文件到豆包窗口

## 实现步骤

### 1. 前端：多图选择与预览 ✅
- `handleAiOcr` 改为 `multiple: true`，允许选择多张图片
- 新增 `pendingAiOcrPaths: ref<string[]>([])` 替代 `pendingAiOcrPath`
- AI OCR Modal 中展示已选图片列表，支持删除单张、添加更多
- 新增 `removeAiOcrImage`、`addAiOcrImages` 函数

### 2. Rust 端：图片合并命令 ✅
- 新增 `merge_images` Tauri 命令，接收 `file_paths: Vec<String>`
- 使用 `image` crate 将多张图片垂直拼接为一张（居中对齐）
- 输出到 `%TEMP%/epub-builder/merged-{timestamp}.png`，返回路径
- 在 `Cargo.toml` 添加 `image = "0.25"` 依赖
- 注册到 `invoke_handler`

### 3. 前端：流程串联 ✅
- `startAiOcrSession` 中：多图时先调用 `merge_images`，再用合并结果调用 `start_doubao_ocr_session`
- 单图时直接使用原路径，跳过合并
- 合并期间显示 "正在合并图片..." 状态

### 4. 前端：AI OCR Modal UI 改造 ✅
- 文件路径区域改为图片列表（可滚动，最大高度 200px）
- 每项显示文件名 + 删除按钮
- 空列表提示 "尚未选择图片"
- 多图时显示合并提示
- 开始按钮：合并中显示 "正在合并图片..."，无图片时 disabled

### 5. i18n 补充 ✅
- `aiOcrAddImages` / `aiOcrNoImages` / `aiOcrMergeHint` / `aiOcrMerging`
- 中英文均已添加

### 6. 测试 ❌
- 验证多图选择、预览、合并、OCR 全流程
