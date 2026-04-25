<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { NButton, NForm, NFormItem, NInput, NUpload, NDatePicker, useMessage, type UploadFileInfo } from 'naive-ui'
import { useBookStore } from '@/stores/book'
import type { BookMeta } from '@/types'

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

onMounted(async () => {
  const book = await bookStore.getBook(bookId)
  if (book) {
    meta.value = { ...book.meta }
    // 解析日期
    if (meta.value.publishDate) {
      dateTimestamp.value = new Date(meta.value.publishDate).getTime()
    }
  }
  // 判断是否新建书籍（通过 route query）
  isNewBook.value = route.query.new === '1'
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
  message.success(t('settings.saved'))
  if (isNewBook.value) {
    isNewBook.value = false
    router.push(`/editor/${bookId}`)
  } else {
    router.back()
  }
}

const handleCoverChange = async (options: { file: UploadFileInfo; fileList: UploadFileInfo[] }) => {
  const file = options.file.file
  if (!file) return

  const reader = new FileReader()
  reader.onload = async (e) => {
    const result = e.target?.result
    if (typeof result === 'string') {
      meta.value.coverImage = result
      await bookStore.updateBookMeta(bookId, { coverImage: result })
    }
  }
  reader.readAsDataURL(file)
}

const handleRemoveCover = async () => {
  meta.value.coverImage = null
  await bookStore.updateBookMeta(bookId, { coverImage: null })
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
            <div class="cover-empty-bg w-full aspect-[3/4] rounded-lg flex flex-col items-center justify-center gap-3">
              <span class="i-carbon-image text-4xl" style="color: var(--text-muted)" />
              <NButton type="primary">
                <template #icon>
                  <span class="i-carbon-upload" />
                </template>
                {{ t('settings.uploadCover') }}
              </NButton>
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
}

.header-bar {
  backdrop-filter: blur(12px);
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border-color);
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
  transition: border-color 0.2s;
}

.cover-empty-bg:hover {
  border-color: var(--primary);
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
</style>
