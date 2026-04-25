# 图片 OCR 文字识别导入

在编辑器工具栏添加 OCR 按钮，通过 Tauri 文件对话框选择图片，调用 Windows 原生 OCR API 识别文字，将结果插入当前章节正文。

## 实现步骤

### 1. Rust 侧：添加 Windows OCR 依赖和命令

- **Cargo.toml** 添加 `windows` crate，启用 `Media_Ocr`、`Graphics_Imaging`、`Storage`、`Globalization` features
- **lib.rs** 新增 `ocr_image` Tauri 命令：
  - 接收图片文件路径
  - 用 `StorageFile::GetFileFromPathAsync` 打开文件
  - 用 `BitmapDecoder` 解码为 `SoftwareBitmap`
  - 用 `OcrEngine`（尝试中文/英文）识别文字
  - 返回识别文本字符串
- 注册命令到 Tauri Builder

### 2. 前端：工具栏按钮 + OCR 逻辑

- **EditorToolbar.vue** 添加 OCR 按钮（使用 `i-carbon-scan` 图标），点击时 emit `ocr` 事件
- **Editor.vue** 监听 `ocr` 事件：
  1. 调用 `@tauri-apps/plugin-dialog` 的 `open()` 选择图片文件
  2. 调用 Tauri 命令 `ocr_image` 传入文件路径
  3. 将返回文字通过 `editorActions.insertText()` 插入编辑器
- 识别过程中显示 loading 状态

### 3. i18n 国际化

- **zh-CN.ts** / **en.ts** 添加 `toolbar.ocr`、`editor.ocrProcessing`、`editor.ocrNoText` 等文案

### 4. Tauri 权限

- **capabilities/default.json** 无需额外权限（文件路径由 dialog 插件返回，OCR 是自定义命令）

## 注意事项

- Windows OCR 需要系统安装对应语言包（中文包在 Windows 设置 → 语言 中安装）
- 此方案仅支持 Windows 10/11，macOS/Linux 需另行适配
- `OcrEngine` 优先尝试中文语言，回退到英文
