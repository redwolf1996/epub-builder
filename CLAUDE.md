# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

EPUB Builder is a Tauri v2 desktop app for creating ePUB books from Markdown. The frontend is Vite + Vue 3 + TypeScript, the backend is Rust. All data is stored client-side in IndexedDB via Dexie.js.

## Commands

```bash
pnpm dev              # Vite dev server (port 7777, 127.0.0.1)
pnpm td               # Tauri dev (runs sync:version then tauri dev)
pnpm tb               # Tauri build MSI
pnpm build            # Type-check + production build
pnpm lint             # oxlint
pnpm format           # oxfmt
pnpm test             # vitest (watch)
pnpm test:run         # vitest (single run)
pnpm sync:version     # Sync version from package.json to tauri conf
```

## Tech stack and conventions

See `AGENTS.md` for full coding conventions. Key points:

- **Frontend**: Vue 3 Composition API (`<script setup lang="ts">`), Naive UI, UnoCSS (no SCSS), Pinia, CodeMirror 6, markdown-it, epub-gen-memory, Dexie.js
- **Backend (Rust)**: Tauri v2 with plugins (dialog, fs, clipboard, notification, window-state, single-instance). PDF export via `lopdf`, image merging via `image` crate, OCR via Doubao desktop automation
- **Package manager**: pnpm only (no npm/yarn/npx)
- **Code style**: single quotes, no semicolons, strict TypeScript (no `any`), oxfmt + oxlint
- **Resolver alias**: `@` maps to `src/`, `path` maps to `path-browserify`, `fs` maps to a browser shim

## Architecture

### Routes (Vue Router, web history mode)

| Path | Page | Purpose |
|------|------|---------|
| `/` | Home.vue | Book list, create/delete books |
| `/editor/:id` | Editor.vue | Chapter tree + CodeMirror + live preview |
| `/settings/:id` | Settings.vue | Book metadata (title, author, cover, etc.) |

### Data layer

**IndexedDB** (`src/db/index.ts`): Three tables — `books`, `chapters` (hierarchical via `parentId`), `assets`. All access goes through composables.

**Pinia stores** (`src/stores/`):
- `bookStore` — book CRUD, chapter tree, current chapter selection. Wraps `useBook` + `useChapter` composables
- `editorStore` — current editor content, auto-save (500ms debounce via IndexedDB), preview toggle
- `themeStore` — light/dark/system theme

**Composables** (`src/composables/`):
- `useBook` / `useChapter` — low-level Dexie operations
- `useChapterManager` — chapter tree mutations (add/delete/reorder/move)
- `useEpub` — build and export EPUB via `epub-gen-memory`
- `useExport` — orchestrate EPUB/PDF/Markdown/Word exports
- `useImport` — orchestrate imports from Markdown/EPUB/PDF/Word
- `useScrollSync` — sync CodeMirror scroll with markdown preview
- `useResizable` — drag-to-resize panels in editor

### Import pipeline (`src/utils/import*.ts`)

Each format has its own parser (Markdown, EPUB, PDF, Word/docx) that produces a unified `ImportDocument` with sections, metadata, warnings, and asset references. PDF uses `pdfjs-dist` (with `enableMENTSEN=1` compat for legacy browsers). Word uses `mammoth`.

### Export pipeline (`src/utils/export*.ts`, `src/utils/epub.ts`)

EPUB generation uses `epub-gen-memory`; PDF goes through Rust (`lopdf` in `src-tauri/src/pdf_export.rs`); Word exports via the `docx` npm package.

### Tauri backend (`src-tauri/src/`)

- `lib.rs` — app setup, plugin registration, command handlers. Also contains image merging logic (for OCR pre-processing) with size/height limits
- `doubao.rs` — OCR automation via Doubao desktop app (Windows UIA)
- `pdf_export.rs` — PDF file export using `lopdf`

Commands exposed to the frontend: `open_devtools`, `open_external_target`, `start_doubao_ocr_session`, `cancel_doubao_ocr_session`, `check_doubao_executable`, `check_doubao_running`, `check_merge_images`, `merge_images`, `export_pdf`, `delete_merged_temp_file`, `toggle_menu`

Native menu events (emitted to webview as `menu-event`): `new_book`, `export_epub`, `find_replace`, `toggle_theme`, `app_fullscreen`, `toggle_scroll_sync`, `about`

### i18n

`vue-i18n` with two locales: `zh-CN` (default) and `en` (`src/i18n/`). Locale preference persisted via `themeStore`.

### Key editor components

- `CodeMirrorEditor.vue` — CodeMirror 6 with markdown language support, one-dark theme, search panel
- `ChapterNode.vue` — draggable chapter tree nodes (via `vue-draggable-plus`)
- `MarkdownPreview.vue` — rendered preview with scroll sync
