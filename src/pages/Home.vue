<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { NButton, NModal, NForm, NFormItem, NInput, NPopconfirm, NEmpty, useMessage } from 'naive-ui'
import { useBookStore } from '@/stores/book'
import type { BookMeta } from '@/types'

const router = useRouter()
const route = useRoute()
const bookStore = useBookStore()
const message = useMessage()
const { t } = useI18n()

const showModal = ref(false)
const newBookMeta = ref<BookMeta>({
  title: '',
  author: '',
  description: '',
  language: 'zh-CN',
  publishDate: new Date().toISOString().slice(0, 10),
  coverImage: null,
})

onMounted(() => {
  bookStore.initBookList()
  if (route.query.create === '1') {
    showModal.value = true
  }
})

// 监听 query 变化
watch(() => route.query.create, (val) => {
  if (val === '1') {
    showModal.value = true
    router.replace({ path: '/', query: {} })
  }
})

const handleConfirmCreate = async () => {
  if (!newBookMeta.value.title.trim()) {
    message.warning(t('home.inputTitle'))
    return
  }
  const id = await bookStore.createBook({ ...newBookMeta.value })
  showModal.value = false
  newBookMeta.value = {
    title: '',
    author: '',
    description: '',
    language: 'zh-CN',
    publishDate: new Date().toISOString().slice(0, 10),
    coverImage: null,
  }
  message.success(t('home.bookCreated'))
  router.push({ path: `/settings/${id}`, query: { new: '1' } })
}

const handleDeleteBook = async (id: string) => {
  await bookStore.deleteBook(id)
  message.success(t('home.bookDeleted'))
}

const handleOpenBook = (id: string) => {
  router.push(`/editor/${id}`)
}

const handleSettings = (id: string) => {
  router.push(`/settings/${id}`)
}
</script>

<template>
  <div class="home-page h-full flex flex-col overflow-hidden">
    <main class="flex-1 overflow-auto px-6 py-4">
      <!-- 空状态 -->
      <NEmpty v-if="bookStore.books.length === 0" :description="t('home.emptyDesc')" class="mt-20">
        <template #icon>
          <span class="i-carbon-document-blank text-5xl" style="color: var(--text-muted)" />
        </template>
      </NEmpty>

      <!-- 书籍卡片网格 -->
      <div v-else class="book-grid">
        <div
          v-for="book in bookStore.books"
          :key="book.id"
          class="book-card cursor-pointer"
          @click="handleOpenBook(book.id)"
        >
          <!-- 封面 -->
          <div class="book-cover">
            <img v-if="book.meta.coverImage" :src="book.meta.coverImage" alt="cover" class="cover-img" />
            <div v-else class="cover-placeholder">
              <span class="i-carbon-document text-3xl" style="color: var(--text-muted)" />
              <span class="text-xs mt-2 px-2 text-center" style="color: var(--text-muted)">{{ book.meta.title }}</span>
            </div>
            <!-- 悬浮操作 -->
            <div class="book-actions" @click.stop>
              <NButton quaternary size="tiny" circle @click="handleSettings(book.id)">
                <span class="i-carbon-settings" />
              </NButton>
              <NPopconfirm @positive-click="handleDeleteBook(book.id)">
                <template #trigger>
                  <NButton quaternary size="tiny" circle type="error">
                    <span class="i-carbon-trash-can" />
                  </NButton>
                </template>
                {{ t('home.confirmDelete') }}
              </NPopconfirm>
            </div>
          </div>
          <!-- 书名 -->
          <div class="book-info">
            <span class="book-title">{{ book.meta.title }}</span>
            <span class="book-author">{{ book.meta.author || t('home.noAuthor') }}</span>
          </div>
        </div>
      </div>
    </main>

    <!-- 新建书籍弹窗 -->
    <NModal v-model:show="showModal" preset="card" :title="t('app.createBook')" class="max-w-md">
      <NForm label-placement="top">
        <NFormItem :label="t('home.title')">
          <NInput v-model:value="newBookMeta.title" :placeholder="t('settings.bookTitlePlaceholder')" />
        </NFormItem>
        <NFormItem :label="t('home.author')">
          <NInput v-model:value="newBookMeta.author" :placeholder="t('settings.authorPlaceholder')" />
        </NFormItem>
        <NFormItem :label="t('settings.description')">
          <NInput v-model:value="newBookMeta.description" type="textarea" :placeholder="t('settings.descriptionPlaceholder')" :rows="3" />
        </NFormItem>
      </NForm>
      <template #action>
        <div class="flex justify-end gap-2">
          <NButton @click="showModal = false">{{ t('home.cancel') }}</NButton>
          <NButton type="primary" @click="handleConfirmCreate">{{ t('home.create') }}</NButton>
        </div>
      </template>
    </NModal>
  </div>
</template>

<style scoped>
.home-page {
  background: var(--bg-base);
}

.header-bar {
  backdrop-filter: blur(12px);
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border-color);
}

.book-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 24px;
}

.book-card {
  transition: all 0.3s ease;
}

.book-card:hover {
  transform: translateY(-4px);
}

.book-card:hover .book-cover {
  box-shadow: var(--shadow-lg);
}

.book-cover {
  position: relative;
  aspect-ratio: 210 / 297; /* A4 比例 */
  border-radius: 4px 12px 12px 4px;
  overflow: hidden;
  background: var(--bg-elevated);
  box-shadow: var(--shadow-sm), -3px 0 6px rgba(0, 0, 0, 0.15);
  transition: box-shadow 0.3s ease;
  /* 书脊效果 */
  border-left: 4px solid var(--primary-dark);
}

.cover-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.cover-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, var(--bg-elevated) 0%, var(--bg-surface) 100%);
}

.book-actions {
  position: absolute;
  top: 8px;
  right: 8px;
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.2s ease;
  background: var(--bg-card);
  border-radius: 16px;
  padding: 2px;
  backdrop-filter: blur(8px);
}

.book-card:hover .book-actions {
  opacity: 1;
}

.book-info {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.book-title {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.book-author {
  font-size: 0.75rem;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
