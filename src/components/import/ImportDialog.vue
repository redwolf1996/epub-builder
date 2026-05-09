<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NAlert, NButton, NModal, NRadio, NRadioGroup, NSpin, NTag, useMessage } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { useImport } from '@/composables/useImport'
import type { ApplyImportResult, ImportDocument, ImportMode } from '@/types'

const props = defineProps<{
  currentBookId?: string
  currentChapterId?: string
  allowChapterTargets?: boolean
}>()

const emit = defineEmits<{
  applied: [payload: { result: ApplyImportResult; mode: ImportMode; document: ImportDocument }]
}>()

const show = defineModel<boolean>('show', { required: true })

const { t } = useI18n()
const message = useMessage()
const {
  importing,
  parsedDocument,
  importError,
  canApplyImport,
  parseImportFile,
  applyImportDocument,
  resetImportState,
} = useImport()

const fileInputRef = ref<HTMLInputElement | null>(null)
const selectedFile = ref<File | null>(null)
const selectedMode = ref<ImportMode>('newBook')
const applying = ref(false)

const formatLabelMap: Record<ImportDocument['format'], string> = {
  markdown: 'Markdown',
  epub: 'EPUB',
  pdf: 'PDF',
  docx: 'Word (.docx)',
}

const modeOptions = computed(() => {
  const options: Array<{ value: ImportMode; label: string; description: string }> = [{
    value: 'newBook',
    label: t('import.modeNewBook'),
    description: t('import.modeNewBookDesc'),
  }]

  if (props.allowChapterTargets) {
    options.push(
      {
        value: 'appendToCurrentChapter',
        label: t('import.modeAppend'),
        description: t('import.modeAppendDesc'),
      },
      {
        value: 'insertAsSiblingChapters',
        label: t('import.modeSibling'),
        description: t('import.modeSiblingDesc'),
      },
    )
  }

  return options
})

const warningMessages = computed(() => parsedDocument.value?.warnings ?? [])

const selectedFormatLabel = computed(() => {
  if (!parsedDocument.value) return '...'
  return formatLabelMap[parsedDocument.value.format]
})

const localizedWarnings = computed(() => warningMessages.value.map((warning) => {
  switch (warning.code) {
    case 'empty-epub':
      return t('import.warningEmptyEpub')
    case 'pdf-low-text':
      return t('import.warningPdfLowText')
    case 'word-import-warning':
      return t('import.warningWordUnsupported')
    default:
      return warning.message
  }
}))

const sectionCount = computed(() => {
  const countSections = (sections: ImportDocument['sections']): number => sections.reduce((count, section) => {
    return count + 1 + countSections(section.children)
  }, 0)

  return parsedDocument.value ? countSections(parsedDocument.value.sections) : 0
})

const importingDescription = computed(() => {
  if (!selectedFile.value) return ''

  const ext = selectedFile.value.name.split('.').pop()?.toLowerCase()
  if (ext === 'epub') {
    return t('import.epubParsing')
  }
  if (ext === 'pdf') {
    return t('import.pdfParsing')
  }
  if (ext === 'docx') {
    return t('import.wordParsing')
  }

  return t('import.genericParsing')
})

const resetDialog = () => {
  selectedFile.value = null
  selectedMode.value = 'newBook'
  resetImportState()
  if (fileInputRef.value) {
    fileInputRef.value.value = ''
  }
}

watch(show, (value) => {
  if (!value) {
    resetDialog()
  }
})

const triggerPickFile = () => {
  fileInputRef.value?.click()
}

const handleFileChange = async (event: Event) => {
  const input = event.target as HTMLInputElement | null
  const file = input?.files?.[0]
  if (!file) return

  selectedFile.value = file

  try {
    await parseImportFile(file)
  } catch (error) {
    const reason = error instanceof Error ? error.message : t('import.parseFailed')
    message.error(reason)
  }
}

const handleApply = async () => {
  if (!parsedDocument.value) return

  applying.value = true
  try {
    const result = await applyImportDocument(
      {
        bookId: props.currentBookId,
        chapterId: props.currentChapterId,
      },
      parsedDocument.value,
      selectedMode.value,
    )

    emit('applied', {
      result,
      mode: selectedMode.value,
      document: parsedDocument.value,
    })
    show.value = false
  } catch (error) {
    const reason = error instanceof Error
      ? (error.message || t('import.applyFailed'))
      : String(error || t('import.applyFailed'))
    message.error(reason)
  } finally {
    applying.value = false
  }
}
</script>

<template>
  <NModal v-model:show="show" preset="card" :title="t('import.title')" class="max-w-2xl">
    <div class="import-dialog">
      <input
        ref="fileInputRef"
        class="hidden"
        type="file"
        accept=".md,.markdown,.epub,.pdf,.docx"
        @change="handleFileChange"
      >

      <section class="import-step">
        <div class="import-step-title">{{ t('import.stepFile') }}</div>
        <div class="import-step-body">
          <NButton type="primary" secondary @click="triggerPickFile">
            <span class="i-carbon-document-add mr-1" />
            {{ selectedFile ? t('import.changeFile') : t('import.chooseFile') }}
          </NButton>
          <span v-if="selectedFile" class="import-file-name">{{ selectedFile.name }}</span>
        </div>
        <div class="import-supported-formats">{{ t('import.supportedFormats') }}</div>
      </section>

      <section v-if="selectedFile" class="import-step">
        <div class="import-step-title">{{ t('import.stepFormat') }}</div>
        <div class="import-step-body">
          <NTag size="small" type="info">{{ selectedFormatLabel }}</NTag>
          <span class="import-meta-text">{{ t('import.sourceName', { name: selectedFile.name }) }}</span>
        </div>
      </section>

      <section v-if="selectedFile" class="import-step">
        <div class="import-step-title">{{ t('import.stepTarget') }}</div>
        <NRadioGroup v-model:value="selectedMode" name="import-mode" class="import-mode-group">
          <label
            v-for="option in modeOptions"
            :key="option.value"
            class="import-mode-option"
          >
            <div class="flex items-start gap-2">
              <NRadio :value="option.value" />
              <div class="flex flex-col gap-1">
                <span class="import-mode-label">{{ option.label }}</span>
                <span class="import-mode-desc">{{ option.description }}</span>
              </div>
            </div>
          </label>
        </NRadioGroup>
      </section>

      <section v-if="selectedFile" class="import-step">
        <div class="import-step-title">{{ t('import.stepPreview') }}</div>
        <NSpin :show="importing" :description="importingDescription">
          <div v-if="parsedDocument" class="import-preview">
            <div class="import-preview-grid">
              <div>
                <div class="import-preview-label">{{ t('import.bookTitle') }}</div>
                <div class="import-preview-value">{{ parsedDocument.meta.title || t('home.untitled') }}</div>
              </div>
              <div>
                <div class="import-preview-label">{{ t('import.sectionCount') }}</div>
                <div class="import-preview-value">{{ sectionCount }}</div>
              </div>
            </div>

            <NAlert v-if="warningMessages.length > 0" type="warning" :title="t('import.warningTitle')">
              <ul class="import-warning-list">
                <li v-for="(warning, index) in localizedWarnings" :key="warningMessages[index].code">{{ warning }}</li>
              </ul>
            </NAlert>
          </div>
        </NSpin>

        <NAlert v-if="importError" type="error" :title="t('import.parseFailed')">
          {{ importError }}
        </NAlert>
      </section>
    </div>

    <template #action>
      <div class="flex justify-end gap-2">
        <NButton @click="show = false">{{ t('home.cancel') }}</NButton>
        <NButton type="primary" :loading="applying" :disabled="!canApplyImport" @click="handleApply">
          {{ t('import.confirm') }}
        </NButton>
      </div>
    </template>
  </NModal>
</template>

<style scoped>
.import-dialog {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.import-step {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.import-step-title {
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 700;
}

.import-step-body {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.import-file-name,
.import-supported-formats,
.import-meta-text,
.import-mode-desc,
.import-preview-label {
  color: var(--text-secondary);
  font-size: 12px;
}

.import-mode-group {
  display: grid;
  gap: 8px;
}

.import-mode-option {
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 10px 12px;
  cursor: pointer;
}

.import-mode-label,
.import-preview-value {
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 600;
}

.import-preview {
  display: grid;
  gap: 12px;
}

.import-preview-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.import-warning-list {
  margin: 0;
  padding-left: 18px;
}

@media (max-width: 767px) {
  .import-preview-grid {
    grid-template-columns: 1fr;
  }
}
</style>
