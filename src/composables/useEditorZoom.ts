import { ref, watch, type Ref } from 'vue'

const STORAGE_KEY = 'editor-ui-font-size'
export const EDITOR_ZOOM_DEFAULT = 14
export const EDITOR_ZOOM_MIN = 10
export const EDITOR_ZOOM_MAX = 32
export const EDITOR_ZOOM_STEP = 1
const PREVIEW_BASE_SIZE = 16

type ZoomTarget = {
  setFontSize: (size: number) => void
} | null

function loadSavedFontSize(): number {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return EDITOR_ZOOM_DEFAULT
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed)) return EDITOR_ZOOM_DEFAULT
  return clampFontSize(parsed)
}

export function clampFontSize(size: number): number {
  return Math.min(EDITOR_ZOOM_MAX, Math.max(EDITOR_ZOOM_MIN, size))
}

function previewFontSize(editorSize: number): number {
  const scale = editorSize / EDITOR_ZOOM_DEFAULT
  return Math.round(PREVIEW_BASE_SIZE * scale)
}

function isTypingInFormField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.closest('.cm-editor')) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable
}

export function useEditorZoom(
  editorRef: Ref<ZoomTarget>,
  previewRef: Ref<ZoomTarget>,
) {
  const fontSize = ref(loadSavedFontSize())

  const applyZoom = () => {
    editorRef.value?.setFontSize(fontSize.value)
    previewRef.value?.setFontSize(previewFontSize(fontSize.value))
    localStorage.setItem(STORAGE_KEY, String(fontSize.value))
  }

  const increase = () => {
    fontSize.value = clampFontSize(fontSize.value + EDITOR_ZOOM_STEP)
    applyZoom()
  }

  const decrease = () => {
    fontSize.value = clampFontSize(fontSize.value - EDITOR_ZOOM_STEP)
    applyZoom()
  }

  const reset = () => {
    fontSize.value = EDITOR_ZOOM_DEFAULT
    applyZoom()
  }

  const handleWheel = (event: WheelEvent) => {
    if (!event.ctrlKey && !event.metaKey) return
    event.preventDefault()
    if (event.deltaY < 0) increase()
    else if (event.deltaY > 0) decrease()
  }

  const handleKeydown = (event: KeyboardEvent) => {
    if (!event.ctrlKey && !event.metaKey) return false
    if (isTypingInFormField(event.target)) return false

    if (event.key === '0') {
      event.preventDefault()
      reset()
      return true
    }

    if (event.key === '=' || event.key === '+') {
      event.preventDefault()
      increase()
      return true
    }

    if (event.key === '-' || event.key === '_') {
      event.preventDefault()
      decrease()
      return true
    }

    return false
  }

  watch([editorRef, previewRef], () => {
    applyZoom()
  }, { immediate: true, flush: 'post' })

  return {
    fontSize,
    increase,
    decrease,
    reset,
    applyZoom,
    handleWheel,
    handleKeydown,
  }
}
