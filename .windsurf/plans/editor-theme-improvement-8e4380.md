# 编辑器主题样式优化

优化 CodeMirrorEditor.vue 的编辑器样式，解决行号太淡、行号区域背景不明显、语法高亮不够的问题。

## 修改文件

`src/components/editor/CodeMirrorEditor.vue`

## 具体改动

### 1. 行号区域（gutters）样式增强
- `.cm-gutters`：添加半透明背景色（`var(--bg-surface)` + 透明度），加深行号颜色从 `--text-muted` 改为 `--text-secondary`
- `.cm-activeLineGutter`：增强当前行号对比度，颜色改为 `--text-primary`

### 2. 语法高亮增强
- 当前只用了 `oneDarkHighlightStyle` 作为 fallback，高亮效果弱
- 为 Markdown 常见语法元素添加自定义高亮样式：标题、粗体、斜体、链接、代码、引用等，使用更鲜明的颜色
- 颜色方案使用 CSS 变量适配多主题，同时提供合理的 fallback 色值
