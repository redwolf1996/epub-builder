<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { renderMarkdown } from '@/utils/markdown'
import type { LineAnchor, ScrollSnapshot } from '@/composables/useScrollSync'

const props = defineProps<{
  content: string
}>()

const emit = defineEmits<{
  scroll: []
}>()

const html = computed(() => renderMarkdown(props.content))
const previewRef = ref<HTMLElement | null>(null)
const dataLineElements = ref<HTMLElement[]>([])

const rebuildDataLineElements = async () => {
  await nextTick()
  if (!previewRef.value) {
    dataLineElements.value = []
    return
  }

  dataLineElements.value = Array.from(previewRef.value.querySelectorAll('[data-line]')) as HTMLElement[]
}

const findClosestElement = (line: number): HTMLElement | null => {
  const elements = dataLineElements.value
  if (elements.length === 0) return null

  let lo = 0
  let hi = elements.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (Number(elements[mid].dataset.line) < line) lo = mid + 1
    else hi = mid
  }

  const current = elements[lo]
  const previous = lo > 0 ? elements[lo - 1] : null
  if (!previous) return current

  const currentDiff = Math.abs(Number(current.dataset.line) - line)
  const previousDiff = Math.abs(Number(previous.dataset.line) - line)
  return previousDiff <= currentDiff ? previous : current
}

const scrollToLine = (line: number, offsetY = 0) => {
  if (!previewRef.value) return

  const exact = dataLineElements.value.find((element) => Number(element.dataset.line) === line) ?? null
  const element = exact || findClosestElement(line)
  if (!element) return

  const containerRect = previewRef.value.getBoundingClientRect()
  const elementRect = element.getBoundingClientRect()
  const elementOffsetFromTop = elementRect.top - containerRect.top + previewRef.value.scrollTop
  previewRef.value.scrollTop = elementOffsetFromTop - offsetY
}

const getScrollSnapshot = (): ScrollSnapshot | null => {
  if (!previewRef.value) return null

  return {
    scrollTop: previewRef.value.scrollTop,
    viewportHeight: previewRef.value.clientHeight,
    contentHeight: previewRef.value.scrollHeight,
  }
}

const getPositionMap = (): LineAnchor[] => {
  if (!previewRef.value) return []

  const containerRect = previewRef.value.getBoundingClientRect()
  const containerScrollTop = previewRef.value.scrollTop

  return dataLineElements.value
    .map((element) => {
      const line = Number(element.dataset.line)
      if (!Number.isFinite(line)) return null

      const rect = element.getBoundingClientRect()
      const top = rect.top - containerRect.top + containerScrollTop
      const bottom = rect.bottom - containerRect.top + containerScrollTop
      return { line, top, bottom }
    })
    .filter((anchor): anchor is LineAnchor => anchor !== null)
}

const setScrollTop = (top: number) => {
  if (!previewRef.value) return
  previewRef.value.scrollTop = top
}

let scrollRafId = 0
const onScroll = () => {
  if (scrollRafId) return
  scrollRafId = requestAnimationFrame(() => {
    scrollRafId = 0
    emit('scroll')
  })
}

onMounted(async () => {
  await rebuildDataLineElements()
  previewRef.value?.addEventListener('scroll', onScroll, { passive: true })
})

onBeforeUnmount(() => {
  previewRef.value?.removeEventListener('scroll', onScroll)
  if (scrollRafId) cancelAnimationFrame(scrollRafId)
})

watch(html, () => {
  void rebuildDataLineElements()
})

defineExpose({
  scrollToLine,
  getScrollSnapshot,
  getPositionMap,
  setScrollTop,
})
</script>

<template>
  <div ref="previewRef" class="markdown-preview h-full overflow-auto p-6" v-html="html" />
</template>

<style>
.markdown-preview {
  color: var(--text-secondary);
  line-height: 1.8;
  background: color-mix(in srgb, var(--bg-surface) 92%, #fff 8%);
}

[data-theme='dark'] .markdown-preview {
  background: color-mix(in srgb, var(--bg-surface) 80%, #fff 20%);
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

[data-theme='parchment'] .markdown-preview h1,
[data-theme='parchment'] .markdown-preview h2,
[data-theme='parchment'] .markdown-preview h3 {
  -webkit-text-fill-color: unset;
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
</style>
