import { type Ref } from 'vue'
import type CodeMirrorEditor from '@/components/editor/CodeMirrorEditor.vue'
import type MarkdownPreview from '@/components/preview/MarkdownPreview.vue'

export interface LineAnchor {
  line: number
  top: number
  bottom: number
}

export interface ScrollSnapshot {
  scrollTop: number
  viewportHeight: number
  contentHeight: number
}

type ScrollSyncHandle = {
  getScrollSnapshot: () => ScrollSnapshot | null
  getPositionMap: () => LineAnchor[]
  setScrollTop: (top: number) => void
  scrollToLine?: (line: number, offsetY?: number) => void
}

type CmEditorRef = InstanceType<typeof CodeMirrorEditor> & ScrollSyncHandle
type PreviewRef = InstanceType<typeof MarkdownPreview> & ScrollSyncHandle

function getMaxScrollTop(snapshot: ScrollSnapshot): number {
  return Math.max(snapshot.contentHeight - snapshot.viewportHeight, 0)
}

export function clampScrollTop(scrollTop: number, snapshot: ScrollSnapshot): number {
  return Math.min(Math.max(scrollTop, 0), getMaxScrollTop(snapshot))
}

function getScrollRatio(snapshot: ScrollSnapshot): number {
  const maxScrollTop = getMaxScrollTop(snapshot)
  if (maxScrollTop === 0) return 0
  return snapshot.scrollTop / maxScrollTop
}

export function findClosestAnchorIndexByLine(anchors: LineAnchor[], line: number): number {
  if (anchors.length === 0) return -1

  let lo = 0
  let hi = anchors.length - 1

  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (anchors[mid].line < line) lo = mid + 1
    else hi = mid
  }

  const current = anchors[lo]
  const previous = lo > 0 ? anchors[lo - 1] : null
  if (!previous) return lo

  return Math.abs(previous.line - line) <= Math.abs(current.line - line) ? lo - 1 : lo
}

function findAnchorIndexByScrollTop(anchors: LineAnchor[], scrollTop: number): number {
  if (anchors.length === 0) return -1

  let lo = 0
  let hi = anchors.length - 1

  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2)
    if (anchors[mid].top <= scrollTop) lo = mid
    else hi = mid - 1
  }

  return lo
}

export function calculateSyncedScrollTop(
  sourceSnapshot: ScrollSnapshot,
  sourceAnchors: LineAnchor[],
  targetSnapshot: ScrollSnapshot,
  targetAnchors: LineAnchor[],
): { scrollTop: number; fallbackLine: number | null } {
  if (sourceAnchors.length === 0 || targetAnchors.length === 0) {
    const targetMaxScrollTop = getMaxScrollTop(targetSnapshot)
    return {
      scrollTop: clampScrollTop(getScrollRatio(sourceSnapshot) * targetMaxScrollTop, targetSnapshot),
      fallbackLine: null,
    }
  }

  const sourceIndex = findAnchorIndexByScrollTop(sourceAnchors, sourceSnapshot.scrollTop)
  if (sourceIndex === -1) {
    return {
      scrollTop: clampScrollTop(getScrollRatio(sourceSnapshot) * getMaxScrollTop(targetSnapshot), targetSnapshot),
      fallbackLine: null,
    }
  }

  const sourceAnchor = sourceAnchors[sourceIndex]
  const sourceNextAnchor = sourceAnchors[sourceIndex + 1] ?? null
  const targetIndex = findClosestAnchorIndexByLine(targetAnchors, sourceAnchor.line)
  if (targetIndex === -1) {
    return {
      scrollTop: clampScrollTop(getScrollRatio(sourceSnapshot) * getMaxScrollTop(targetSnapshot), targetSnapshot),
      fallbackLine: sourceAnchor.line,
    }
  }

  const targetAnchor = targetAnchors[targetIndex]
  const targetNextAnchor = targetAnchors[targetIndex + 1] ?? null

  const sourceIntervalEnd = sourceNextAnchor
    ? Math.max(sourceNextAnchor.top, sourceAnchor.bottom)
    : sourceAnchor.bottom
  const targetIntervalEnd = targetNextAnchor
    ? Math.max(targetNextAnchor.top, targetAnchor.bottom)
    : targetAnchor.bottom

  const sourceIntervalHeight = Math.max(sourceIntervalEnd - sourceAnchor.top, 1)
  const targetIntervalHeight = Math.max(targetIntervalEnd - targetAnchor.top, 1)
  const progress = Math.min(Math.max((sourceSnapshot.scrollTop - sourceAnchor.top) / sourceIntervalHeight, 0), 1)

  return {
    scrollTop: clampScrollTop(targetAnchor.top + targetIntervalHeight * progress, targetSnapshot),
    fallbackLine: sourceAnchor.line,
  }
}

export function useScrollSync(
  cmEditorRef: Ref<CmEditorRef | null>,
  previewRef: Ref<PreviewRef | null>,
  syncScroll: Ref<boolean>,
) {
  let suppressEditorScroll = false
  let suppressPreviewScroll = false
  let releaseEditorRaf = 0
  let releasePreviewRaf = 0

  const clearSuppression = (target: 'editor' | 'preview') => {
    if (target === 'editor') {
      suppressEditorScroll = false
      releaseEditorRaf = 0
      return
    }

    suppressPreviewScroll = false
    releasePreviewRaf = 0
  }

  const suppressTargetScroll = (target: 'editor' | 'preview') => {
    const rafId = target === 'editor' ? releaseEditorRaf : releasePreviewRaf
    if (rafId) cancelAnimationFrame(rafId)

    if (target === 'editor') {
      suppressEditorScroll = true
      releaseEditorRaf = requestAnimationFrame(() => {
        releaseEditorRaf = requestAnimationFrame(() => clearSuppression('editor'))
      })
      return
    }

    suppressPreviewScroll = true
    releasePreviewRaf = requestAnimationFrame(() => {
      releasePreviewRaf = requestAnimationFrame(() => clearSuppression('preview'))
    })
  }

  const syncScrollPosition = (
    source: ScrollSyncHandle | null,
    target: ScrollSyncHandle | null,
    targetName: 'editor' | 'preview',
  ) => {
    if (!source || !target) return

    const sourceSnapshot = source.getScrollSnapshot()
    const targetSnapshot = target.getScrollSnapshot()
    if (!sourceSnapshot || !targetSnapshot) return

    const sourceAnchors = source.getPositionMap()
    const targetAnchors = target.getPositionMap()
    const { scrollTop, fallbackLine } = calculateSyncedScrollTop(
      sourceSnapshot,
      sourceAnchors,
      targetSnapshot,
      targetAnchors,
    )

    suppressTargetScroll(targetName)
    if (targetAnchors.length === 0 && fallbackLine !== null && target.scrollToLine) {
      target.scrollToLine(fallbackLine)
      return
    }

    target.setScrollTop(scrollTop)
  }

  const handleEditorScroll = () => {
    if (!syncScroll.value || suppressEditorScroll) return
    syncScrollPosition(cmEditorRef.value, previewRef.value, 'preview')
  }

  const handlePreviewScroll = () => {
    if (!syncScroll.value || suppressPreviewScroll) return
    syncScrollPosition(previewRef.value, cmEditorRef.value, 'editor')
  }

  return {
    handleEditorScroll,
    handlePreviewScroll,
  }
}
