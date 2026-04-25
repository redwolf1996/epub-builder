# 缩进跳过 Markdown 语法行

在 `indentSelection` 和 `indentAll` 中，跳过以 Markdown 语法开头的行（标题、引用、列表、代码块、表格等），只对普通文本段落施加缩进。

## 判断逻辑

行首匹配以下模式则跳过：
- `#` → 标题
- `>` → 引用
- `- ` / `+ ` / `* ` → 无序列表
- `---` / `***` / `___` → 分割线
- `` ` `` → 代码块
- `|` → 表格
- `~` → 删除线块
- `!` → 图片
- `[` → 链接
- `**` / `__` → 加粗/斜体包裹
- `\d+.` → 有序列表

用正则 `/^[#>*+\-`|~!\[_]|^\d+[.]|^(\*{2,}|_{2,})/` 判断。

## 修改文件

- **`CodeMirrorEditor.vue`** — `indentSelection` 和 `indentAll` 中，在 `line.text.length === 0` 判断后加一个 `isMarkdownLine(line.text)` 判断，匹配则 continue
