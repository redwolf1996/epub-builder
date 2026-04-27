<script setup lang="ts">
  import { computed, h, ref } from 'vue'
  import { NButton, NDropdown, NInput, useDialog } from 'naive-ui'
  import { VueDraggable } from 'vue-draggable-plus'
  import type { Chapter } from '@/types'

  const props = defineProps<{
    parentId: string | null
    chapters: Chapter[]
    currentChapterId?: string
    editingChapterId: string | null
    editingTitle: string
    collapsedIds: Set<string>
    deleteConfirmText: string
    addSubText: string
    promoteText: string
    deleteText: string
    confirmText: string
    cancelText: string
    renamePlaceholder: string
  }>()

  const emit = defineEmits<{
    select: [chapter: Chapter]
    renameStart: [chapter: Chapter]
    renameConfirm: []
    renameCancel: []
    renameInput: [value: string]
    addSub: [parentId: string]
    promote: [chapterId: string]
    delete: [chapterId: string]
    reorder: [parentId: string | null, orderedIds: string[]]
    toggleCollapse: [id: string]
  }>()

  const chapterList = computed({
    get: () => props.chapters
      .filter((c) => c.parentId === props.parentId)
      .sort((a, b) => a.order - b.order),
    set: (val: Chapter[]) => {
      emit('reorder', props.parentId, val.map((c) => c.id))
    },
  })

  const getChildren = (id: string) =>
    props.chapters.filter((c) => c.parentId === id).sort((a, b) => a.order - b.order)

  const isCollapsed = (id: string) => props.collapsedIds.has(id)

  const getActionOptions = (chapter: Chapter) => {
    const options: { label: string; key: string; icon?: () => ReturnType<typeof h> }[] = [
      { label: props.addSubText, key: 'addSub', icon: () => h('span', { class: 'i-carbon-add-alt text-xs' }) },
    ]
    if (chapter.parentId) {
      options.push({ label: props.promoteText, key: 'promote', icon: () => h('span', { class: 'i-carbon-promote text-xs' }) })
    }
    options.push({ label: props.deleteText, key: 'delete', icon: () => h('span', { class: 'i-carbon-trash-can text-xs' }) })
    return options
  }

  const dialog = useDialog()

  const contextMenuX = ref(0)
  const contextMenuY = ref(0)
  const contextChapter = ref<Chapter | null>(null)
  const showContextMenu = ref(false)

  const handleContextMenu = (e: MouseEvent, chapter: Chapter) => {
    e.preventDefault()
    contextChapter.value = chapter
    contextMenuX.value = e.clientX
    contextMenuY.value = e.clientY
    showContextMenu.value = true
  }

  const handleContextSelect = (key: string) => {
    if (!contextChapter.value) return
    handleAction(key, contextChapter.value)
    showContextMenu.value = false
  }

  const handleAction = (key: string, chapter: Chapter) => {
    if (key === 'addSub') emit('addSub', chapter.id)
    else if (key === 'promote') emit('promote', chapter.id)
    else if (key === 'delete') {
      dialog.warning({
        title: props.deleteText,
        content: props.deleteConfirmText,
        positiveText: props.confirmText,
        negativeText: props.cancelText,
        onPositiveClick: () => emit('delete', chapter.id),
      })
    }
  }
</script>

<template>
  <VueDraggable
    v-model="chapterList"
    :animation="150"
    handle=".drag-handle"
    group="chapters"
    ghost-class="chapter-ghost"
    drag-class="chapter-drag"
    class="flex flex-col gap-1"
    :class="{ 'ml-4': parentId !== null }">
    <div v-for="chapter in chapterList" :key="chapter.id">
      <div
        class="chapter-item flex min-w-0 items-center gap-2 px-3 py-2"
        :class="{ active: currentChapterId === chapter.id }"
        @contextmenu="handleContextMenu($event, chapter)">
        <button
          v-if="getChildren(chapter.id).length > 0"
          class="collapse-btn shrink-0"
          @click.stop="emit('toggleCollapse', chapter.id)">
          <span class="i-carbon-chevron-right transition-transform"
            :class="{ 'rotate-90': !isCollapsed(chapter.id) }" />
        </button>
        <span v-else class="shrink-0" style="width: 16px" />
        <span
          class="drag-handle shrink-0 flex items-center justify-center"
          style="color: var(--text-muted); width: 16px; height: 24px; cursor: grab">⠿</span>
        <template v-if="editingChapterId === chapter.id">
          <NInput
            size="tiny"
            autofocus
            class="chapter-title-input flex-1 min-w-0"
            :value="editingTitle"
            :placeholder="renamePlaceholder"
            @update:value="emit('renameInput', $event)"
            @keyup.enter="emit('renameConfirm')"
            @keyup.escape="emit('renameCancel')"
            @blur="emit('renameConfirm')" />
        </template>
        <template v-else>
          <span
            class="chapter-title flex-1 min-w-0 cursor-pointer text-sm"
            @click="emit('select', chapter)"
            @dblclick="emit('renameStart', chapter)">{{ chapter.title }}</span>
        </template>
        <NDropdown :options="getActionOptions(chapter)" trigger="click" placement="bottom-end"
          @select="handleAction($event, chapter)">
          <NButton quaternary size="tiny" @click.stop class="action-btn shrink-0">
            <span class="i-carbon-overflow-menu-horizontal text-xs" />
          </NButton>
        </NDropdown>
      </div>
      <ChapterNode v-if="getChildren(chapter.id).length > 0 && !isCollapsed(chapter.id)" :parent-id="chapter.id"
        :chapters="chapters" :current-chapter-id="currentChapterId" :editing-chapter-id="editingChapterId"
        :editing-title="editingTitle" :collapsed-ids="collapsedIds" :delete-confirm-text="deleteConfirmText"
        :add-sub-text="addSubText" :promote-text="promoteText" :delete-text="deleteText" :confirm-text="confirmText"
        :cancel-text="cancelText" :rename-placeholder="renamePlaceholder" @select="emit('select', $event)"
        @rename-start="emit('renameStart', $event)" @rename-confirm="emit('renameConfirm')"
        @rename-cancel="emit('renameCancel')" @rename-input="emit('renameInput', $event)"
        @add-sub="emit('addSub', $event)"
        @promote="emit('promote', $event)" @delete="emit('delete', $event)"
        @reorder="(p: string | null, ids: string[]) => emit('reorder', p, ids)"
        @toggle-collapse="emit('toggleCollapse', $event)" />
    </div>
  </VueDraggable>

  <!-- 右键菜单 -->
  <NDropdown
    placement="bottom-start"
    trigger="manual"
    :x="contextMenuX"
    :y="contextMenuY"
    :options="contextChapter ? getActionOptions(contextChapter) : []"
    :show="showContextMenu"
    @select="handleContextSelect"
    @clickoutside="showContextMenu = false" />
</template>

<style scoped>
  .chapter-item {
    color: var(--text-secondary);
    border-radius: 0 4px 4px 0;
    transition: background 0.15s ease, color 0.15s ease;
  }

  .chapter-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .chapter-title-input {
    min-width: 0;
  }

  .chapter-item:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .chapter-item.active {
    background: var(--bg-active);
    color: var(--primary);
    font-weight: 500;
    box-shadow: inset 3px 0 0 var(--primary);
  }

  .chapter-item:hover .n-button {
    opacity: 1;
  }

  .drag-handle {
    opacity: 0.4;
    transition: opacity 0.2s;
  }

  .chapter-item:hover .drag-handle {
    opacity: 1;
  }

  .collapse-btn {
    width: 16px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    cursor: pointer;
    border: none;
    background: none;
    padding: 0;
  }

  .action-btn {
    opacity: 0;
    transition: opacity 0.2s;
  }

  .chapter-item:hover .action-btn {
    opacity: 1;
  }

  .chapter-ghost {
    opacity: 0;
  }

  .chapter-drag {
    opacity: 0.8;
    background: var(--bg-active);
    border-radius: 6px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  }
</style>
