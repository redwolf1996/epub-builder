import { type Ref } from 'vue'
import type CodeMirrorEditor from '@/components/editor/CodeMirrorEditor.vue'
import type MarkdownPreview from '@/components/preview/MarkdownPreview.vue'

export interface LineAnchor {
  lineStart: number
  lineEnd: number
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
  getLastUserScrollIntent: () => number
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

  const containingIndex = anchors.findIndex((anchor) => line >= anchor.lineStart && line <= anchor.lineEnd)
  if (containingIndex !== -1) return containingIndex

  let lo = 0
  let hi = anchors.length - 1

  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (anchors[mid].lineStart < line) lo = mid + 1
    else hi = mid
  }

  const current = anchors[lo]
  const previous = lo > 0 ? anchors[lo - 1] : null
  if (!previous) return lo

  const currentDistance = line < current.lineStart ? current.lineStart - line : line - current.lineEnd
  const previousDistance = line < previous.lineStart ? previous.lineStart - line : line - previous.lineEnd
  return previousDistance <= currentDistance ? lo - 1 : lo
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
  const targetIndex = findClosestAnchorIndexByLine(targetAnchors, sourceAnchor.lineStart)
  if (targetIndex === -1) {
    return {
      scrollTop: clampScrollTop(getScrollRatio(sourceSnapshot) * getMaxScrollTop(targetSnapshot), targetSnapshot),
      fallbackLine: sourceAnchor.lineStart,
    }
  }

  const targetAnchor = targetAnchors[targetIndex]
  const sourceIntervalHeight = Math.max(sourceAnchor.bottom - sourceAnchor.top, 1)
  const targetIntervalHeight = Math.max(targetAnchor.bottom - targetAnchor.top, 1)
  const progress = Math.min(Math.max((sourceSnapshot.scrollTop - sourceAnchor.top) / sourceIntervalHeight, 0), 1)

  return {
    scrollTop: clampScrollTop(targetAnchor.top + (targetIntervalHeight * progress), targetSnapshot),
    fallbackLine: sourceAnchor.lineStart,
  }
}

export function useScrollSync(
  cmEditorRef: Ref<CmEditorRef | null>,
  previewRef: Ref<PreviewRef | null>,
  syncScroll: Ref<boolean>,
) {
  const USER_SCROLL_INTENT_WINDOW_MS = 220
  const ACTIVE_SOURCE_WINDOW_MS = 320
  const PROGRAMMATIC_SCROLL_WINDOW_MS = 220

  let suppressEditorScroll = false
  let suppressPreviewScroll = false
  let releaseEditorRaf = 0
  let releasePreviewRaf = 0
  let activeSource: 'editor' | 'preview' | null = null
  let activeSourceExpiresAt = 0
  let editorProgrammaticUntil = 0
  let previewProgrammaticUntil = 0

  const getNow = () => Date.now()

  const getProgrammaticUntil = (target: 'editor' | 'preview') => {
    return target === 'editor' ? editorProgrammaticUntil : previewProgrammaticUntil
  }

  const setProgrammaticUntil = (target: 'editor' | 'preview', expiresAt: number) => {
    if (target === 'editor') {
      editorProgrammaticUntil = expiresAt
      return
    }

    previewProgrammaticUntil = expiresAt
  }

  const hasRecentUserIntent = (source: ScrollSyncHandle | null, now: number) => {
    if (!source) return false
    return now - source.getLastUserScrollIntent() <= USER_SCROLL_INTENT_WINDOW_MS
  }

  const canSourceDriveSync = (
    source: ScrollSyncHandle | null,
    sourceName: 'editor' | 'preview',
  ) => {
    const now = getNow()
    if (now < getProgrammaticUntil(sourceName)) return false

    if (hasRecentUserIntent(source, now)) {
      activeSource = sourceName
      activeSourceExpiresAt = now + ACTIVE_SOURCE_WINDOW_MS
      return true
    }

    if (activeSource === sourceName && now <= activeSourceExpiresAt) {
      activeSourceExpiresAt = now + ACTIVE_SOURCE_WINDOW_MS
      return true
    }

    return false
  }

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
    setProgrammaticUntil(targetName, getNow() + PROGRAMMATIC_SCROLL_WINDOW_MS)
    if (fallbackLine !== null && target.scrollToLine && targetAnchors.length > 0) {
      const targetIndex = findClosestAnchorIndexByLine(targetAnchors, fallbackLine)
      const targetAnchor = targetIndex >= 0 ? targetAnchors[targetIndex] : null
      const fallbackOutsideTargetRange = !targetAnchor || fallbackLine < targetAnchor.lineStart || fallbackLine > targetAnchor.lineEnd
      if (fallbackOutsideTargetRange) {
        target.scrollToLine(fallbackLine)
        return
      }
    }

    if (targetAnchors.length === 0 && fallbackLine !== null && target.scrollToLine) {
      target.scrollToLine(fallbackLine)
      return
    }

    target.setScrollTop(scrollTop)
  }

  const handleEditorScroll = () => {
    if (!syncScroll.value || suppressEditorScroll) return
    if (!canSourceDriveSync(cmEditorRef.value, 'editor')) return
    syncScrollPosition(cmEditorRef.value, previewRef.value, 'preview')
  }

  const handlePreviewScroll = () => {
    if (!syncScroll.value || suppressPreviewScroll) return
    if (!canSourceDriveSync(previewRef.value, 'preview')) return
    syncScrollPosition(previewRef.value, cmEditorRef.value, 'editor')
  }

  return {
    handleEditorScroll,
    handlePreviewScroll,
  }
}
