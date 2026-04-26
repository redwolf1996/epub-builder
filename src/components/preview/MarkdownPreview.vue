<script setup lang="ts">
  import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
  import { renderMarkdown } from '@/utils/markdown'

  const props = defineProps<{
    content: string
  }>()

  const emit = defineEmits<{
    'scroll': [line: number]
  }>()

  const html = computed(() => renderMarkdown(props.content))
  const previewRef = ref<HTMLElement | null>(null)

  const previewTheme = ref<'default' | 'parchment' | 'sepia'>('default')

  const scrollToLine = (line: number, offsetY = 0) => {
    if (!previewRef.value) return
    // 查找 data-line 匹配的元素，找不到则取最近的
    let el = previewRef.value.querySelector(`[data-line="${line}"]`) as HTMLElement | null
    if (!el) {
      el = findClosestElement(line)
    }
    if (el) {
      const containerRect = previewRef.value.getBoundingClientRect()
      const elRect = el.getBoundingClientRect()
      const elOffsetFromTop = elRect.top - containerRect.top + previewRef.value.scrollTop
      // 将元素定位到与编辑器相同的偏移位置
      previewRef.value.scrollTop = elOffsetFromTop - offsetY
    }
  }

  const getDataLineElements = (): HTMLElement[] => {
    if (!previewRef.value) return []
    return Array.from(previewRef.value.querySelectorAll('[data-line]')) as HTMLElement[]
  }

  const findClosestElement = (line: number): HTMLElement | null => {
    const elements = getDataLineElements()
    if (elements.length === 0) return null
    let lo = 0, hi = elements.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (Number(elements[mid].dataset.line) < line) lo = mid + 1
      else hi = mid
    }
    // lo 是第一个 >= line 的，比较 lo 和 lo-1 谁更近
    const el = elements[lo]
    const prev = lo > 0 ? elements[lo - 1] : null
    if (!prev) return el
    const diffEl = Math.abs(Number(el.dataset.line) - line)
    const diffPrev = Math.abs(Number(prev.dataset.line) - line)
    return diffPrev <= diffEl ? prev : el
  }

  const getVisibleLine = (): number => {
    if (!previewRef.value) return 0
    const containerTop = previewRef.value.getBoundingClientRect().top
    const elements = getDataLineElements()
    if (elements.length === 0) return 0
    // 二分查找：找到第一个 top >= containerTop 的元素
    let lo = 0, hi = elements.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (elements[mid].getBoundingClientRect().top < containerTop) lo = mid + 1
      else hi = mid
    }
    // lo 是第一个进入视口的元素，但可能 lo-1 跨越视口顶部（部分可见）
    if (lo > 0) {
      const prevRect = elements[lo - 1].getBoundingClientRect()
      if (prevRect.bottom > containerTop) return Number(elements[lo - 1].dataset.line)
    }
    return Number(elements[lo].dataset.line)
  }

  let scrollRafId = 0
  const onScroll = () => {
    if (scrollRafId) return
    scrollRafId = requestAnimationFrame(() => {
      scrollRafId = 0
      emit('scroll', getVisibleLine())
    })
  }

  const cycleTheme = () => {
    const themes: Array<'default' | 'parchment' | 'sepia'> = ['default', 'parchment', 'sepia']
    const idx = themes.indexOf(previewTheme.value)
    previewTheme.value = themes[(idx + 1) % themes.length]
  }

  onMounted(() => {
    previewRef.value?.addEventListener('scroll', onScroll, { passive: true })
  })

  onBeforeUnmount(() => {
    previewRef.value?.removeEventListener('scroll', onScroll)
    if (scrollRafId) cancelAnimationFrame(scrollRafId)
  })

  defineExpose({ scrollToLine, cycleTheme, previewTheme })
</script>

<template>
  <div ref="previewRef" class="markdown-preview h-full overflow-auto p-6" :class="'theme-' + previewTheme"
    v-html="html" />
</template>

<style>
  .markdown-preview {
    color: var(--text-secondary);
    line-height: 1.8;
  }

  .markdown-preview h1 {
    font-size: 2em;
    font-weight: 700;
    margin: 0.3em 0 0.5em;
    padding-bottom: 0.3em;
    border-bottom: 1px solid var(--border-color);
    background: linear-gradient(90deg, var(--primary), var(--accent));
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
  }

  .markdown-preview h2 {
    font-size: 1.5em;
    font-weight: 600;
    margin: 0.8em 0 0.4em;
    color: var(--primary-light);
  }

  .markdown-preview h3 {
    font-size: 1.25em;
    font-weight: 600;
    margin: 0.6em 0 0.3em;
    color: var(--primary);
  }

  .markdown-preview p {
    margin: 0.5em 0;
  }

  .markdown-preview a {
    color: var(--primary);
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .markdown-preview a:hover {
    color: var(--primary-light);
  }

  .markdown-preview blockquote {
    margin: 1em 0;
    padding: 0.5em 1em;
    border-left: 4px solid var(--primary);
    background: var(--bg-hover);
    border-radius: 0 8px 8px 0;
  }

  .markdown-preview code {
    background: var(--bg-active);
    padding: 0.15em 0.4em;
    border-radius: 4px;
    font-size: 0.9em;
    font-family: 'JetBrains Mono', 'Fira Code', monospace;
  }

  .markdown-preview pre {
    margin: 1em 0;
    border-radius: 8px;
    overflow: hidden;
  }

  .markdown-preview pre.hljs {
    padding: 1em;
    background: var(--bg-elevated);
    border: 1px solid var(--border-color);
  }

  .markdown-preview pre code {
    background: transparent;
    padding: 0;
    font-size: 0.85em;
  }

  .markdown-preview table {
    width: 100%;
    border-collapse: collapse;
    margin: 1em 0;
  }

  .markdown-preview th,
  .markdown-preview td {
    padding: 0.5em 1em;
    border: 1px solid var(--border-color);
    text-align: left;
  }

  .markdown-preview th {
    background: var(--bg-hover);
    font-weight: 600;
  }

  .markdown-preview img {
    max-width: 100%;
    border-radius: 8px;
    margin: 0.5em 0;
  }

  .markdown-preview ul,
  .markdown-preview ol {
    padding-left: 1.5em;
    margin: 0.5em 0;
  }

  .markdown-preview li {
    margin: 0.25em 0;
  }

  .markdown-preview hr {
    border: none;
    height: 1px;
    background: var(--border-color);
    margin: 1.5em 0;
  }

  .markdown-preview strong {
    color: var(--text-primary);
    font-weight: 600;
  }

  .markdown-preview em {
    color: var(--primary-light);
  }

  .markdown-preview.theme-parchment {
    background: #f5e6c8;
    color: #3c2f1e;
  }

  .markdown-preview.theme-parchment h1,
  .markdown-preview.theme-parchment h2,
  .markdown-preview.theme-parchment h3 {
    -webkit-text-fill-color: unset;
    color: #5c3d1e;
  }

  .markdown-preview.theme-parchment blockquote {
    border-left-color: #8b6914;
    background: rgba(139, 105, 20, 0.08);
  }

  .markdown-preview.theme-parchment code {
    background: rgba(60, 47, 30, 0.1);
  }

  .markdown-preview.theme-parchment a {
    color: #8b6914;
  }

  .markdown-preview.theme-sepia {
    background: #f0e4d4;
    color: #4a3c2a;
  }

  .markdown-preview.theme-sepia h1,
  .markdown-preview.theme-sepia h2,
  .markdown-preview.theme-sepia h3 {
    -webkit-text-fill-color: unset;
    color: #6b4c2a;
  }

  .markdown-preview.theme-sepia blockquote {
    border-left-color: #a0784c;
    background: rgba(160, 120, 76, 0.08);
  }

  .markdown-preview.theme-sepia code {
    background: rgba(74, 60, 42, 0.1);
  }

  .markdown-preview.theme-sepia a {
    color: #a0784c;
  }
</style>
