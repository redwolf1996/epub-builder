# 工具栏字体颜色和背景色功能

在编辑器工具栏添加「字体颜色」和「背景色」两个按钮，点击后弹出 Naive UI 的 NColorPicker 调色盘，选色后用 `<span style="color:xxx">` / `<span style="background-color:xxx">` 包裹选中文字。

## 实现方案

- **Markdown 中设置颜色的方式**：使用 HTML `<span>` 标签（markdown-it 已开启 `html: true`，会正确渲染）
  - 字体颜色：`<span style="color:#ff0000">文字</span>`
  - 背景颜色：`<span style="background-color:#ffff00">文字</span>`
- **调色盘**：使用 Naive UI 的 `NColorPicker` 组件，配置 `swatches` 为常用 web 安全色，支持自定义选色
- **交互**：工具栏按钮点击后弹出 `NPopover` 内嵌 `NColorPicker`，确认选色后调用 `wrapSelection` 包裹选中文字

## 修改文件

1. **`EditorToolbar.vue`** — 添加字体颜色/背景色按钮 + NPopover + NColorPicker，确认选色后调用 `wrapSelection`
2. **`zh-CN.ts`** / **`en.ts`** — 添加 `toolbar.fontColor` / `toolbar.bgColor` 翻译
