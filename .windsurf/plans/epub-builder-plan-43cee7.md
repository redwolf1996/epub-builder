# EPUB Builder 项目开发计划

构建一个基于 Vite + Vue 3 + TypeScript + Naive UI + UnoCSS 的 Markdown 电子书编辑器，支持实时预览、IndexedDB 多书缓存、EPUB 导出，兼容 Web 和 Tauri v2。

---

## 技术栈确认

| 类别 | 选择 |
|------|------|
| 构建工具 | Vite 6 |
| 框架 | Vue 3 (Composition API + `<script setup>`) |
| 语言 | TypeScript (strict, 禁止 any) |
| UI 库 | Naive UI |
| 样式 | UnoCSS + 现代 CSS (无 SCSS) |
| 编辑器 | CodeMirror 6 |
| Markdown 解析 | markdown-it + 代码高亮 highlight.js |
| EPUB 生成 | epub-gen-memory |
| 数据持久化 | Dexie.js (IndexedDB) |
| 桌面端 | Tauri v2 |
| 代码规范 | oxlint + oxfmt, 单引号, 无分号 |

---

## 步骤详情

### 步骤 1：项目初始化与基础配置
- [ ] 使用 `npm create vite@latest` 创建 Vue + TypeScript 项目
- [ ] 安装核心依赖：vue, naive-ui, unocss, @unocss/preset-uno, pinia, vue-router
- [ ] 安装编辑器依赖：@codemirror/vue, @codemirror/state, @codemirror/view, @codemirror/lang-markdown, @codemirror/theme-one-dark
- [ ] 安装 Markdown/EPUB 依赖：markdown-it, highlight.js, epub-gen-memory
- [ ] 安装数据层依赖：dexie
- [ ] 安装开发依赖：oxlint, oxfmt, @typescript-eslint
- [ ] 配置 `vite.config.ts`（UnoCSS 插件、路径别名）
- [ ] 配置 `uno.config.ts`（preset-uno, preset-attributify, preset-icons）
- [ ] 配置 `tsconfig.json`（strict: true, noImplicitAny, 路径别名）
- [ ] 配置 `.oxlintrc.json`（单引号、无分号规则）
- [ ] 配置 `.oxfmt.json`（单引号、无分号、格式化规则）
- [ ] 创建 `AGENTS.md`（项目规范，见附录）
- [ ] 创建 `.windsurf/skills/` 目录结构
- [ ] 验证：`npm run dev` 能正常启动

### 步骤 2：项目目录结构与布局框架
- [ ] 创建目录结构：
  ```
  src/
  ├── assets/          # 静态资源
  ├── components/      # 通用组件
  │   ├── editor/      # 编辑器相关
  │   ├── preview/     # 预览相关
  │   └── common/      # 通用UI组件
  ├── composables/     # 组合式函数
  │   ├── useBook.ts
  │   ├── useChapter.ts
  │   └── useEpub.ts
  ├── db/              # IndexedDB 数据层
  │   └── index.ts
  ├── layouts/         # 布局组件
  ├── pages/           # 页面组件
  │   ├── Home.vue     # 书籍列表
  │   ├── Editor.vue   # 编辑页面
  │   └── Settings.vue # 书籍设置
  ├── router/          # 路由
  │   └── index.ts
  ├── stores/          # Pinia stores
  │   ├── book.ts
  │   └── editor.ts
  ├── styles/          # 全局样式
  │   └── global.css
  ├── types/           # TypeScript 类型定义
  │   └── index.ts
  ├── utils/           # 工具函数
  │   ├── markdown.ts
  │   └── epub.ts
  ├── App.vue
  └── main.ts
  ```
- [ ] 定义核心 TypeScript 类型（Book, Chapter, BookMeta 等）
- [ ] 创建 App 布局骨架（响应式侧边栏 + 主内容区）
- [ ] 配置 vue-router 路由（Home, Editor, Settings）
- [ ] 验证：路由跳转正常，布局响应式

### 步骤 3：IndexedDB 数据层（Dexie.js）
- [ ] 定义 Dexie 数据库 schema（books 表, chapters 表）
- [ ] 实现 `useBook` composable：创建/读取/更新/删除书籍
- [ ] 实现 `useChapter` composable：章节 CRUD + 排序
- [ ] 实现 Pinia store 与 Dexie 的同步逻辑
- [ ] 添加自动保存（debounce 500ms）
- [ ] 验证：刷新页面后数据持久化

### 步骤 4：书籍列表页（Home）
- [ ] 实现书籍卡片网格布局（封面缩略图 + 书名 + 作者）
- [ ] 新建书籍功能（弹窗填写书名、作者）
- [ ] 删除书籍（确认弹窗）
- [ ] 空状态提示（引导创建第一本书）
- [ ] 响应式：手机单列，PC 多列
- [ ] 验证：创建/删除书籍正常，IndexedDB 持久化

### 步骤 5：Markdown 编辑器集成（CodeMirror 6）
- [ ] 封装 `CodeMirrorEditor.vue` 组件
- [ ] 配置 CodeMirror 扩展：markdown 语法、主题、行号、自动换行
- [ ] 实现 v-model 双向绑定（content prop ↔ CodeMirror state）
- [ ] 添加常用工具栏（标题、加粗、斜体、链接、代码块、图片）
- [ ] 验证：编辑器输入正常，工具栏插入 Markdown 语法正常

### 步骤 6：实时 Markdown 预览
- [ ] 封装 `MarkdownPreview.vue` 组件
- [ ] 集成 markdown-it + highlight.js 代码高亮
- [ ] 实现编辑器内容 → 预览的实时同步（debounce 100ms）
- [ ] 预览样式美化（排版、代码块、表格、引用等）
- [ ] 编辑器 + 预览分屏布局（可拖拽分割线）
- [ ] 手机端：Tab 切换编辑/预览模式
- [ ] 验证：输入 Markdown 即时看到渲染结果

### 步骤 7：章节管理
- [ ] 左侧章节目录面板（拖拽排序）
- [ ] 新增/重命名/删除章节
- [ ] 章节切换时自动保存当前章节、加载目标章节
- [ ] 章节标题从 Markdown H1 自动提取
- [ ] 验证：多章节切换、排序、自动保存

### 步骤 8：书籍设置页（封面、作者等元信息）
- [ ] 书籍元信息编辑表单（书名、作者、简介、语言、发布日期）
- [ ] 封面图片上传（Base64 存入 IndexedDB）
- [ ] 封面预览
- [ ] 保存元信息到 IndexedDB
- [ ] 验证：设置保存后刷新依旧保留

### 步骤 9：EPUB 导出功能
- [ ] 封装 `useEpub` composable
- [ ] 将书籍元信息 + 章节内容转换为 epub-gen-memory 格式
- [ ] Markdown → HTML 转换（markdown-it）
- [ ] 生成 EPUB 文件并触发下载（Web 端 FileSaver / Tauri 端 fs API）
- [ ] 导出进度提示
- [ ] 验证：导出的 EPUB 可被阅读器正常打开

### 步骤 10：UI 美化与动效
- [ ] 全局深色主题（Naive UI dark theme）
- [ ] 渐变色/玻璃态卡片效果
- [ ] 页面切换过渡动画
- [ ] 编辑器/预览面板过渡动效
- [ ] 响应式细节打磨（手机端适配）
- [ ] 验证：视觉效果现代化炫酷

### 步骤 11：Tauri v2 集成
- [ ] `npm create tauri-app` 或手动添加 Tauri 配置
- [ ] 配置 `tauri.conf.json`（窗口大小、标题、图标）
- [ ] 适配 Tauri API（文件保存对话框替代浏览器下载）
- [ ] 配置 Tauri 打包（Windows installer, macOS dmg）
- [ ] 验证：`npm run tauri dev` 正常运行，`npm run tauri build` 可打包

### 步骤 12：最终测试与完善
- [ ] 全流程测试：创建书 → 写章节 → 设置封面 → 导出 EPUB
- [ ] 刷新/关闭后数据持久化验证
- [ ] 手机端响应式测试
- [ ] Tauri 桌面端测试
- [ ] 修复发现的 bug
- [ ] 代码格式化（oxfmt）和 lint（oxlint）通过

---

## 附录：需创建的配置文件

### AGENTS.md（项目根目录）
```markdown
# EPUB Builder 项目规范

## 技术栈
- Vite 6 + Vue 3 + TypeScript (strict, 禁止 any)
- Naive UI + UnoCSS + 现代 CSS（禁止 SCSS）
- CodeMirror 6 + markdown-it + epub-gen-memory
- Dexie.js (IndexedDB) + Pinia
- Tauri v2

## 代码风格
- Script 使用单引号，不加分号
- 禁止使用 any 类型
- 使用 Composition API + `<script setup lang="ts">`
- 组件命名：PascalCase；composable：useCamelCase；工具函数：camelCase
- 格式化：oxfmt；Lint：oxlint

## 组件规范
- 每个组件一个文件，文件名 PascalCase
- Props 使用 defineProps<T>()，Emits 使用 defineEmits<T>()
- 响应式数据优先使用 ref()，复杂对象用 reactive()

## 样式规范
- 使用 UnoCSS 原子类 + 现代 CSS（CSS nesting, container queries 等）
- 禁止 SCSS/LESS
- 响应式断点：mobile < 768px, tablet 768-1024px, desktop > 1024px
```

### Skills（.windsurf/skills/）
- `epub-export/SKILL.md` — EPUB 导出流程指南
- `tauri-build/SKILL.md` — Tauri 打包配置指南

---

## 进度追踪

| 步骤 | 状态 |
|------|------|
| 1. 项目初始化与基础配置 | ✅ 已完成 |
| 2. 目录结构与布局框架 | ✅ 已完成 |
| 3. IndexedDB 数据层 | ✅ 已完成 |
| 4. 书籍列表页 | ✅ 已完成 |
| 5. Markdown 编辑器集成 | ✅ 已完成 |
| 6. 实时 Markdown 预览 | ✅ 已完成 |
| 7. 章节管理 | ✅ 已完成 |
| 8. 书籍设置页 | ✅ 已完成 |
| 9. EPUB 导出功能 | ✅ 已完成 |
| 10. UI 美化与动效 | ✅ 已完成 |
| 11. Tauri v2 集成 | ✅ 已完成 |
| 12. 最终测试与完善 | ✅ 已完成 |
