import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref } from 'vue'
import {
  calculateSyncedScrollTop,
  clampScrollTop,
  findClosestAnchorIndexByLine,
  useScrollSync,
  type LineAnchor,
  type ScrollSnapshot,
} from '@/composables/useScrollSync'

const sourceSnapshot: ScrollSnapshot = {
  scrollTop: 120,
  viewportHeight: 200,
  contentHeight: 1000,
}

const targetSnapshot: ScrollSnapshot = {
  scrollTop: 0,
  viewportHeight: 300,
  contentHeight: 1500,
}

const sourceAnchors: LineAnchor[] = [
  { lineStart: 10, lineEnd: 16, top: 100, bottom: 180 },
  { lineStart: 20, lineEnd: 28, top: 220, bottom: 320 },
]

const targetAnchors: LineAnchor[] = [
  { lineStart: 10, lineEnd: 16, top: 160, bottom: 300 },
  { lineStart: 20, lineEnd: 28, top: 360, bottom: 560 },
]

describe('clampScrollTop', () => {
  it('clamps to the valid scroll range', () => {
    expect(clampScrollTop(-10, targetSnapshot)).toBe(0)
    expect(clampScrollTop(2000, targetSnapshot)).toBe(1200)
  })
})

describe('useScrollSync', () => {
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(1000)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('lets editor-driven scroll sync preview without preview taking control back', () => {
    const previewSetScrollTop = vi.fn()
    const editorSetScrollTop = vi.fn()
    const editor = {
      getScrollSnapshot: () => sourceSnapshot,
      getPositionMap: () => sourceAnchors,
      getLastUserScrollIntent: () => 950,
      setScrollTop: editorSetScrollTop,
    }
    const preview = {
      getScrollSnapshot: () => targetSnapshot,
      getPositionMap: () => targetAnchors,
      getLastUserScrollIntent: () => 0,
      setScrollTop: previewSetScrollTop,
    }

    const { handleEditorScroll, handlePreviewScroll } = useScrollSync(
      ref(editor) as never,
      ref(preview) as never,
      ref(true),
    )

    handleEditorScroll()
    expect(previewSetScrollTop).toHaveBeenCalledTimes(1)

    vi.mocked(Date.now).mockReturnValue(1050)
    handlePreviewScroll()
    expect(editorSetScrollTop).not.toHaveBeenCalled()
  })

  it('does not let preview hover or passive scroll take control', () => {
    const editorSetScrollTop = vi.fn()
    const preview = {
      getScrollSnapshot: () => targetSnapshot,
      getPositionMap: () => targetAnchors,
      getLastUserScrollIntent: () => 0,
      setScrollTop: vi.fn(),
    }
    const editor = {
      getScrollSnapshot: () => sourceSnapshot,
      getPositionMap: () => sourceAnchors,
      getLastUserScrollIntent: () => 0,
      setScrollTop: editorSetScrollTop,
    }

    const { handlePreviewScroll } = useScrollSync(
      ref(editor) as never,
      ref(preview) as never,
      ref(true),
    )

    handlePreviewScroll()
    expect(editorSetScrollTop).not.toHaveBeenCalled()
  })

  it('lets preview-driven scroll sync editor after real user intent', () => {
    const editorSetScrollTop = vi.fn()
    const preview = {
      getScrollSnapshot: () => targetSnapshot,
      getPositionMap: () => targetAnchors,
      getLastUserScrollIntent: () => 950,
      setScrollTop: vi.fn(),
    }
    const editor = {
      getScrollSnapshot: () => sourceSnapshot,
      getPositionMap: () => sourceAnchors,
      getLastUserScrollIntent: () => 0,
      setScrollTop: editorSetScrollTop,
    }

    const { handlePreviewScroll } = useScrollSync(
      ref(editor) as never,
      ref(preview) as never,
      ref(true),
    )

    handlePreviewScroll()
    expect(editorSetScrollTop).toHaveBeenCalledTimes(1)
  })
})

describe('findClosestAnchorIndexByLine', () => {
  it('finds the anchor containing the line', () => {
    expect(findClosestAnchorIndexByLine(targetAnchors, 20)).toBe(1)
    expect(findClosestAnchorIndexByLine(targetAnchors, 14)).toBe(0)
  })

  it('falls back to the closest anchor by line number', () => {
    expect(findClosestAnchorIndexByLine(targetAnchors, 18)).toBe(0)
    expect(findClosestAnchorIndexByLine(targetAnchors, 30)).toBe(1)
  })
})

describe('calculateSyncedScrollTop', () => {
  it('maps proportional position within a block interval', () => {
    const result = calculateSyncedScrollTop(
      sourceSnapshot,
      sourceAnchors,
      targetSnapshot,
      targetAnchors,
    )

    expect(result.fallbackLine).toBe(10)
    expect(result.scrollTop).toBeCloseTo(195)
  })

  it('falls back to overall scroll ratio when anchors are missing', () => {
    const result = calculateSyncedScrollTop(
      sourceSnapshot,
      [],
      targetSnapshot,
      [],
    )

    expect(result.fallbackLine).toBeNull()
    expect(result.scrollTop).toBeCloseTo(180)
  })

  it('uses the matching block range instead of the next block for long content', () => {
    const result = calculateSyncedScrollTop(
      {
        scrollTop: 260,
        viewportHeight: 200,
        contentHeight: 1000,
      },
      sourceAnchors,
      targetSnapshot,
      targetAnchors,
    )

    expect(result.fallbackLine).toBe(20)
    expect(result.scrollTop).toBeCloseTo(440)
  })
})
