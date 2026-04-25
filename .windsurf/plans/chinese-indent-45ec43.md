# 中文段落首行缩进功能

在编辑器工具栏添加快捷按钮，点击后在当前行首插入两个全角空格（U+3000），实现中文段落首行缩进。

## 背景

Markdown 中行首普通空格会被忽略或解析为代码块，无法实现中文段落缩进。全角空格（`　`）是标准 CJK 字符，Markdown 不会忽略它，渲染时能正确显示为两个汉字宽度的缩进。

## 修改文件

1. **`src/components/editor/CodeMirrorEditor.vue`** — 在 `defineExpose` 中新增 `indentLine()` 方法：获取光标所在行首位置，插入 `　　`（两个 U+3000），光标移到插入内容之后
2. **`src/components/editor/EditorToolbar.vue`** — `EditorActions` 接口新增 `indentLine`；添加「首行缩进」按钮，使用 `i-carbon-text-indent-more` 图标
3. **`src/pages/Editor.vue`** — 在 `editorActions` 中将 `indentLine` 方法从 `cmEditorRef` 传递给 toolbar
4. **`src/i18n/zh-CN.ts`** — 添加 `toolbar.indent: '首行缩进'`
5. **`src/i18n/en.ts`** — 添加 `toolbar.indent: 'Indent'`
