import { type Ref } from 'vue'
import type CodeMirrorEditor from '@/components/editor/CodeMirrorEditor.vue'
import type MarkdownPreview from '@/components/preview/MarkdownPreview.vue'

type CmEditorRef = InstanceType<typeof CodeMirrorEditor>
type PreviewRef = InstanceType<typeof MarkdownPreview>

export function useScrollSync(
  cmEditorRef: Ref<CmEditorRef | null>,
  previewRef: Ref<PreviewRef | null>,
  syncScroll: Ref<boolean>,
) {
  let scrollSource: 'editor' | 'preview' | null = null
  let scrollTimer: ReturnType<typeof setTimeout> | null = null

  const clearScrollSource = () => {
    scrollSource = null
    scrollTimer = null
  }

  const handleEditorScroll = (info: { line: number; offsetY: number }) => {
    if (!syncScroll.value) return
    if (scrollSource === 'preview') return
    scrollSource = 'editor'
    if (scrollTimer) clearTimeout(scrollTimer)
    scrollTimer = setTimeout(clearScrollSource, 50)
    previewRef.value?.scrollToLine(info.line, info.offsetY)
  }

  const handlePreviewScroll = (line: number) => {
    if (!syncScroll.value) return
    if (scrollSource === 'editor') return
    scrollSource = 'preview'
    if (scrollTimer) clearTimeout(scrollTimer)
    scrollTimer = setTimeout(clearScrollSource, 50)
    cmEditorRef.value?.scrollToLine(line)
  }

  return {
    handleEditorScroll,
    handlePreviewScroll,
  }
}
