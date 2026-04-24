# EPUB Builder 项目规范

## 技术栈
- Vite 6 + Vue 3 + TypeScript (strict, 禁止 any)
- Naive UI + UnoCSS + 现代 CSS（禁止 SCSS）
- CodeMirror 6 + markdown-it + epub-gen-memory
- Dexie.js (IndexedDB) + Pinia
- Tauri v2
- 包管理器：pnpm

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

## 数据层
- 使用 Dexie.js 操作 IndexedDB
- 自动保存需 debounce 500ms
- 所有数据操作通过 composable 封装
