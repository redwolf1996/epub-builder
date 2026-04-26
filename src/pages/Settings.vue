<script setup lang="ts">
import { onMounted, ref, watch, onBeforeUnmount } from 'vue'
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { NButton, NForm, NFormItem, NInput, NUpload, NDatePicker, useMessage, type UploadFileInfo } from 'naive-ui'
import { useBookStore } from '@/stores/book'
import { compressImage } from '@/utils/image'
import { debounce } from '@/utils/debounce'
import type { BookMeta } from '@/types'

type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved'

const route = useRoute()
const router = useRouter()
const bookStore = useBookStore()
const message = useMessage()
const { t } = useI18n()

const bookId = route.params.id as string
const meta = ref<BookMeta>({
  title: '',
  author: '',
  description: '',
  language: 'zh-CN',
  publishDate: new Date().toISOString().slice(0, 10),
  coverImage: null,
})

const isNewBook = ref(false)
const dateTimestamp = ref<number | null>(null)
const saveStatus = ref<SaveStatus>('idle')
const isDragOver = ref(false)
const isCompressing = ref(false)

onMounted(async () => {
  const book = await bookStore.getBook(bookId)
  if (book) {
    meta.value = { ...book.meta }
    // 解析日期
    if (meta.value.publishDate) {
      dateTimestamp.value = new Date(meta.value.publishDate).getTime()
    }
  }
  isNewBook.value = route.query.new === '1'
})

// --- 自动保存 ---
const autoSave = debounce(async () => {
  if (!meta.value.title.trim()) return
  saveStatus.value = 'saving'
  await bookStore.updateBookMeta(bookId, { ...meta.value })
  saveStatus.value = 'saved'
}, 500)

watch(meta, () => {
  if (saveStatus.value === 'idle' || saveStatus.value === 'saved') {
    saveStatus.value = 'dirty'
  }
  autoSave()
}, { deep: true })

const flushSave = () => {
  if (saveStatus.value === 'dirty') {
    autoSave.flush()
    saveStatus.value = 'saved'
  }
}

onBeforeRouteLeave(() => {
  flushSave()
  return true
})

const handleBeforeUnload = (e: BeforeUnloadEvent) => {
  if (saveStatus.value === 'dirty') {
    e.preventDefault()
  }
}
window.addEventListener('beforeunload', handleBeforeUnload)
onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', handleBeforeUnload)
})

const handleBack = () => {
  router.back()
}

const handleDateChange = (val: number | null) => {
  dateTimestamp.value = val
  if (val) {
    meta.value.publishDate = new Date(val).toISOString().slice(0, 10)
  } else {
    meta.value.publishDate = ''
  }
}

const handleSave = async () => {
  if (!meta.value.title.trim()) {
    message.warning(t('settings.titleRequired'))
    return
  }
  await bookStore.updateBookMeta(bookId, { ...meta.value })
  saveStatus.value = 'saved'
  message.success(t('settings.saved'))
  if (isNewBook.value) {
    isNewBook.value = false
    router.push(`/editor/${bookId}`)
  } else {
    router.back()
  }
}

const processCoverFile = async (file: File) => {
  isCompressing.value = true
  try {
    const dataUrl = await compressImage(file)
    meta.value.coverImage = dataUrl
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes('too large')) {
      message.error(t('settings.coverTooLarge'))
    } else {
      message.error(msg)
    }
  } finally {
    isCompressing.value = false
  }
}

const handleCoverChange = async (options: { file: UploadFileInfo; fileList: UploadFileInfo[] }) => {
  const file = options.file.file
  if (!file) return
  await processCoverFile(file)
}

const handleCoverDrop = async (e: DragEvent) => {
  isDragOver.value = false
  const file = e.dataTransfer?.files[0]
  if (!file || !file.type.startsWith('image/')) return
  await processCoverFile(file)
}

const handleDragOver = (e: DragEvent) => {
  e.preventDefault()
  isDragOver.value = true
}

const handleDragLeave = () => {
  isDragOver.value = false
}

const handleRemoveCover = () => {
  meta.value.coverImage = null
}
</script>

<template>
  <div class="settings-page h-full flex flex-col overflow-hidden">
    <header class="header-bar flex items-center gap-4 px-6 py-3">
      <NButton quaternary @click="handleBack">
        <span class="i-carbon-arrow-left mr-1" />
        {{ t('settings.back') }}
      </NButton>
      <span class="text-lg font-semibold">{{ t('settings.title') }}</span>
      <div class="flex-1" />
      <span class="text-xs" :class="{ 'save-saving': saveStatus === 'saving' || saveStatus === 'dirty' }" style="color: var(--text-muted)">
        <template v-if="saveStatus === 'idle'">{{ t('settings.saveIdle') }}</template>
        <template v-else-if="saveStatus === 'dirty'">{{ t('settings.saveDirty') }}</template>
        <template v-else-if="saveStatus === 'saving'">{{ t('settings.saveSaving') }}</template>
        <template v-else>{{ t('settings.saveSaved') }}</template>
      </span>
    </header>

    <main class="flex-1 overflow-auto flex items-center justify-center px-6 py-6 w-full">
      <div class="settings-card flex gap-8 w-full max-w-4xl items-stretch">
        <!-- 左侧：封面 -->
        <div class="shrink-0 flex items-center" style="width: 240px">
          <NUpload
            v-if="!meta.coverImage"
            :max="1"
            accept="image/*"
            :show-file-list="false"
            @change="handleCoverChange"
            class="cover-upload"
          >
            <div
              class="cover-empty-bg w-full aspect-[3/4] rounded-lg flex flex-col items-center justify-center gap-3"
              :class="{ 'drag-over': isDragOver }"
              @dragover="handleDragOver"
              @dragleave="handleDragLeave"
              @drop="handleCoverDrop"
            >
              <span v-if="isCompressing" class="i-carbon-renew text-4xl animate-spin" style="color: var(--primary)" />
              <template v-else>
                <span class="i-carbon-image text-4xl" style="color: var(--text-muted)" />
                <NButton type="primary">
                  <template #icon>
                    <span class="i-carbon-upload" />
                  </template>
                  {{ t('settings.uploadCover') }}
                </NButton>
                <span class="text-xs" style="color: var(--text-muted)">{{ t('settings.dragOrClick') }}</span>
              </template>
            </div>
          </NUpload>
          <div v-else class="cover-area cover-has-img w-full aspect-[3/4] rounded-lg relative overflow-hidden">
            <img :src="meta.coverImage" alt="封面" class="w-full h-full object-cover rounded-lg shadow-lg" />
            <div class="cover-overlay">
              <NButton size="small" type="error" @click="handleRemoveCover">
                <template #icon>
                  <span class="i-carbon-trash-can" />
                </template>
                {{ t('settings.removeCover') }}
              </NButton>
            </div>
          </div>
        </div>

        <!-- 右侧：表单 -->
        <div class="flex-1 min-w-1 flex flex-col h-[320px]">
          <NForm label-placement="left" label-width="120" label-wrap :show-feedback="false" class="h-full flex flex-col justify-between">
          <NFormItem :label="t('settings.bookTitle')">
            <NInput v-model:value="meta.title" :placeholder="t('settings.bookTitlePlaceholder')" />
          </NFormItem>
          <NFormItem :label="t('settings.authorLabel')">
            <NInput v-model:value="meta.author" :placeholder="t('settings.authorPlaceholder')" />
          </NFormItem>
          <NFormItem :label="t('settings.description')">
            <NInput v-model:value="meta.description" type="textarea" :placeholder="t('settings.descriptionPlaceholder')" :rows="2" />
          </NFormItem>
          <NFormItem :label="t('settings.publishDate')">
            <NDatePicker v-model:value="dateTimestamp" type="date" class="w-full" @update:value="handleDateChange" />
          </NFormItem>
          <NFormItem :label="' '">
            <div class="flex gap-3">
              <NButton type="primary" @click="handleSave">{{ isNewBook ? t('settings.saveAndEdit') : t('settings.save') }}</NButton>
              <NButton v-if="!isNewBook" @click="router.push(`/editor/${bookId}`)">{{ t('settings.goToEdit') }}</NButton>
            </div>
          </NFormItem>
        </NForm>
        </div>
      </div>
    </main>
  </div>
</template>

<style scoped>
.settings-page {
  background: var(--bg-base);
}

.settings-card {
  background: var(--bg-surface);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 24px;
  transition: background-color 0.3s, border-color 0.3s;
}

.header-bar {
  backdrop-filter: blur(12px);
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border-color);
  transition: background-color 0.3s, border-color 0.3s;
}

.cover-area {
  background: var(--bg-surface);
  border: 2px dashed var(--border-color);
  overflow: hidden;
  cursor: pointer;
  transition: border-color 0.2s;
}

.cover-area:hover {
  border-color: var(--primary);
}

.cover-empty-bg {
  background: var(--bg-surface);
  border: 2px dashed var(--border-color);
  transition: border-color 0.2s, background-color 0.2s;
}

.cover-empty-bg:hover,
.cover-empty-bg.drag-over {
  border-color: var(--primary);
  background: var(--bg-hover);
}

.cover-has-img {
  border: none;
  cursor: default;
}

.cover-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.2s;
}

.cover-has-img:hover .cover-overlay {
  opacity: 1;
}

.cover-upload :deep(.n-upload-trigger) {
  width: 100%;
  display: flex;
  justify-content: center;
}

.save-saving {
  animation: save-pulse 1s ease-in-out infinite;
}

@keyframes save-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

.animate-spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

</style>
