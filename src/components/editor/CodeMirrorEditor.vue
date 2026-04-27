<script setup lang="ts">
  import { onMounted, onBeforeUnmount, watch, shallowRef } from 'vue'
  import { compressImage } from '@/utils/image'
  import { EditorState, RangeSetBuilder } from '@codemirror/state'
  import { EditorView, keymap, lineNumbers, highlightActiveLineGutter, highlightActiveLine, drawSelection, rectangularSelection, highlightSpecialChars, ViewPlugin, Decoration, WidgetType, type ViewUpdate, type DecorationSet } from '@codemirror/view'
  import { defaultKeymap, history, historyKeymap, indentWithTab, redo } from '@codemirror/commands'
  import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
  import { defaultHighlightStyle, syntaxHighlighting, HighlightStyle, bracketMatching, foldGutter, foldKeymap } from '@codemirror/language'
  import { closeBrackets, closeBracketsKeymap, autocompletion, completionKeymap } from '@codemirror/autocomplete'
  import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
  import { oneDarkHighlightStyle } from '@codemirror/theme-one-dark'
  import { tags } from '@lezer/highlight'
  import type { LineAnchor, ScrollSnapshot } from '@/composables/useScrollSync'

  const props = defineProps<{
    modelValue: string
  }>()

  const editorRef = shallowRef<EditorView | null>(null)
  const containerRef = shallowRef<HTMLElement | null>(null)

  const emit = defineEmits<{
    'update:modelValue': [value: string]
    scroll: []
  }>()

  const dimTag = Decoration.mark({ class: 'cm-color-span-dim' })
  const colorSpanPlugin = ViewPlugin.fromClass(class {
    decorations: DecorationSet = Decoration.none
    constructor(view: EditorView) { this.build(view) }
    update(update: ViewUpdate) { if (update.docChanged) this.build(update.view) }
    build(view: EditorView) {
      const builder = new RangeSetBuilder<Decoration>()
      const doc = view.state.doc.toString()
      const re = /<(span)\s+style="([^"]+)">(.*?)<\/\1>/g
      let m: RegExpExecArray | null
      while ((m = re.exec(doc)) !== null) {
        const styleStr = m[2]
        const colorMatch = styleStr.match(/color:\s*([^;"]+)/)
        const bgColorMatch = styleStr.match(/background-color:\s*([^;"]+)/)
        if (!colorMatch && !bgColorMatch) continue
        const openTagStart = m.index
        const openTagEnd = m.index + m[0].indexOf('>') + 1
        const closeTagStart = m.index + m[0].lastIndexOf('<')
        const closeTagEnd = m.index + m[0].length
        builder.add(openTagStart, openTagEnd, dimTag)
        const css: string[] = []
        if (colorMatch) css.push(`color:${colorMatch[1]}`)
        if (bgColorMatch) css.push(`background-color:${bgColorMatch[1]}`)
        if (css.length > 0) {
          builder.add(openTagEnd, closeTagStart, Decoration.mark({ attributes: { style: css.join(';') } }))
        }
        builder.add(closeTagStart, closeTagEnd, dimTag)
      }
      this.decorations = builder.finish()
    }
  }, { decorations: (v) => v.decorations })

  const base64FoldPlugin = ViewPlugin.fromClass(class {
    decorations: DecorationSet = Decoration.none
    constructor(view: EditorView) { this.build(view) }
    update(update: ViewUpdate) { if (update.docChanged || update.viewportChanged) this.build(update.view) }
    build(view: EditorView) {
      const builder = new RangeSetBuilder<Decoration>()
      const doc = view.state.doc.toString()
      const re = /data:image\/[a-z+]+;base64,[\w+/=]+/g
      let m: RegExpExecArray | null
      while ((m = re.exec(doc)) !== null) {
        const from = m.index
        const to = m.index + m[0].length
        const sel = view.state.selection.main
        if (sel.from >= from && sel.to <= to) continue
        builder.add(from, to, Decoration.replace({
          widget: new Base64Placeholder(),
        }))
      }
      this.decorations = builder.finish()
    }
  }, { decorations: (v) => v.decorations })

  class Base64Placeholder extends WidgetType {
    toDOM() {
      const span = document.createElement('span')
      span.className = 'cm-base64-folded'
      span.textContent = '馃搸 base64 image'
      return span
    }
    ignoreEvent() { return false }
  }

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
      fontFamily: "'Microsoft YaHei', '寰蒋闆呴粦', sans-serif",
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

  function createExtensions() {
    return [
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
        { key: 'Mod-y', run: redo, preventDefault: true },
        { key: 'Mod-Shift-z', run: redo, preventDefault: true },
        { key: 'Mod-b', run: (v) => { const { from, to } = v.state.selection.main; const sel = v.state.sliceDoc(from, to); v.dispatch({ changes: { from, to, insert: '**' + sel + '**' }, selection: { anchor: from + 2, head: from + 2 + sel.length } }); return true } },
        { key: 'Mod-i', run: (v) => { const { from, to } = v.state.selection.main; const sel = v.state.sliceDoc(from, to); v.dispatch({ changes: { from, to, insert: '*' + sel + '*' }, selection: { anchor: from + 1, head: from + 1 + sel.length } }); return true } },
        { key: 'Mod-h', run: (v) => { const { from } = v.state.selection.main; v.dispatch({ changes: { from, insert: '## ' }, selection: { anchor: from + 3 } }); return true } },
      ]),
      markdown({ base: markdownLanguage }),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      syntaxHighlighting(oneDarkHighlightStyle),
      syntaxHighlighting(markdownHighlightStyle),
      editorTheme,
      colorSpanPlugin,
      base64FoldPlugin,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          emit('update:modelValue', update.state.doc.toString())
        }
      }),
      EditorView.lineWrapping,
      EditorView.domEventHandlers({
        paste(event) {
          const files = event.clipboardData?.files
          if (!files || files.length === 0) return
          const file = Array.from(files).find((f) => f.type.startsWith('image/'))
          if (!file) return
          event.preventDefault()
          compressImage(file).then((dataUrl) => {
            if (!editorRef.value) return
            const { from, to } = editorRef.value.state.selection.main
            const text = `![${file.name.replace(/\.[^.]+$/, '')}](${dataUrl})`
            editorRef.value.dispatch({
              changes: { from, to, insert: text },
              selection: { anchor: from + text.length },
            })
            editorRef.value.focus()
          })
        },
      }),
    ]
  }

  const getEditorScroller = (): HTMLElement | null => {
    return editorRef.value?.scrollDOM ?? null
  }

  onMounted(() => {
    if (!containerRef.value) return

    const state = EditorState.create({
      doc: props.modelValue,
      extensions: createExtensions(),
    })

    editorRef.value = new EditorView({
      state,
      parent: containerRef.value,
    })

    getEditorScroller()?.addEventListener('scroll', onEditorScroll, { passive: true })
  })

  onBeforeUnmount(() => {
    getEditorScroller()?.removeEventListener('scroll', onEditorScroll)
    if (scrollRafId) cancelAnimationFrame(scrollRafId)
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

  function isMarkdownLine(text: string): boolean {
    return /^[#>*+\-`|~!\[_]|^\d+[.]|^(\*{2,}|_{2,})/.test(text)
  }

  let scrollRafId = 0
  const onEditorScroll = () => {
    if (scrollRafId) return
    scrollRafId = requestAnimationFrame(() => {
      scrollRafId = 0
      emit('scroll')
    })
  }

  const getScrollSnapshot = (): ScrollSnapshot | null => {
    const scroller = getEditorScroller()
    if (!scroller) return null

    return {
      scrollTop: scroller.scrollTop,
      viewportHeight: scroller.clientHeight,
      contentHeight: scroller.scrollHeight,
    }
  }

  const getPositionMap = (): LineAnchor[] => {
    if (!editorRef.value) return []

    return editorRef.value.viewportLineBlocks.map((block) => ({
      line: editorRef.value!.state.doc.lineAt(block.from).number,
      top: block.top,
      bottom: block.bottom,
    }))
  }

  const setScrollTop = (top: number) => {
    const scroller = getEditorScroller()
    if (!scroller) return
    scroller.scrollTop = top
  }

  defineExpose({
    getScrollSnapshot,
    getPositionMap,
    setScrollTop,
    scrollToLine: (line: number) => {
      if (!editorRef.value) return
      const safeLine = Math.min(Math.max(line, 1), editorRef.value.state.doc.lines)
      const pos = editorRef.value.state.doc.line(safeLine).from
      editorRef.value.dispatch({
        effects: EditorView.scrollIntoView(pos, { y: 'start' }),
      })
    },
    loadContent: (content: string) => {
      if (!editorRef.value) return
      const state = EditorState.create({
        doc: content,
        extensions: createExtensions(),
      })
      editorRef.value.setState(state)
    },
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
    indentSelection: () => {
      if (!editorRef.value) return
      const view = editorRef.value
      const { from, to } = view.state.selection.main
      const startLine = view.state.doc.lineAt(from).number
      const endLine = view.state.doc.lineAt(to).number
      const indent = '\u3000\u3000'
      const changes: { from: number; to: number; insert: string }[] = []
      for (let n = startLine; n <= endLine; n++) {
        const line = view.state.doc.line(n)
        if (line.text.length === 0) continue
        if (line.text.startsWith(indent)) continue
        if (isMarkdownLine(line.text)) continue
        changes.push({ from: line.from, to: line.from, insert: indent })
      }
      if (changes.length === 0) { view.focus(); return }
      view.dispatch({
        changes,
        selection: { anchor: to + changes.reduce((sum, c) => sum + c.insert.length, 0) },
      })
      view.focus()
    },
    indentAll: () => {
      if (!editorRef.value) return
      const view = editorRef.value
      const indent = '\u3000\u3000'
      const changes: { from: number; to: number; insert: string }[] = []
      for (let n = 1; n <= view.state.doc.lines; n++) {
        const line = view.state.doc.line(n)
        if (line.text.length === 0) continue
        if (line.text.startsWith(indent)) continue
        if (isMarkdownLine(line.text)) continue
        changes.push({ from: line.from, to: line.from, insert: indent })
      }
      if (changes.length === 0) { view.focus(); return }
      const { head } = view.state.selection.main
      const linesBefore = changes.filter(c => c.from <= head).length
      view.dispatch({
        changes,
        selection: { anchor: head + linesBefore * indent.length },
      })
      view.focus()
    },
    dedentSelection: () => {
      if (!editorRef.value) return
      const view = editorRef.value
      const { from, to } = view.state.selection.main
      const startLine = view.state.doc.lineAt(from).number
      const endLine = view.state.doc.lineAt(to).number
      const indent = '\u3000\u3000'
      const changes: { from: number; to: number; insert: string }[] = []
      for (let n = startLine; n <= endLine; n++) {
        const line = view.state.doc.line(n)
        if (line.text.startsWith(indent)) {
          changes.push({ from: line.from, to: line.from + indent.length, insert: '' })
        } else if (line.text.startsWith('\u3000')) {
          changes.push({ from: line.from, to: line.from + 1, insert: '' })
        }
      }
      if (changes.length === 0) { view.focus(); return }
      const removed = changes.reduce((sum, c) => sum + (c.to - c.from), 0)
      view.dispatch({
        changes,
        selection: { anchor: Math.max(from - removed, 0) },
      })
      view.focus()
    },
    dedentAll: () => {
      if (!editorRef.value) return
      const view = editorRef.value
      const indent = '\u3000\u3000'
      const changes: { from: number; to: number; insert: string }[] = []
      for (let n = 1; n <= view.state.doc.lines; n++) {
        const line = view.state.doc.line(n)
        if (line.text.startsWith(indent)) {
          changes.push({ from: line.from, to: line.from + indent.length, insert: '' })
        } else if (line.text.startsWith('\u3000')) {
          changes.push({ from: line.from, to: line.from + 1, insert: '' })
        }
      }
      if (changes.length === 0) { view.focus(); return }
      const { head } = view.state.selection.main
      const removedBefore = changes.filter(c => c.to <= head).reduce((sum, c) => sum + (c.to - c.from), 0)
      view.dispatch({
        changes,
        selection: { anchor: Math.max(head - removedBefore, 0) },
      })
      view.focus()
    },
    setFontSize: (size: number) => {
      if (!editorRef.value) return
      const el = editorRef.value.dom.querySelector('.cm-content') as HTMLElement | null
      if (el) el.style.fontSize = `${size}px`
    },
    openSearch: () => {
      if (!editorRef.value) return
      import('@codemirror/search').then(({ openSearchPanel }) => {
        if (editorRef.value) openSearchPanel(editorRef.value)
      })
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

  .cm-color-span-dim {
    opacity: 0.35;
    font-size: 0.85em;
  }

  .cm-base64-folded {
    background: color-mix(in srgb, var(--primary) 15%, transparent);
    color: var(--primary);
    border-radius: 3px;
    padding: 0 4px;
    font-size: 0.85em;
    cursor: pointer;
    user-select: none;
  }
</style>
