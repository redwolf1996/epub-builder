<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
  NButton,
  NEmpty,
  NForm,
  NFormItem,
  NInput,
  NModal,
  NPopconfirm,
  NSelect,
  useMessage,
} from 'naive-ui'
import type { SelectOption } from 'naive-ui'
import { useBookStore } from '@/stores/book'
import type { Book } from '@/types'

const router = useRouter()
const route = useRoute()
const bookStore = useBookStore()
const message = useMessage()
const { t } = useI18n()

const showModal = ref(false)
const newBookTitle = ref('')
const searchQuery = ref('')
const sortBy = ref<'updatedAt' | 'createdAt' | 'title'>('updatedAt')
const sortOptions = computed<SelectOption[]>(() => [
  { label: t('home.sortUpdated'), value: 'updatedAt' },
  { label: t('home.sortCreated'), value: 'createdAt' },
  { label: t('home.sortTitle'), value: 'title' },
])

const getBookTitle = (book: Book) => {
  return book.meta?.title?.trim() || t('home.untitled')
}

const getBookAuthor = (book: Book) => {
  return book.meta?.author?.trim() || ''
}

const filteredBooks = computed(() => {
  const query = searchQuery.value.trim().toLocaleLowerCase()
  const list = query
    ? bookStore.books.filter((book) => {
      const title = getBookTitle(book).toLocaleLowerCase()
      const author = getBookAuthor(book).toLocaleLowerCase()
      return title.includes(query) || author.includes(query)
    })
    : [...bookStore.books]

  return list.sort((a, b) => {
    switch (sortBy.value) {
      case 'createdAt':
        return b.createdAt - a.createdAt
      case 'title':
        return getBookTitle(a).localeCompare(getBookTitle(b))
      case 'updatedAt':
      default:
        return b.updatedAt - a.updatedAt
    }
  })
})

const refreshBookList = async () => {
  await bookStore.initBookList()
}

onMounted(async () => {
  await refreshBookList()

  if (route.query.create === '1') {
    showModal.value = true
  }
})

watch(() => route.query.create, (val) => {
  if (val === '1') {
    showModal.value = true
    router.replace({ path: '/', query: {} })
  }
})

watch(() => route.path, (path) => {
  if (path === '/') {
    void refreshBookList()
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
    <main class="home-main flex-1 overflow-auto px-6 pb-4">
      <div v-if="bookStore.books.length > 0" class="home-toolbar mb-4 flex flex-wrap items-center gap-3">
        <NInput v-model:value="searchQuery" size="large" clearable class="toolbar-search" :placeholder="t('home.searchPlaceholder')">
          <template #prefix>
            <span class="i-carbon-search text-sm" />
          </template>
        </NInput>
        <NSelect v-model:value="sortBy" size="large" class="toolbar-sort" :options="sortOptions" />
      </div>

      <NEmpty v-if="bookStore.books.length === 0" :description="t('home.emptyDesc')" class="mt-20">
        <template #icon>
          <span class="empty-icon i-carbon-document-blank text-5xl" style="color: var(--text-muted)" />
        </template>
        <template #default>
          <div class="mt-3 text-sm" style="color: var(--text-secondary)">{{ t('home.emptyTitle') }}</div>
        </template>
        <template #extra>
          <NButton type="primary" @click="showModal = true">
            <template #icon>
              <span class="i-carbon-add" />
            </template>
            {{ t('app.createBook') }}
          </NButton>
        </template>
      </NEmpty>

      <div v-else-if="filteredBooks.length > 0" class="book-grid">
        <article
          v-for="(book, index) in filteredBooks"
          :key="book.id"
          class="book-card card-enter"
          :style="{ animationDelay: `${index * 40}ms` }"
        >
          <div class="card-surface">
            <div
              class="book-cover"
              :class="{ 'is-default-cover': !book.meta.coverImage }"
              role="button"
              tabindex="0"
              @click="handleOpenBook(book.id)"
              @keydown.enter="handleOpenBook(book.id)"
              @keydown.space.prevent="handleOpenBook(book.id)"
            >
              <img v-if="book.meta.coverImage" :src="book.meta.coverImage" alt="cover" class="cover-img" />
              <div v-else class="cover-default" />
              <span class="cover-page-edge" />
              <div class="cover-actions">
                <NButton size="small" circle class="cover-action-btn" @click.stop="handleSettings(book.id)">
                  <span class="i-carbon-settings text-sm" />
                </NButton>
                <NPopconfirm
                  :positive-text="t('home.confirm')"
                  :negative-text="t('home.cancel')"
                  @positive-click="handleDeleteBook(book.id)"
                >
                  <template #trigger>
                    <NButton size="small" circle type="error" class="cover-action-btn cover-action-danger" @click.stop>
                      <span class="i-carbon-trash-can text-sm" />
                    </NButton>
                  </template>
                  {{ t('home.confirmDelete') }}
                </NPopconfirm>
              </div>
              <div class="cover-text">
                <span class="cover-title">{{ getBookTitle(book) }}</span>
                <span v-if="getBookAuthor(book)" class="cover-author">{{ getBookAuthor(book) }}</span>
              </div>
            </div>
          </div>
        </article>
      </div>

      <NEmpty v-else :description="t('home.emptySearch')" class="mt-20">
        <template #icon>
          <span class="i-carbon-search text-5xl" style="color: var(--text-muted)" />
        </template>
      </NEmpty>
    </main>

    <NModal v-model:show="showModal" preset="card" :title="t('app.createBook')" class="max-w-md">
      <NForm label-placement="top">
        <NFormItem :label="t('home.title')">
          <NInput
            v-model:value="newBookTitle"
            :placeholder="t('settings.bookTitlePlaceholder')"
            @keydown.enter="handleConfirmCreate"
          />
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

.home-main {
  padding-top: 0;
}

.home-toolbar {
  position: sticky;
  top: 0;
  z-index: 8;
  width: calc(100% + 48px);
  margin-left: -24px;
  margin-right: -24px;
  min-height: 64px;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  background: color-mix(in srgb, var(--bg-base) 88%, transparent);
  border-bottom: 1px solid color-mix(in srgb, var(--border-color) 72%, transparent);
  backdrop-filter: blur(12px);
}

.toolbar-search {
  min-width: 240px;
  max-width: 400px;
  flex: 1 1 320px;
}

.toolbar-sort {
  width: 168px;
  flex: 0 0 168px;
}

.book-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 20px;
}

.card-surface {
  display: block;
  border: 0;
  background: transparent;
  padding: 0;
  text-align: left;
  cursor: pointer;
  perspective: 1200px;
}

.card-enter {
  animation: card-in 180ms ease both;
}

.book-card {
  position: relative;
}

.book-card::after {
  content: '';
  position: absolute;
  left: 10px;
  right: 10px;
  bottom: 2px;
  height: 18px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.18);
  filter: blur(10px);
  opacity: 0.72;
  transform: translateY(6px);
  transition: opacity 0.22s ease, transform 0.22s ease, filter 0.22s ease;
  pointer-events: none;
}

.book-card:hover::after,
.book-card:focus-within::after {
  opacity: 0.88;
  transform: translateY(10px) scaleX(0.96);
  filter: blur(12px);
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

.book-cover {
  position: relative;
  aspect-ratio: 210 / 297;
  border-radius: 4px 0 0 4px;
  overflow: hidden;
  background: var(--bg-elevated);
  border: 1px solid color-mix(in srgb, var(--border-color) 78%, rgba(255, 255, 255, 0.08));
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.08) inset,
    0 0 0 1px rgba(0, 0, 0, 0.06),
    0 14px 22px rgba(0, 0, 0, 0.16),
    0 4px 8px rgba(0, 0, 0, 0.08),
    -18px 0 0 rgba(0, 0, 0, 0.08) inset,
    -14px 0 0 rgba(255, 255, 255, 0.05) inset,
    4px 0 0 rgba(255, 255, 255, 0.9) inset;
  transform-origin: left center;
  transform: none;
  transition: transform 0.22s ease, box-shadow 0.22s ease;
}

.card-surface:hover .book-cover {
  transform: translateY(-4px) rotateY(-6deg);
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.1) inset,
    0 0 0 1px rgba(0, 0, 0, 0.08),
    0 20px 30px rgba(0, 0, 0, 0.18),
    0 6px 10px rgba(0, 0, 0, 0.08),
    -18px 0 0 rgba(0, 0, 0, 0.1) inset,
    -14px 0 0 rgba(255, 255, 255, 0.06) inset,
    5px 0 0 rgba(255, 255, 255, 0.94) inset;
}

.cover-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.cover-default {
  position: absolute;
  inset: 0;
  background:
    linear-gradient(90deg, rgba(98, 59, 26, 0.58) 0, rgba(75, 45, 20, 0.5) 14px, rgba(255, 255, 255, 0.08) 15px, transparent 24px),
    linear-gradient(145deg, #f0d7a4 0%, #d7b47f 52%, #b78452 100%);
}

.cover-default::before {
  content: '';
  position: absolute;
  inset: 14px 16px;
  border: 1px solid rgba(88, 58, 24, 0.24);
  border-radius: 3px 6px 6px 3px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.06), rgba(88, 58, 24, 0.04)),
    repeating-linear-gradient(
      180deg,
      transparent 0 16px,
      rgba(88, 58, 24, 0.05) 16px 17px
    );
  pointer-events: none;
}

.cover-default::after {
  content: '';
  position: absolute;
  left: 18px;
  right: 18px;
  top: 22%;
  height: 1px;
  background: rgba(88, 58, 24, 0.26);
  box-shadow:
    0 10px 0 rgba(88, 58, 24, 0.14),
    0 20px 0 rgba(88, 58, 24, 0.14);
  pointer-events: none;
}

.book-cover.is-default-cover .cover-text {
  background:
    radial-gradient(circle at center, rgba(255, 248, 233, 0.06) 0%, rgba(88, 58, 24, 0.12) 42%, rgba(58, 32, 12, 0.24) 100%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.04) 0%, rgba(88, 58, 24, 0.18) 58%, rgba(58, 32, 12, 0.08) 100%);
}

.book-cover.is-default-cover .cover-title {
  color: #fff9ee;
  text-shadow:
    0 1px 2px rgba(88, 58, 24, 0.28),
    0 3px 10px rgba(88, 58, 24, 0.22);
}

.book-cover.is-default-cover .cover-author {
  color: rgba(255, 248, 233, 0.88);
  text-shadow:
    0 1px 2px rgba(88, 58, 24, 0.22),
    0 2px 8px rgba(88, 58, 24, 0.18);
}

.book-cover::after {
  content: '';
  position: absolute;
  inset: 0;
  background:
    linear-gradient(90deg, rgba(0, 0, 0, 0.1) 0, transparent 14px),
    linear-gradient(180deg, rgba(6, 10, 18, 0.6) 0%, rgba(6, 10, 18, 0.22) 18%, rgba(6, 10, 18, 0) 42%);
  opacity: 0;
  transition: opacity 0.18s ease;
  pointer-events: none;
}

.book-cover::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 16px;
  background:
    linear-gradient(90deg, rgba(0, 0, 0, 0.28) 0, rgba(0, 0, 0, 0.12) 68%, rgba(255, 255, 255, 0.08) 100%);
  border-right: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow:
    inset -1px 0 0 rgba(255, 255, 255, 0.08),
    inset -4px 0 8px rgba(255, 255, 255, 0.05);
  pointer-events: none;
}

.book-cover.is-default-cover::after {
  background:
    linear-gradient(90deg, rgba(78, 46, 20, 0.12) 0, transparent 14px),
    linear-gradient(180deg, rgba(255, 255, 255, 0.06) 0%, rgba(88, 58, 24, 0.12) 18%, rgba(58, 32, 12, 0) 42%);
}

.book-cover.is-default-cover::before {
  background:
    linear-gradient(90deg, rgba(110, 66, 28, 0.55) 0, rgba(94, 56, 24, 0.42) 68%, rgba(255, 245, 228, 0.12) 100%);
  border-right-color: rgba(255, 248, 233, 0.18);
  box-shadow:
    inset -1px 0 0 rgba(255, 248, 233, 0.16),
    inset -4px 0 8px rgba(255, 248, 233, 0.08);
}

.book-cover > .cover-page-edge {
  position: absolute;
  top: 3px;
  bottom: 3px;
  right: 0;
  width: 6px;
  background:
    repeating-linear-gradient(
      180deg,
      rgba(255, 255, 255, 0.98) 0 2px,
      rgba(248, 248, 246, 0.96) 2px 4px
    );
  border-left: 1px solid rgba(0, 0, 0, 0.05);
  box-shadow:
    inset 1px 0 0 rgba(255, 255, 255, 0.92),
    inset -1px 0 0 rgba(233, 233, 229, 0.85);
  pointer-events: none;
}

.book-card:hover .book-cover::after,
.book-card:focus-within .book-cover::after {
  opacity: 1;
}

.cover-actions {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 2;
  display: flex;
  gap: 8px;
  opacity: 0;
  transform: translateY(-2px);
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.book-card:hover .cover-actions,
.book-card:focus-within .cover-actions {
  opacity: 1;
  transform: translateY(0);
}

.cover-action-btn {
  border: 1px solid rgba(255, 255, 255, 0.18) !important;
  background: rgba(10, 14, 22, 0.82) !important;
  color: #fff !important;
  backdrop-filter: blur(10px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.cover-action-btn:hover {
  background: rgba(18, 24, 36, 0.94) !important;
  color: #fff !important;
}

.cover-action-danger {
  border-color: rgba(255, 120, 120, 0.3) !important;
  background: rgba(127, 29, 29, 0.86) !important;
}

.cover-action-danger:hover {
  background: rgba(153, 27, 27, 0.96) !important;
}

.cover-text {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 18px 26px 18px 22px;
  background:
    radial-gradient(circle at center, rgba(0, 0, 0, 0.18) 0%, rgba(0, 0, 0, 0.28) 38%, rgba(0, 0, 0, 0.42) 100%),
    linear-gradient(180deg, rgba(0, 0, 0, 0.18) 0%, rgba(0, 0, 0, 0.46) 55%, rgba(0, 0, 0, 0.2) 100%);
}

.cover-title {
  font-size: 1rem;
  font-weight: 700;
  line-height: 1.35;
  color: #fff;
  text-align: center;
  word-break: break-word;
  text-shadow:
    0 0 6px rgba(255, 255, 255, 0.95),
    0 0 14px rgba(130, 210, 255, 0.85),
    0 0 26px rgba(130, 210, 255, 0.55),
    0 2px 6px rgba(0, 0, 0, 0.92),
    0 0 2px rgba(0, 0, 0, 1);
  filter: saturate(1.08);
}

.cover-author {
  margin-top: 8px;
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.9);
  text-align: center;
  text-shadow:
    0 0 5px rgba(255, 255, 255, 0.8),
    0 0 10px rgba(176, 230, 255, 0.62),
    0 1px 4px rgba(0, 0, 0, 0.88);
}

.empty-icon {
  animation: empty-float 3s ease-in-out infinite;
}

@keyframes empty-float {
  0%, 100% {
    transform: translateY(0);
  }

  50% {
    transform: translateY(-4px);
  }
}

@media (max-width: 767px) {
  .home-toolbar {
    width: calc(100% + 48px);
    margin-left: -24px;
    margin-right: -24px;
    padding: 0 24px;
  }

  .book-grid {
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 16px;
  }

  .toolbar-sort {
    width: 100%;
  }
}
</style>
