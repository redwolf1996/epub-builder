---
name: epub-export
description: 指导 EPUB 电子书导出流程，包含 markdown-it 转 HTML、epub-gen-memory 配置、封面图片处理和文件下载
---

## EPUB 导出流程

### 数据准备
1. 从 Dexie.js 读取书籍元信息（title, author, description, coverImage, language）
2. 读取该书所有章节，按 order 排序
3. 每个章节的 Markdown 内容通过 markdown-it 转为 HTML

### epub-gen-memory 配置
- title: 书籍标题
- author: 作者
- description: 简介
- cover: 封面图片（Base64 data URL 或 URL）
- content: 章节数组 [{ title, data (HTML), authorBefore, authorAfter }]
- css: 自定义 EPUB 样式

### 封面图片处理
- IndexedDB 中存储为 Base64 字符串
- 传给 epub-gen-memory 时使用 data URL 格式：`data:image/png;base64,...`

### 文件下载
- Web 端：使用 Blob + URL.createObjectURL + <a> 触发下载
- Tauri 端：使用 @tauri-apps/api/dialog 的 save() 选择保存路径，再用 @tauri-apps/api/fs 写入文件

### 错误处理
- 无章节时提示用户
- 封面图片过大时压缩
- 导出失败时显示具体错误信息
