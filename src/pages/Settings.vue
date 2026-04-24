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

const handleCoverChange = (options: { file: UploadFileInfo; fileList: UploadFileInfo[] }) => {
  const file = options.file.file
  if (!file) return

  const reader = new FileReader()
  reader.onload = (e) => {
    const result = e.target?.result
    if (typeof result === 'string') {
      meta.value.coverImage = result
    }
  }
  reader.readAsDataURL(file)
}

const handleRemoveCover = () => {
  meta.value.coverImage = null
}
</script>

<template>
  <div class="settings-page h-full flex flex-col overflow-hidden">
    <header class="header-bar flex items-center gap-4 px-6 py-4">
      <NButton quaternary @click="handleBack">
        <span class="i-carbon-arrow-left mr-1" />
        {{ t('settings.back') }}
      </NButton>
      <span class="text-lg font-semibold">{{ t('settings.title') }}</span>
    </header>

    <main class="flex-1 overflow-auto px-6 py-6 max-w-2xl mx-auto w-full">
      <!-- 封面预览 -->
      <div v-if="meta.coverImage" class="mb-6 flex flex-col items-center gap-3">
        <img :src="meta.coverImage" alt="封面" class="w-48 h-64 object-cover rounded-lg shadow-lg" />
        <NButton size="small" type="error" @click="handleRemoveCover">{{ t('settings.removeCover') }}</NButton>
      </div>

      <NForm label-placement="top">
        <NFormItem :label="t('settings.bookTitle')">
          <NInput v-model:value="meta.title" :placeholder="t('settings.bookTitlePlaceholder')" />
        </NFormItem>
        <NFormItem :label="t('settings.authorLabel')">
          <NInput v-model:value="meta.author" :placeholder="t('settings.authorPlaceholder')" />
        </NFormItem>
        <NFormItem :label="t('settings.description')">
          <NInput v-model:value="meta.description" type="textarea" :placeholder="t('settings.descriptionPlaceholder')" :rows="4" />
        </NFormItem>
        <NFormItem :label="t('settings.coverImage')">
          <NUpload
            :max="1"
            accept="image/*"
            :show-file-list="false"
            @change="handleCoverChange"
          >
            <NButton>{{ t('settings.uploadCover') }}</NButton>
          </NUpload>
        </NFormItem>
        <NFormItem :label="t('settings.publishDate')">
          <NDatePicker v-model:value="dateTimestamp" type="date" class="w-full" @update:value="handleDateChange" />
        </NFormItem>
        <NFormItem>
          <div class="flex gap-3">
            <NButton type="primary" @click="handleSave">{{ isNewBook ? t('settings.saveAndEdit') : t('settings.save') }}</NButton>
            <NButton v-if="!isNewBook" @click="router.push(`/editor/${bookId}`)">{{ t('settings.goToEdit') }}</NButton>
          </div>
        </NFormItem>
      </NForm>
    </main>
  </div>
</template>

<style scoped>
.settings-page {
  background: var(--bg-base);
}

.header-bar {
  backdrop-filter: blur(12px);
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border-color);
}
</style>
