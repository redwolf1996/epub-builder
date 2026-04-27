import { describe, it, expect } from 'vitest'
import {
  calculateSyncedScrollTop,
  clampScrollTop,
  findClosestAnchorIndexByLine,
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
  { line: 10, top: 100, bottom: 150 },
  { line: 20, top: 220, bottom: 280 },
]

const targetAnchors: LineAnchor[] = [
  { line: 10, top: 160, bottom: 260 },
  { line: 20, top: 360, bottom: 480 },
]

describe('clampScrollTop', () => {
  it('clamps to the valid scroll range', () => {
    expect(clampScrollTop(-10, targetSnapshot)).toBe(0)
    expect(clampScrollTop(2000, targetSnapshot)).toBe(1200)
  })
})

describe('findClosestAnchorIndexByLine', () => {
  it('finds the exact anchor line', () => {
    expect(findClosestAnchorIndexByLine(targetAnchors, 20)).toBe(1)
  })

  it('falls back to the closest anchor by line number', () => {
    expect(findClosestAnchorIndexByLine(targetAnchors, 16)).toBe(1)
    expect(findClosestAnchorIndexByLine(targetAnchors, 12)).toBe(0)
  })
})

describe('calculateSyncedScrollTop', () => {
  it('maps proportional position within an anchor interval', () => {
    const result = calculateSyncedScrollTop(
      sourceSnapshot,
      sourceAnchors,
      targetSnapshot,
      targetAnchors,
    )

    expect(result.fallbackLine).toBe(10)
    expect(result.scrollTop).toBeCloseTo(193.3333333333)
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
})
