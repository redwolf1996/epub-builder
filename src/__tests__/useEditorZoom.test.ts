import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ref } from 'vue'
import {
  clampFontSize,
  EDITOR_ZOOM_DEFAULT,
  EDITOR_ZOOM_MAX,
  EDITOR_ZOOM_MIN,
  useEditorZoom,
} from '@/composables/useEditorZoom'

function createStorageMock() {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value)
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
    clear: () => {
      store.clear()
    },
  }
}

describe('useEditorZoom', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createStorageMock())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('clamps font size within bounds', () => {
    expect(clampFontSize(EDITOR_ZOOM_MIN - 1)).toBe(EDITOR_ZOOM_MIN)
    expect(clampFontSize(EDITOR_ZOOM_MAX + 1)).toBe(EDITOR_ZOOM_MAX)
    expect(clampFontSize(16)).toBe(16)
  })

  it('applies zoom to editor and preview targets', () => {
    const editorSizes: number[] = []
    const previewSizes: number[] = []
    const editorRef = ref({
      setFontSize: (size: number) => {
        editorSizes.push(size)
      },
    })
    const previewRef = ref({
      setFontSize: (size: number) => {
        previewSizes.push(size)
      },
    })

    const { increase, reset } = useEditorZoom(editorRef, previewRef)
    increase()
    reset()

    expect(editorSizes.at(-2)).toBe(EDITOR_ZOOM_DEFAULT + 1)
    expect(editorSizes.at(-1)).toBe(EDITOR_ZOOM_DEFAULT)
    expect(previewSizes.at(-2)).toBeGreaterThan(previewSizes.at(-1) ?? 0)
  })

  it('persists font size to localStorage', () => {
    const editorRef = ref({ setFontSize: () => {} })
    const previewRef = ref({ setFontSize: () => {} })
    const { increase } = useEditorZoom(editorRef, previewRef)

    increase()
    expect(localStorage.getItem('editor-ui-font-size')).toBe(String(EDITOR_ZOOM_DEFAULT + 1))
  })

  it('handles ctrl+wheel zoom shortcuts', () => {
    const editorRef = ref({ setFontSize: () => {} })
    const previewRef = ref({ setFontSize: () => {} })
    const { fontSize, handleWheel } = useEditorZoom(editorRef, previewRef)

    handleWheel({
      ctrlKey: true,
      metaKey: false,
      deltaY: -120,
      preventDefault: () => {},
    } as WheelEvent)
    expect(fontSize.value).toBe(EDITOR_ZOOM_DEFAULT + 1)

    handleWheel({
      ctrlKey: true,
      metaKey: false,
      deltaY: 120,
      preventDefault: () => {},
    } as WheelEvent)
    expect(fontSize.value).toBe(EDITOR_ZOOM_DEFAULT)
  })

  it('handles ctrl keyboard shortcuts', () => {
    const editorRef = ref({ setFontSize: () => {} })
    const previewRef = ref({ setFontSize: () => {} })
    const { fontSize, handleKeydown } = useEditorZoom(editorRef, previewRef)

    expect(handleKeydown(new KeyboardEvent('keydown', { key: '=', ctrlKey: true }))).toBe(true)
    expect(fontSize.value).toBe(EDITOR_ZOOM_DEFAULT + 1)

    expect(handleKeydown(new KeyboardEvent('keydown', { key: '0', ctrlKey: true }))).toBe(true)
    expect(fontSize.value).toBe(EDITOR_ZOOM_DEFAULT)
  })
})
