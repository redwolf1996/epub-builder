import { ref, watch, type Ref } from 'vue'

const SIDEBAR_MIN = 160
const SIDEBAR_MAX = 400

export function useResizable(splitContainerRef: Ref<HTMLElement | null>) {
  const sidebarWidth = ref(Number(localStorage.getItem('editor-sidebar-width')) || 240)
  const editorRatio = ref(Number(localStorage.getItem('editor-split-ratio')) || 0.5)

  watch(sidebarWidth, (val) => localStorage.setItem('editor-sidebar-width', String(val)))
  watch(editorRatio, (val) => localStorage.setItem('editor-split-ratio', String(val)))

  let draggingSidebar = false
  let draggingSplit = false
  let dragStartX = 0
  let dragStartWidth = 0
  let dragStartRatio = 0

  const onSidebarDragStart = (e: MouseEvent) => {
    draggingSidebar = true
    dragStartX = e.clientX
    dragStartWidth = sidebarWidth.value
    document.addEventListener('mousemove', onSidebarDragMove)
    document.addEventListener('mouseup', onDragEnd)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    e.preventDefault()
  }

  const onSidebarDragMove = (e: MouseEvent) => {
    if (!draggingSidebar) return
    const delta = e.clientX - dragStartX
    sidebarWidth.value = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, dragStartWidth + delta))
  }

  const onSplitDragStart = (e: MouseEvent) => {
    draggingSplit = true
    dragStartX = e.clientX
    dragStartRatio = editorRatio.value
    document.addEventListener('mousemove', onSplitDragMove)
    document.addEventListener('mouseup', onDragEnd)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    e.preventDefault()
  }

  const onSplitDragMove = (e: MouseEvent) => {
    if (!draggingSplit || !splitContainerRef.value) return
    const rect = splitContainerRef.value.getBoundingClientRect()
    const delta = e.clientX - dragStartX
    const deltaRatio = delta / rect.width
    editorRatio.value = Math.min(0.8, Math.max(0.2, dragStartRatio + deltaRatio))
  }

  const onDragEnd = () => {
    draggingSidebar = false
    draggingSplit = false
    document.removeEventListener('mousemove', onSidebarDragMove)
    document.removeEventListener('mousemove', onSplitDragMove)
    document.removeEventListener('mouseup', onDragEnd)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }

  return {
    sidebarWidth,
    editorRatio,
    SIDEBAR_MIN,
    SIDEBAR_MAX,
    onSidebarDragStart,
    onSplitDragStart,
  }
}
