---
name: tauri-build
description: 指导 Tauri v2 桌面应用打包配置，包含 tauri.conf.json 设置、Rust 依赖、平台打包命令
---

## Tauri v2 集成指南

### 初始化
1. `pnpm add -D @tauri-apps/cli@^2`
2. `pnpm tauri init` 生成 src-tauri 目录
3. Rust 依赖：@tauri-apps/api (前端), tauri (Rust 端)

### tauri.conf.json 关键配置
- identifier: com.epub-builder.app
- window.title: EPUB Builder
- window.width/height: 1280/800
- window.resizable: true
- window.fullscreen: false
- build.devUrl: http://localhost:5173
- build.frontendDist: ../dist

### 前端 API 适配
- 文件保存：使用 @tauri-apps/api/dialog 的 save() + @tauri-apps/api/fs 的 writeBinaryFile()
- 窗口控制：使用 @tauri-apps/api/window
- 判断环境：使用 `window.__TAURI_INTERNALS__` 检测是否在 Tauri 中运行

### 打包命令
- `pnpm tauri build` 生成安装包
- Windows: .msi / .exe (NSIS)
- macOS: .dmg / .app
- Linux: .deb / .AppImage

### 注意事项
- 确保 vite build 先完成
- 图标需放在 src-tauri/icons/
- CSP 策略需允许 data: URL（封面图片）
