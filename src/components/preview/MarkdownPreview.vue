<script setup lang="ts">
import { computed } from 'vue'
import { renderMarkdown } from '@/utils/markdown'

const props = defineProps<{
  content: string
}>()

const html = computed(() => renderMarkdown(props.content))
</script>

<template>
  <div class="markdown-preview h-full overflow-auto p-6" v-html="html" />
</template>

<style>
.markdown-preview {
  color: var(--text-primary);
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
</style>
