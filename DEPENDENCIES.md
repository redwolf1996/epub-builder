# EPUB Builder 依赖说明

## 运行时依赖（dependencies）

### 核心框架

| 包名 | 版本 | 说明 |
|------|------|------|
| `vue` | ^3.5.33 | Vue 3 核心框架，使用 Composition API + `<script setup>` |
| `vue-router` | ^5.0.6 | Vue 官方路由，管理首页、编辑器、设置等页面导航 |
| `pinia` | ^3.0.4 | Vue 官方状态管理，管理编辑器状态、主题、书籍等全局 store |
| `vue-i18n` | ^11.3.2 | 国际化插件，支持中英文切换 |

### 代码编辑器（CodeMirror 6）

| 包名 | 版本 | 说明 |
|------|------|------|
| `codemirror` | ^6.0.2 | CodeMirror 6 入口包，整合核心扩展的便捷导入 |
| `@codemirror/state` | ^6.6.0 | 编辑器状态管理，EditorState 和 Transaction 核心 |
| `@codemirror/view` | ^6.41.1 | 编辑器视图层，DOM 渲染、光标、滚动等 |
| `@codemirror/language` | ^6.12.3 | 语言基础设施，语法树高亮、缩进等通用支持 |
| `@codemirror/commands` | ^6.10.3 | 编辑命令（剪切、复制、查找替换、缩进等） |
| `@codemirror/autocomplete` | ^6.20.1 | 自动补全框架，Markdown 语法补全 |
| `@codemirror/search` | ^6.7.0 | 搜索替换功能，支持高亮匹配和增量搜索 |
| `@codemirror/lang-markdown` | ^6.5.0 | Markdown 语言支持，语法解析和高亮 |
| `@codemirror/theme-one-dark` | ^6.1.3 | One Dark 主题，暗色模式下的编辑器配色 |
| `@lezer/highlight` | ^1.2.3 | Lezer 语法高亮引擎，CodeMirror 底层使用的增量解析器 |

### Markdown 与 EPUB 生成

| 包名 | 版本 | 说明 |
|------|------|------|
| `markdown-it` | ^14.1.1 | Markdown 解析器，将 Markdown 文本渲染为 HTML，支持插件扩展 |
| `highlight.js` | ^11.11.1 | 代码语法高亮，配合 markdown-it 渲染代码块 |
| `epub-gen-memory` | ^1.1.2 | EPUB 生成库，将 HTML 内容打包为 EPUB 格式，纯内存操作无需文件系统 |

### UI 框架与样式

| 包名 | 版本 | 说明 |
|------|------|------|
| `naive-ui` | ^2.44.1 | Vue 3 组件库，提供 Button、Modal、Popover、Dialog 等 UI 组件 |
| `unocss` | ^66.6.8 | 原子化 CSS 引擎，即时生成工具类（flex、gap-2、text-sm 等） |
| `@unocss/preset-uno` | ^66.6.8 | UnoCSS 默认预设，兼容 Tailwind/Windi/AntFu 风格的工具类 |
| `@unocss/preset-icons` | ^66.6.8 | 图标预设，以 CSS 类方式使用图标（如 `i-carbon-book`） |
| `@unocss/preset-attributify` | ^66.6.8 | 属性化模式预设，支持 `<div text="sm red">` 写法 |
| `@iconify-json/carbon` | ^1.2.20 | IBM Carbon 图标集数据，提供 1000+ SVG 图标供 UnoCSS 使用 |

### 数据存储

| 包名 | 版本 | 说明 |
|------|------|------|
| `dexie` | ^4.4.2 | IndexedDB 封装库，提供 Promise API 操作浏览器本地数据库，存储书籍和章节数据 |

### Tauri 桌面端

| 包名 | 版本 | 说明 |
|------|------|------|
| `@tauri-apps/api` | ^2.10.1 | Tauri v2 核心 JS API，窗口管理、事件通信、菜单创建等 |
| `@tauri-apps/plugin-dialog` | ^2.7.0 | 文件对话框插件，打开/保存文件选择器 |
| `@tauri-apps/plugin-fs` | ^2.5.0 | 文件系统插件，读写本地文件（EPUB 导出、图片读取等） |
| `@tauri-apps/plugin-notification` | ^2.3.3 | 系统通知插件，发送桌面通知 |

### 工具库

| 包名 | 版本 | 说明 |
|------|------|------|
| `path-browserify` | ^1.0.1 | Node.js `path` 模块的浏览器端 polyfill，路径拼接和解析 |
| `vue-draggable-plus` | ^0.6.1 | Vue 3 拖拽排序组件，用于章节目录的拖拽重排 |

---

## 开发依赖（devDependencies）

| 包名 | 版本 | 说明 |
|------|------|------|
| `@tauri-apps/cli` | ^2.10.1 | Tauri v2 CLI 工具，`tauri dev` / `tauri build` 命令 |
| `typescript` | ^6.0.3 | TypeScript 编译器，类型检查和类型推导 |
| `vue-tsc` | ^3.2.7 | Vue 文件的 TypeScript 类型检查工具，`vue-tsc --noEmit` 用于构建前校验 |
| `vite` | ^8.0.10 | 前端构建工具，开发服务器和生产打包，极快的 HMR |
| `@vitejs/plugin-vue` | ^6.0.6 | Vite 的 Vue SFC 支持插件，编译 `.vue` 单文件组件 |
| `vitest` | ^4.1.5 | 单元测试框架，兼容 Vite 配置，支持 ESM 和 TypeScript |
| `@vue/test-utils` | ^2.4.8 | Vue 官方测试工具库，挂载组件、触发事件、断言渲染结果 |
| `happy-dom` | ^20.9.0 | 轻量浏览器环境模拟，vitest 的测试环境（替代 jsdom） |
| `sharp` | ^0.34.5 | 高性能图片处理库，用于构建时生成应用图标的多尺寸版本 |
| `@types/markdown-it` | ^14.1.2 | markdown-it 的 TypeScript 类型定义 |
| `@types/node` | ^25.6.0 | Node.js API 的 TypeScript 类型定义 |
| `@types/path-browserify` | ^1.0.3 | path-browserify 的 TypeScript 类型定义 |
