<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { NButton, NModal, NForm, NFormItem, NInput, NPopconfirm, NEmpty, useMessage } from 'naive-ui'
import { useBookStore } from '@/stores/book'

const router = useRouter()
const route = useRoute()
const bookStore = useBookStore()
const message = useMessage()
const { t } = useI18n()

const showModal = ref(false)
const newBookTitle = ref('')

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
  if (!newBookTitle.value.trim()) {
    message.warning(t('home.inputTitle'))
    return
  }
  const id = await bookStore.createBook({
    title: newBookTitle.value.trim(),
    author: '',
    description: '',
    language: 'zh-CN',
    publishDate: new Date().toISOString().slice(0, 10),
    coverImage: null,
  })
  showModal.value = false
  newBookTitle.value = ''
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
          <span class="empty-icon i-carbon-document-blank text-5xl" style="color: var(--text-muted)" />
        </template>
      </NEmpty>

      <!-- 书籍卡片网格 -->
      <div v-else class="book-grid">
        <div
          v-for="(book, index) in bookStore.books"
          :key="book.id"
          class="book-card card-enter cursor-pointer"
          :style="{ animationDelay: index * 40 + 'ms' }"
          @click="handleOpenBook(book.id)"
        >
          <!-- 封面 -->
          <div class="book-cover">
            <img v-if="book.meta.coverImage" :src="book.meta.coverImage" alt="cover" class="cover-img" />
            <div v-else class="cover-default" />
            <!-- 封面文字 -->
            <div class="cover-text">
              <span class="cover-title">{{ book.meta.title }}</span>
              <span v-if="book.meta.author" class="cover-author">{{ book.meta.author }}</span>
            </div>
            <!-- 悬浮操作 -->
            <div class="book-actions" @click.stop>
              <NButton size="small" circle @click="handleSettings(book.id)" class="action-btn">
                <span class="i-carbon-settings" />
              </NButton>
              <NPopconfirm :positive-text="t('home.confirm')" :negative-text="t('home.cancel')" @positive-click="handleDeleteBook(book.id)">
                <template #trigger>
                  <NButton size="small" circle type="error" class="action-btn">
                    <span class="i-carbon-trash-can" />
                  </NButton>
                </template>
                {{ t('home.confirmDelete') }}
              </NPopconfirm>
            </div>
          </div>
        </div>
      </div>
    </main>

    <!-- 新建书籍弹窗 -->
    <NModal v-model:show="showModal" preset="card" :title="t('app.createBook')" class="max-w-md">
      <NForm label-placement="top">
        <NFormItem :label="t('home.title')">
          <NInput v-model:value="newBookTitle" :placeholder="t('settings.bookTitlePlaceholder')" @keydown.enter="handleConfirmCreate" />
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

.card-enter {
  animation: card-in 180ms ease both;
}

@keyframes card-in {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: none;
  }
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
}

.cover-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.cover-default {
  position: absolute;
  inset: 0;
  background: linear-gradient(145deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
}

.cover-text {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 12px 16px;
  background: linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.3) 40%, rgba(0,0,0,0.3) 60%, rgba(0,0,0,0) 100%);
}

.cover-title {
  font-size: 0.95rem;
  font-weight: 700;
  color: #fff;
  text-align: center;
  text-shadow: 0 0 8px rgba(255,255,255,0.6), 0 0 20px rgba(100,180,255,0.4), 0 1px 3px rgba(0,0,0,0.8);
  word-break: break-word;
  line-height: 1.3;
}

.cover-author {
  font-size: 0.7rem;
  color: rgba(255,255,255,0.85);
  text-align: center;
  text-shadow: 0 0 6px rgba(255,255,255,0.4), 0 1px 2px rgba(0,0,0,0.8);
  margin-top: 6px;
  word-break: break-word;
}

.book-actions {
  position: absolute;
  top: 8px;
  right: 8px;
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.2s ease;
}

.book-card:hover .book-actions {
  opacity: 1;
}

.action-btn {
  border: none !important;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}

.action-btn:not(.n-button--error-type) {
  background: rgba(255, 255, 255, 0.9) !important;
  color: #333 !important;
}

.empty-icon {
  animation: empty-float 3s ease-in-out infinite;
}

@keyframes empty-float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-4px); }
}

.action-btn:not(.n-button--error-type):hover {
  background: #fff !important;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
}

.action-btn.n-button--error-type {
  background: #e03050 !important;
  color: #fff !important;
}

.action-btn.n-button--error-type:hover {
  background: #c02040 !important;
  box-shadow: 0 4px 12px rgba(224, 48, 80, 0.4);
}

</style>
