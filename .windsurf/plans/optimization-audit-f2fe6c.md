# EPUB Builder 全面优化审计

对项目进行全量代码审读后，按五个维度梳理优化点，按优先级排序。

---

## 一、书籍信息设置 (Settings.vue)

| # | 优化点 | 优先级 | 状态 |
|---|--------|--------|------|
| 1 | ~~语言选择器~~ | ~~高~~ | ❌ 跳过（用户决定不做） |
| 2 | 封面图片大小限制 + 自动压缩 | 高 | ✅ 已完成 |
| 3 | 封面拖拽上传 | 中 | ✅ 已完成 |
| 4 | 表单自动保存 | 中 | ✅ 已完成 |
| 5 | ~~表单布局自适应 + 移动端~~ | ~~低~~ | ❌ 跳过（保留原布局） |
| 6 | 新建弹窗字段精简 | 低 | ✅ 已完成 |

---

## 二、编辑器体验 (Editor.vue / CodeMirrorEditor.vue)

| # | 优化点 | 优先级 | 状态 |
|---|--------|--------|------|
| 1 | Editor.vue 过于臃肿 (542行) — 拆 composable | 高 | ✅ 已完成 |
| 2 | 无 Ctrl+S 手动保存 | 中 | ✅ 已完成 |
| 3 | 工具栏拥挤 — 分组折叠 | 中 | ✅ 已完成 |
| 4 | 无图片粘贴支持 | 中 | ✅ 已完成 |
| 5 | 预览滚动同步性能 — 二分查找 | 低 | ✅ 已完成 |
| 6 | 无查找替换 UI 入口 | 低 | ✅ 已完成 |
| 7 | 全屏模式隐藏章节面板 | 低 | ✅ 已完成 |

### 二-1. Editor.vue 拆分 composable（高优先级）

**现状**：Editor.vue 542 行，script 347 行，职责混杂（拖拽、章节管理、滚动同步、OCR、导出全部平铺）

**拆分方案**：

| composable | 职责 | 从 Editor.vue 抽出的代码行 | 新文件 |
|------------|------|---------------------------|--------|
| `useResizable` | 侧边栏/编辑器分割线拖拽 + localStorage 持久化 | L39-101（~60行） | `src/composables/useResizable.ts` |
| `useChapterManager` | 章节 CRUD / 搜索 / 重命名 / 折叠 / 本地列表同步 | L29-262（~100行） | `src/composables/useChapterManager.ts` |
| `useScrollSync` | 编辑器/预览滚动同步（scrollSource + timer） | L268-293（~30行） | `src/composables/useScrollSync.ts` |

**具体步骤**：
1. 新建 `src/composables/useResizable.ts`
   - 入参：`splitContainerRef: Ref<HTMLElement | null>`
   - 返回：`sidebarWidth`, `editorRatio`, `onSidebarDragStart`, `onSplitDragStart`, `SIDEBAR_MIN`, `SIDEBAR_MAX`
   - 内部处理 localStorage 读写 + watch 持久化
2. 新建 `src/composables/useChapterManager.ts`
   - 入参：`bookStore`, `editorStore`, `cmEditorRef`, `bookId`, `message`, `t`
   - 返回：`localChapters`, `filteredChapters`, `chapterSearch`, `editingChapterId`, `editingTitle`, `collapsedIds`, `showAddChapter`, `newChapterTitle`, `addChapterParentId` + 所有章节操作方法
3. 新建 `src/composables/useScrollSync.ts`
   - 入参：`cmEditorRef`, `previewRef`, `syncScroll: Ref<boolean>`
   - 返回：`handleEditorScroll`, `handlePreviewScroll`
4. 改造 Editor.vue：引入 3 个 composable，script 部分从 347 行 → ~150 行

**涉及文件**：
- `src/composables/useResizable.ts` — 新建
- `src/composables/useChapterManager.ts` — 新建
- `src/composables/useScrollSync.ts` — 新建
- `src/pages/Editor.vue` — 修改（大幅精简）

---

### 二-2. Ctrl+S 手动保存（中优先级）

**现状**：编辑器已有 debounce 500ms 自动保存，但用户无法主动触发保存

**方案**：Ctrl+S = `editorStore.flushSave()` + 状态显示"已保存"

**具体步骤**：
1. `src/pages/Editor.vue` → `handleKeydown` 函数中新增：
   ```ts
   if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
     e.preventDefault()
     editorStore.flushSave()
   }
   ```
2. `src/components/editor/CodeMirrorEditor.vue` → `createExtensions()` keymap 中新增：
   ```ts
   { key: 'Mod-s', run: () => true, preventDefault: true }  // 阻止浏览器默认，实际保存由 Editor.vue keydown 处理
   ```
   或统一在 Editor.vue 的 keydown 中处理（推荐，避免两处逻辑）

**涉及文件**：
- `src/pages/Editor.vue` — 修改（handleKeydown 加 Ctrl+S 分支）

---

### 二-3. 工具栏分组 + 折叠（中优先级）

**现状**：EditorToolbar.vue ~20 个按钮平铺在一行，窄屏溢出

**方案**：4 组 + 分隔线 + 下拉折叠

| 组名 | 按钮 | 折叠策略 |
|------|------|----------|
| **格式** | 标题、粗体、斜体、引用、列表 | 始终显示 |
| **缩进** | 缩进、全文缩进、减少缩进、全文减少缩进 | 下拉折叠（显示首按钮 + ▼） |
| **样式** | 字号±、前景色、背景色 | 下拉折叠（显示字号按钮 + ▼） |
| **插入** | 链接、图片、行内代码、代码块 | 下拉折叠（显示链接按钮 + ▼） |

**右侧独立**：帮助、全屏、预览主题、导出 — 始终显示

**具体步骤**：
1. `EditorToolbar.vue` 重构模板：
   - 格式组：`<NButtonGroup>` + 直接按钮
   - 缩进/样式/插入组：每组首按钮直接显示 + `<NPopover trigger="click">` 展开其余按钮
   - 组间加 `class="toolbar-divider"` 竖线分隔（1px border-left）
2. 新增 CSS：`.toolbar-divider` + 窄屏时工具栏 `overflow-x: auto`

**涉及文件**：
- `src/components/editor/EditorToolbar.vue` — 修改（模板重构）
- `src/i18n/zh-CN.ts` / `src/i18n/en.ts` — 新增组名 i18n key（可选）

---

### 二-4. 图片粘贴支持（中优先级）

**现状**：编辑器只能通过工具栏按钮插入 `![图片描述](image-url)` 占位符，无法粘贴真实图片

**方案**：
- 监听 CodeMirror 的 `paste` 事件
- 从 `ClipboardEvent.clipboardData.files` 取图片
- 调用 `compressImage()` 压缩后存为 base64 data URL
- 在光标位置插入 `![图片](data:image/jpeg;base64,...)`

**具体步骤**：
1. `src/components/editor/CodeMirrorEditor.vue` → `createExtensions()` 新增：
   ```ts
   EditorView.domEventHandlers({
     paste(event) {
       const file = event.clipboardData?.files[0]
       if (file && file.type.startsWith('image/')) {
         event.preventDefault()
         compressAndInsert(file)
       }
     }
   })
   ```
2. 新增 `compressAndInsert` 函数：调用 `compressImage` → `editorRef.dispatch` 插入 markdown 图片语法
3. 导入 `compressImage` from `@/utils/image`

**涉及文件**：
- `src/components/editor/CodeMirrorEditor.vue` — 修改
- `src/utils/image.ts` — 已有，无需改动

---

### 二-5. 预览滚动同步性能优化（低优先级）

**现状**：`MarkdownPreview.vue` 的 `findClosestElement()` 和 `getVisibleLine()` 都是 O(n) 线性遍历所有 `[data-line]` 元素

**方案**：`getVisibleLine()` 改为二分查找

**具体步骤**：
1. `src/components/preview/MarkdownPreview.vue` → `getVisibleLine()` 重写：
   - 将 `querySelectorAll('[data-line]')` 转为数组
   - 二分查找：比较 `elements[mid].getBoundingClientRect().top` 与 `containerTop`
   - 找到第一个 top >= containerTop 的元素即返回
2. `findClosestElement()` 同理改为二分查找

**涉及文件**：
- `src/components/preview/MarkdownPreview.vue` — 修改

---

### 二-6. 查找替换 UI 入口（低优先级）

**现状**：CodeMirror 已集成 `@codemirror/search`（searchKeymap），但只有快捷键（Ctrl+F），无工具栏按钮

**方案**：工具栏"功能"组加一个🔍按钮，点击后触发 CodeMirror 的 `openSearchPanel`

**具体步骤**：
1. `EditorToolbar.vue` → 新增搜索按钮，emit `search` 事件
2. `EditorActions` 接口新增 `openSearch: () => void`
3. `CodeMirrorEditor.vue` → `defineExpose` 新增 `openSearch` 方法：
   ```ts
   openSearch: () => {
     // 使用 @codemirror/search 的 openSearchPanel
     import { openSearchPanel } from '@codemirror/search'
     if (editorRef.value) openSearchPanel(editorRef.value)
   }
   ```
4. `Editor.vue` → `editorActions` 映射新增 `openSearch`

**涉及文件**：
- `src/components/editor/EditorToolbar.vue` — 修改
- `src/components/editor/CodeMirrorEditor.vue` — 修改
- `src/pages/Editor.vue` — 修改

---

### 二-7. 全屏模式隐藏章节面板（低优先级）

**现状**：全屏时 CSS `.is-fullscreen .chapter-sidebar { display: none }` 已隐藏章节面板，但全屏后无法访问章节

**方案**：全屏模式下章节面板改为可收起的抽屉（左侧滑出），点击汉堡按钮切换

**具体步骤**：
1. `Editor.vue` → 全屏时显示一个浮动汉堡按钮（左上角）
2. 点击后章节面板以 `position: fixed; left: 0; top: 0; bottom: 0; z-index: 10` 覆盖显示
3. 点击面板外区域关闭

**涉及文件**：
- `src/pages/Editor.vue` — 修改（模板 + 逻辑）

---

## 二 涉及文件总览

| 文件 | 改动类型 | 涉及步骤 |
|------|----------|----------|
| `src/composables/useResizable.ts` | **新建** | 二-1 |
| `src/composables/useChapterManager.ts` | **新建** | 二-1 |
| `src/composables/useScrollSync.ts` | **新建** | 二-1 |
| `src/pages/Editor.vue` | **修改** | 二-1, 二-2, 二-6, 二-7 |
| `src/components/editor/EditorToolbar.vue` | **修改** | 二-3, 二-6 |
| `src/components/editor/CodeMirrorEditor.vue` | **修改** | 二-4, 二-6 |
| `src/components/preview/MarkdownPreview.vue` | **修改** | 二-5 |
| `src/i18n/zh-CN.ts` | **修改** | 二-3(可选) |
| `src/i18n/en.ts` | **修改** | 二-3(可选) |

---

## 三、Tauri 构建产物体验优化

| # | 优化点 | 优先级 | 状态 |
|---|--------|--------|------|
| 1 | 窗口状态记忆 (`tauri-plugin-window-state`) | 高 | ✅ 已完成 |
| 2 | 动态窗口标题 | 中 | ✅ 已完成 |
| 3 | 单实例锁 (`tauri-plugin-single-instance`) | 中 | ✅ 已完成 |
| 4 | 导出完成系统通知 | 中 | ✅ 已完成 |
| 5 | OCR 跨平台支持 | 中 | ⏭️ 跳过 |
| 6 | 自动更新 (`tauri-plugin-updater`) | 低 | ⏭️ 跳过 |
| 7 | 原生菜单栏 | 低 | ✅ 已完成 |
| 8 | 文件关联 | 低 | ⏭️ 跳过 |

### 三-1. 窗口状态记忆（高优先级）

**现状**：`tauri.conf.json` 硬编码 `width: 1280, height: 720`，用户调整窗口大小/位置后重启丢失

**方案**：
1. 添加依赖：`cd src-tauri && cargo add tauri-plugin-window-state`
2. `lib.rs` → `run()` 中注册 `.plugin(tauri_plugin_window_state::Builder::new().build())`
3. `tauri.conf.json` → `app.windows[0]` 中移除固定尺寸，改为 `"fullscreen": false` 即可（插件会覆盖）
4. 无需前端代码改动，插件自动保存/恢复窗口位置、大小、最大化状态

**涉及文件**：
- `src-tauri/Cargo.toml` — 添加依赖
- `src-tauri/src/lib.rs` — 注册插件
- `src-tauri/tauri.conf.json` — 微调窗口配置

### 三-2. 动态窗口标题（中优先级）

**现状**：窗口标题固定为 `"EPUB Builder: Best way to create EPUB files from Markdown"`，不随页面切换变化

**方案**：
1. `App.vue` → 监听 `route.path` + `bookStore.activeBook`，通过 Tauri API 动态设置标题
2. 首页：`EPUB Builder`；编辑器：`EPUB Builder — {书名}`；设置：`EPUB Builder — {书名} · 设置`
3. 使用 `import { getCurrentWindow } from '@tauri-apps/api/window'` → `getCurrentWindow().setTitle(title)`
4. 非 Tauri 环境用 `document.title` 降级

**涉及文件**：
- `src/App.vue` — 添加 watch + setTitle 逻辑

### 三-3. 单实例锁（中优先级）

**现状**：双击桌面图标会打开多个实例，可能导致 IndexedDB 数据冲突

**方案**：
1. 添加依赖：`cd src-tauri && cargo add tauri-plugin-single-instance`
2. `lib.rs` → 注册 `.plugin(tauri_plugin_single_instance::init())`
3. 第二次启动时自动聚焦已有窗口（插件默认行为）
4. 如需传递参数（如打开文件），可通过插件事件 `single-instance` 接收，当前不需要

**涉及文件**：
- `src-tauri/Cargo.toml` — 添加依赖
- `src-tauri/src/lib.rs` — 注册插件

### 三-4. 导出完成系统通知（中优先级）

**现状**：EPUB 导出完成后仅用 Naive UI `message.success` 提示，窗口不在前台时看不到

**方案**：
1. 添加依赖：`cd src-tauri && cargo add tauri-plugin-notification`
2. `lib.rs` → 注册 `.plugin(tauri_plugin_notification::init())`
3. 前端 `Editor.vue` → `handleExport` 成功后，若 Tauri 环境则发送系统通知：
   ```ts
   import { isTauri } from '@/utils/epub'
   if (isTauri()) {
     const { sendNotification } = await import('@tauri-apps/plugin-notification')
     sendNotification({ title: 'EPUB Builder', body: t('editor.exportEpub') })
   }
   ```
4. 同时保留 `message.success` 作为应用内提示，系统通知仅窗口不在前台时显示

**涉及文件**：
- `src-tauri/Cargo.toml` — 添加依赖
- `src-tauri/src/lib.rs` — 注册插件
- `src/pages/Editor.vue` — handleExport 中添加通知

### 三-7. 原生菜单栏（低优先级）

**现状**：无原生菜单栏，所有操作通过 UI 按钮完成，不符合桌面应用习惯

**方案**：
1. 添加依赖：`cd src-tauri && cargo add tauri-plugin-macos-menu-bar`（仅 macOS）或手动用 `tauri::Menu`
2. **简化方案**：在 `lib.rs` 中用 Tauri 内置 Menu API 创建基础菜单：
   - `File`：新建书籍、导出 EPUB、关闭窗口
   - `Edit`：撤销、重做、查找替换
   - `View`：切换主题、全屏、同步滚动
   - `Help`：关于
3. 菜单项点击通过 `tauri::Emitter` 发事件到前端，前端监听后执行对应操作
4. **注意**：Tauri v2 的 Menu API 在 `tauri::menu` 模块，需要 `features = ["tray-icon", "image-ico"]` 或类似

**涉及文件**：
- `src-tauri/Cargo.toml` — 可能需要 features
- `src-tauri/src/lib.rs` — 创建菜单 + 事件处理
- `src/App.vue` 或 `Editor.vue` — 监听菜单事件

---

## 四、UI 视觉优化（渐变、过渡、动画）

| # | 优化点 | 优先级 | 状态 |
|---|--------|--------|------|
| 1 | 路由切换无过渡 — RouterView 包 Transition | 高 | ✅ 已完成 |
| 2 | 主题切换无过渡 — 关键容器加 transition | 高 | ✅ 已完成 |
| 3 | 书籍卡片无入场动画 | 中 | ✅ 已完成 |
| 4 | Modal 无自定义动画 | 中 | ✅ 已完成 |
| 5 | 分割线拖拽反馈弱 | 中 | ✅ 已完成 |
| 6 | 保存状态动画粗糙 | 中 | ✅ 已完成 |
| 7 | 章节选中/切换无过渡 | 低 | ✅ 已完成 |
| 8 | 空状态缺视觉层次 | 低 | ✅ 已完成 |
| 9 | 按钮点击无反馈 | 低 | ✅ 已完成 |

**动画风格**：含蓄微动（150-200ms fade + 2-4px 位移），高频操作克制，整体不抢眼

### 四-1. 路由切换过渡（高优先级）

**现状**：App.vue 已有 `page-fade-*` CSS 类但 `<RouterView />` 未包 `<Transition>`

**方案**：
1. `App.vue` → `<RouterView />` 改为 `<RouterView v-slot="{ Component }"><Transition name="page-fade" mode="out-in"><component :is="Component" /></Transition></RouterView>`
2. 已有 CSS `page-fade-enter-from { opacity:0; translateY(8px) }` → 调整为更含蓄的 `translateY(3px)` + `180ms`

**涉及文件**：
- `src/App.vue` — 修改模板 + 微调 CSS

### 四-2. 主题切换过渡（高优先级）

**现状**：`body` 有 `transition: background 0.3s`，但 `.app-header`、`.chapter-sidebar`、`.editor-toolbar` 等容器无过渡，切换时闪烁

**方案**：
1. `global.css` → 给关键容器加统一过渡类 `.theme-transition { transition: background 0.2s ease, color 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease; }`
2. 在 `themes.css` 末尾追加选择器批量应用：
   ```css
   .app-header, .chapter-sidebar, .editor-toolbar, .editor-statusbar,
   .mobile-tabs, .book-card, .home-page { transition: background 0.2s ease, color 0.2s ease, border-color 0.2s ease; }
   ```
3. Naive UI 的 `NConfigProvider` 已处理组件内部过渡，无需额外处理

**涉及文件**：
- `src/styles/themes.css` — 追加批量 transition 规则

### 四-3. 书籍卡片入场动画（中优先级）

**现状**：Home.vue `.book-grid` 中卡片直接出现，无入场效果

**方案**：
1. `Home.vue` → 卡片加 `v-for` stagger 入场：用 CSS `@keyframes card-in { from { opacity:0; transform: translateY(4px) } to { opacity:1; transform: none } }`
2. 通过 `style="{ animationDelay: index * 40ms + 'ms' }"` 实现交错
3. 加 `.card-enter { animation: card-in 180ms ease both; }` 类

**涉及文件**：
- `src/pages/Home.vue` — 修改模板 + CSS

### 四-4. Modal 自定义动画（中优先级）

**现状**：NModal 使用 Naive UI 默认 fade 动画，无缩放/滑入效果

**方案**：
1. 利用 NModal 的 `:mask-closable="true"` 已有，重点改动画
2. Naive UI NModal 不直接支持自定义 CSS 动画，但可通过 `NConfigProvider` 的 `DialogProvider` 配置
3. **简化方案**：在 `global.css` 中覆盖 `.n-modal` 的 transition：
   ```css
   .n-modal { animation: modal-in 180ms ease; }
   @keyframes modal-in { from { opacity:0; transform: scale(0.96) translateY(2px) } to { opacity:1; transform: none } }
   ```

**涉及文件**：
- `src/styles/global.css` — 追加 Modal 动画覆盖

### 四-5. 分割线拖拽反馈（中优先级）

**现状**：`.resize-handle` hover 变色为 primary，拖拽中无额外反馈

**方案**：
1. `Editor.vue` → 拖拽时给 `body` 加 `cursor: col-resize` class（通过 composable 中已有的 mousedown/mouseup 逻辑）
2. `.resize-handle` 拖拽中加宽到 6px + 加深颜色
3. `useResizable.ts` → `onSidebarDragStart` / `onSplitDragStart` 中 `document.body.style.cursor = 'col-resize'`，mouseup 时恢复

**涉及文件**：
- `src/composables/useResizable.ts` — 修改拖拽逻辑
- `src/pages/Editor.vue` — CSS 调整

### 四-6. 保存状态动画优化（中优先级）

**现状**：`.save-saving` 用 `save-pulse` 动画（opacity 1→0.4→1），视觉粗糙

**方案**：
1. 改为更含蓄的呼吸点动画：小圆点 + 渐变呼吸
2. `Editor.vue` 状态栏模板改为：
   - `idle` → 静态圆点（灰色）
   - `dirty` → 圆点变橙色 + 微呼吸
   - `saving` → 圆点变蓝色 + 旋转
   - `saved` → 圆点变绿色 + 渐隐
3. CSS 用 `::before` 伪元素画圆点，`@keyframes` 做呼吸/旋转

**涉及文件**：
- `src/pages/Editor.vue` — 修改状态栏模板 + CSS

### 四-7. 章节选中过渡（低优先级）

**现状**：`.chapter-item.active` 有 `background` 和 `color` 变化但无过渡（已有 `transition-all` 但不够精细）

**方案**：
1. `ChapterNode.vue` → `.chapter-item` 改 `transition-all` 为 `transition: background 0.15s ease, color 0.15s ease`
2. 选中项加左侧 2px `border-left` 指示条（primary 色），用 `box-shadow: inset 2px 0 0 var(--primary)` 实现

**涉及文件**：
- `src/components/editor/ChapterNode.vue` — CSS 微调

### 四-8. 空状态视觉层次（低优先级）

**现状**：Home.vue 空状态用 `NEmpty` + 单色图标，缺层次感

**方案**：
1. `Home.vue` → 空状态图标加渐变色 + 微浮动动画
2. CSS：`.empty-icon { animation: float 3s ease-in-out infinite; }` + `@keyframes float { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-4px) } }`
3. 描述文字加 `color: var(--text-secondary)` 替代默认 muted

**涉及文件**：
- `src/pages/Home.vue` — 修改空状态模板 + CSS

### 四-9. 按钮点击反馈（低优先级）

**现状**：`global.css` 有 `a, button { transition: all 0.2s ease }` 但无 active 缩放

**方案**：
1. `global.css` → 追加 `button:active { transform: scale(0.97); }` 全局微缩放
2. Naive UI 的 NButton 已有内置反馈，只需覆盖原生 button

**涉及文件**：
- `src/styles/global.css` — 追加 active 规则

---

## 五、测试 (vitest)

**结论：有必要做，但范围需控制。仅做"投入产出比高"的单元测试，可选测试不做。**

### 应做的测试（投入产出比高）

| 测试目标 | 类型 | 状态 |
|----------|------|------|
| `utils/debounce.ts` | 单元 | ✅ 已完成 |
| `utils/markdown.ts` → `renderMarkdown` / `extractTitle` | 单元 | ✅ 已完成 |
| `utils/epub.ts` → `deduplicateChapterTitle` / `prependChapterTitle` / `encodeDepth` | 单元 | ✅ 已完成 |
| `stores/editor.ts` → `wordCount` / `charCount` / `saveStatus` 状态机 | 单元 | ✅ 已完成 |
| `composables/useChapter.ts` → CRUD | 单元 | ✅ 已完成 |

### 五-0. 基础设施配置

1. `pnpm add -D vitest @vue/test-utils happy-dom`
2. 新建 `vitest.config.ts`：
   ```ts
   import { defineConfig } from 'vitest/config'
   import vue from '@vitejs/plugin-vue'
   import { fileURLToPath, URL } from 'node:url'

   export default defineConfig({
     plugins: [vue()],
     resolve: {
       alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
     },
     test: { globals: true, environment: 'happy-dom' },
   })
   ```
3. `package.json` scripts 添加 `"test": "vitest", "test:run": "vitest run"`
4. 新建 `src/__tests__/` 目录

**涉及文件**：
- `vitest.config.ts` — 新建
- `package.json` — 添加 scripts + devDependencies

### 五-1. `utils/debounce.ts` 单元测试

**测试用例**：
- 延迟调用：连续调用 N 次，仅最后一次参数生效
- `cancel()`：取消后不再触发回调
- `flush()`：立即执行，使用传入参数
- `flush()` 后 timer 被清除，后续延迟调用正常

**文件**：`src/__tests__/debounce.test.ts`

### 五-2. `utils/markdown.ts` 单元测试

**测试用例**：
- `renderMarkdown`：标题 → `<h1>` 含 `data-line`
- `renderMarkdown`：代码块高亮 → `<pre class="hljs">`
- `renderMarkdown`：全角空格预处理 → `&emsp;`
- `renderMarkdown`：em-space 缩进 → `text-indent`
- `extractTitle`：`# Title` → `"Title"`，无标题 → `""`

**文件**：`src/__tests__/markdown.test.ts`

### 五-3. `utils/epub.ts` 单元测试

**前置**：将 `deduplicateChapterTitle` / `prependChapterTitle` / `encodeDepth` 改为 `export function`

**测试用例**：
- `deduplicateChapterTitle`：标题匹配 → 去除首行 `<h1>`；不匹配 → 原样返回；无标题行 → 原样返回
- `prependChapterTitle`：depth=0 → `<h1 style="font-size:2em...">`；depth=5 → `<h6>`；depth>5 → 饱和 h6 + 0.9em
- `encodeDepth`：`("Chapter 1", 2)` → `"D2|Chapter 1"`

**文件**：`src/__tests__/epub.test.ts`

### 五-4. `stores/editor.ts` 单元测试

**前置**：需 mock `useBookStore`（`saveCurrentChapter` 方法）

**测试用例**：
- `charCount`：纯文本长度
- `wordCount`：CJK 字符计数 + 英文单词计数混合
- `saveStatus` 状态机：`idle` → `setContent` → `dirty` → (debounce) → `saving` → `saved`
- `flushSave`：dirty 状态下立即保存
- `cancelPendingSave`：取消后不触发保存

**文件**：`src/__tests__/editor.test.ts`

### 五-5. `composables/useChapter.ts` 单元测试

**前置**：需 mock Dexie `db`（用 `fake-indexeddb` + 重建 db schema，或手动 mock `db.chapters` 方法）

**测试用例**：
- `addChapter`：创建章节 → chapters 数组增加、order 递增
- `updateChapterContent`：更新后本地状态同步
- `deleteChapter`：删除父章节 → 子章节递归删除
- `reorderChapters`：order 按传入顺序重排
- `moveChapterToParent`：移到新父级 → parentId 和 order 更新

**文件**：`src/__tests__/useChapter.test.ts`

### 可选的测试（不做）

| 测试目标 | 类型 | 状态 |
|----------|------|------|
| 组件渲染快照 | 组件 | ⏭️ 跳过 |
| E2E 导出流程 | E2E | ⏭️ 跳过 |

---

## 存储方案分析结论

- **文本内容存 IndexedDB**：✅ 合理。10 万字 ≈ 300KB，100 本书 ≈ 30MB，完全没问题
- **封面图片存 IndexedDB**：⚠️ 不理想但短期可接受。base64 膨胀 33%，`loadBooks()` 会把所有封面拉到内存
- **长期建议**：Tauri 环境封面存本地文件（`@tauri-apps/plugin-fs`），meta 中只存路径；web 模式保留 base64 + 压缩。此为后续专项
- **SQLite**：过度工程，当前数据量不需要

---

## 实施分批计划

### 第一批：书籍信息设置 ✅ 已完成
- ✅ 封面图片大小限制 + 自动压缩（新建 `src/utils/image.ts`）
- ✅ 封面拖拽上传
- ✅ 表单自动保存（debounce + 保存状态指示 + 离开前 flush）
- ~~表单布局自适应~~ — 跳过，保留原布局
- 涉及文件：`src/utils/image.ts`(新建)、`src/pages/Settings.vue`、`src/i18n/zh-CN.ts`、`src/i18n/en.ts`

### 第二批：编辑器核心体验 ✅ 已完成
- ✅ 二-1 Editor.vue 拆分 composable（`useResizable`、`useChapterManager`、`useScrollSync`）
- ✅ 二-2 Ctrl+S 手动保存（flush + 状态提示）
- ✅ 二-3 工具栏分组 + 下拉折叠 + 分隔线
- ✅ 二-4 图片粘贴支持（paste → compressImage → base64 插入）
- ✅ 二-5 预览滚动同步二分查找优化
- ✅ 二-6 查找替换工具栏按钮
- ✅ 二-7 全屏模式章节抽屉

### 第三批：Tauri 产物体验 ✅ 已完成
- ✅ 三-1 窗口状态记忆（tauri-plugin-window-state）
- ✅ 三-2 动态窗口标题（App.vue watch + setTitle）
- ✅ 三-3 单实例锁（tauri-plugin-single-instance）
- ✅ 三-4 导出完成系统通知（tauri-plugin-notification）
- ⏭️ 三-5 OCR 跨平台 — 跳过
- ⏭️ 三-6 自动更新 — 跳过
- ✅ 三-7 原生菜单栏（Tauri Menu API）
- ⏭️ 三-8 文件关联 — 跳过

### 第四批：UI 视觉优化 ✅ 已完成
- ✅ 四-1 路由切换过渡（App.vue RouterView 包 Transition）
- ✅ 四-2 主题切换过渡（关键容器加 transition）
- ✅ 四-3 书籍卡片入场动画（stagger fade-in）
- ✅ 四-4 Modal 自定义动画（scale + fade 覆盖）
- ✅ 四-5 分割线拖拽反馈（cursor + 加宽）
- ✅ 四-6 保存状态动画优化（呼吸点替代 pulse）
- ✅ 四-7 章节选中过渡（左侧指示条 + 精细 transition）
- ✅ 四-8 空状态视觉层次（浮动动画 + 渐变图标）
- ✅ 四-9 按钮点击反馈（active 微缩放）
- ✅ 五-0 vitest 基础设施配置
- ✅ 五-1 debounce 单元测试
- ✅ 五-2 markdown 单元测试
- ✅ 五-3 epub 工具函数单元测试
- ✅ 五-4 editor store 单元测试
- ✅ 五-5 useChapter composable 单元测试
- ❌ 移动端章节抽屉
- ❌ 图片粘贴支持
- ❌ OCR 跨平台
- ❌ 封面存本地文件的混合存储方案
