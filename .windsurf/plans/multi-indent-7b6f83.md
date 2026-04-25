# 多段落缩进 + 全文缩进功能

实现两个功能：1) 现有缩进按钮支持多选段落每段首行缩进 2) 新增「全文缩进」按钮一键缩进所有段落。

## 修改文件

1. **`CodeMirrorEditor.vue`** — 重写 `indentLine()` → `indentSelection()`：遍历选区内所有非空行，行首无 `　　` 则插入；新增 `indentAll()`：对全文所有非空行执行同样逻辑
2. **`EditorToolbar.vue`** — `EditorActions` 接口 `indentLine` → `indentSelection`，新增 `indentAll`；新增「全文缩进」按钮（`i-carbon-text-align-justify` 图标）
3. **`Editor.vue`** — 传递 `indentSelection` + `indentAll`
4. **`zh-CN.ts`** / **`en.ts`** — `toolbar.indent` 改为「首行缩进」/「Indent」，新增 `toolbar.indentAll: '全文缩进'` /「Indent All」
