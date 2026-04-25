<script setup lang="ts">
  import { onMounted, onBeforeUnmount, watch, shallowRef } from 'vue'
  import { EditorState } from '@codemirror/state'
  import { EditorView, keymap, lineNumbers, highlightActiveLineGutter, highlightActiveLine, drawSelection, rectangularSelection, highlightSpecialChars } from '@codemirror/view'
  import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
  import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
  import { defaultHighlightStyle, syntaxHighlighting, HighlightStyle, bracketMatching, foldGutter, foldKeymap } from '@codemirror/language'
  import { closeBrackets, closeBracketsKeymap, autocompletion, completionKeymap } from '@codemirror/autocomplete'
  import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
  import { oneDarkHighlightStyle } from '@codemirror/theme-one-dark'
  import { tags } from '@lezer/highlight'

  const props = defineProps<{
    modelValue: string
  }>()

  const emit = defineEmits<{
    'update:modelValue': [value: string]
  }>()

  const editorRef = shallowRef<EditorView | null>(null)
  const containerRef = shallowRef<HTMLElement | null>(null)

  const markdownHighlightStyle = HighlightStyle.define([
    { tag: tags.heading1, color: '#e06c75', fontWeight: '700', fontSize: '1.4em' },
    { tag: tags.heading2, color: '#e06c75', fontWeight: '700', fontSize: '1.2em' },
    { tag: tags.heading3, color: '#c678dd', fontWeight: '600', fontSize: '1.1em' },
    { tag: tags.heading4, color: '#c678dd', fontWeight: '600' },
    { tag: tags.heading5, color: '#61afef', fontWeight: '600' },
    { tag: tags.heading6, color: '#61afef', fontWeight: '600' },
    { tag: tags.strong, color: '#d19a66', fontWeight: '700' },
    { tag: tags.emphasis, color: '#c678dd', fontStyle: 'italic' },
    { tag: tags.link, color: '#61afef', textDecoration: 'underline' },
    { tag: tags.url, color: '#61afef' },
    { tag: tags.monospace, color: '#98c379', backgroundColor: 'rgba(152, 195, 121, 0.1)' },
    { tag: tags.quote, color: '#5c6370', fontStyle: 'italic' },
    { tag: tags.strikethrough, textDecoration: 'line-through', color: '#5c6370' },
    { tag: tags.processingInstruction, color: '#56b6c2' },
    { tag: tags.meta, color: '#5c6370' },
    { tag: tags.comment, color: '#5c6370', fontStyle: 'italic' },
  ])

  const editorTheme = EditorView.theme({
    '&': {
      fontSize: '14px',
    },
    '.cm-line, .cm-gutters': {
      fontFamily: "'Microsoft YaHei', '微软雅黑', sans-serif",
    },
    '.cm-content': {
      padding: '16px 0',
      caretColor: '#6c63ff',
    },
    '.cm-gutters': {
      backgroundColor: 'color-mix(in srgb, var(--bg-surface) 60%, transparent)',
      borderRight: '1px solid var(--border-color)',
      color: 'var(--text-secondary)',
      minWidth: '3em',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'var(--bg-active)',
      color: 'var(--text-primary)',
      fontWeight: '600',
    },
    '.cm-activeLine': {
      backgroundColor: 'var(--bg-active)',
    },
    '.cm-selectionBackground': {
      backgroundColor: 'var(--selection-bg) !important',
    },
    '&.cm-focused .cm-selectionBackground': {
      backgroundColor: 'var(--selection-bg) !important',
    },
    '.cm-cursor': {
      borderLeftColor: 'var(--primary)',
      borderLeftWidth: '2px',
    },
    '.cm-line': {
      color: 'var(--text-primary)',
    },
  })

  onMounted(() => {
    if (!containerRef.value) return

    const state = EditorState.create({
      doc: props.modelValue,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        foldGutter(),
        drawSelection(),
        rectangularSelection(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        bracketMatching(),
        closeBrackets(),
        autocompletion(),
        keymap.of([
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...foldKeymap,
          ...completionKeymap,
          indentWithTab,
        ]),
        markdown({ base: markdownLanguage }),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        syntaxHighlighting(oneDarkHighlightStyle),
        syntaxHighlighting(markdownHighlightStyle),
        editorTheme,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            emit('update:modelValue', update.state.doc.toString())
          }
        }),
        EditorView.lineWrapping,
      ],
    })

    editorRef.value = new EditorView({
      state,
      parent: containerRef.value,
    })
  })

  onBeforeUnmount(() => {
    editorRef.value?.destroy()
  })

  watch(
    () => props.modelValue,
    (newVal) => {
      if (!editorRef.value) return
      const currentVal = editorRef.value.state.doc.toString()
      if (newVal !== currentVal) {
        editorRef.value.dispatch({
          changes: {
            from: 0,
            to: editorRef.value.state.doc.length,
            insert: newVal,
          },
        })
      }
    },
  )

  defineExpose({
    focus: () => editorRef.value?.focus(),
    insertText: (text: string) => {
      if (!editorRef.value) return
      const { from, to } = editorRef.value.state.selection.main
      editorRef.value.dispatch({
        changes: { from, to, insert: text },
        selection: { anchor: from + text.length },
      })
      editorRef.value.focus()
    },
    wrapSelection: (before: string, after: string) => {
      if (!editorRef.value) return
      const { from, to } = editorRef.value.state.selection.main
      const selected = editorRef.value.state.sliceDoc(from, to)
      editorRef.value.dispatch({
        changes: { from, to, insert: before + selected + after },
        selection: { anchor: from + before.length, head: from + before.length + selected.length },
      })
      editorRef.value.focus()
    },
  })
</script>

<template>
  <div ref="containerRef" class="cm-editor-container h-full overflow-hidden" />
</template>

<style>
  .cm-editor-container .cm-editor {
    height: 100%;
    background: transparent;
  }

  .cm-editor-container .cm-editor .cm-scroller {
    overflow: auto;
  }

  .cm-editor-container .cm-editor.cm-focused {
    outline: none;
  }
</style>
