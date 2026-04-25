<script setup lang="ts">
  import { computed } from 'vue'
  import { NButton, NInput, NPopconfirm, NTooltip } from 'naive-ui'
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
</script>

<template>
  <VueDraggable
    v-model="chapterList"
    :animation="150"
    handle=".drag-handle"
    group="chapters"
    class="flex flex-col gap-1"
    :class="{ 'ml-4': parentId !== null }">
    <div v-for="chapter in chapterList" :key="chapter.id">
      <div
        class="chapter-item flex items-center gap-2 px-3 py-2 rounded transition-all"
        :class="{ active: currentChapterId === chapter.id }">
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
            class="flex-1"
            :value="editingTitle"
            :placeholder="renamePlaceholder"
            @update:value="emit('renameInput', $event)"
            @keyup.enter="emit('renameConfirm')"
            @keyup.escape="emit('renameCancel')"
            @blur="emit('renameConfirm')" />
        </template>
        <template v-else>
          <span
            class="flex-1 text-sm truncate cursor-pointer"
            @click="emit('select', chapter)"
            @dblclick="emit('renameStart', chapter)">{{ chapter.title }}</span>
        </template>
        <NTooltip>
          <template #trigger>
            <NButton quaternary size="tiny" @click.stop="emit('addSub', chapter.id)" class="action-btn">
              <span class="i-carbon-add-alt text-xs" />
            </NButton>
          </template>
          {{ addSubText }}
        </NTooltip>
        <NTooltip v-if="chapter.parentId">
          <template #trigger>
            <NButton quaternary size="tiny" @click.stop="emit('promote', chapter.id)" class="action-btn">
              <span class="i-carbon-promote text-xs" />
            </NButton>
          </template>
          {{ promoteText }}
        </NTooltip>
        <NPopconfirm :positive-text="confirmText" :negative-text="cancelText"
          @positive-click="emit('delete', chapter.id)">
          <template #trigger>
            <NTooltip>
              <template #trigger>
                <NButton quaternary size="tiny" @click.stop class="delete-btn">
                  <span class="i-carbon-trash-can text-xs" />
                </NButton>
              </template>
              {{ deleteText }}
            </NTooltip>
          </template>
          {{ deleteConfirmText }}
        </NPopconfirm>
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
</template>

<style scoped>
  .chapter-item {
    color: var(--text-secondary);
  }

  .chapter-item:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .chapter-item.active {
    background: var(--bg-active);
    color: var(--primary);
    font-weight: 500;
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

  .delete-btn {
    opacity: 0;
    transition: opacity 0.2s;
  }

  .chapter-item:hover .delete-btn {
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
</style>
