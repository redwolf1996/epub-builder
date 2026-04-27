import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useEditorStore } from '@/stores/editor'

describe('useEditorStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns character count for plain text', () => {
    const store = useEditorStore()
    store.content = 'Hello 世界'
    expect(store.charCount).toBe(8)
  })

  it('counts mixed CJK and english words', () => {
    const store = useEditorStore()
    store.content = '你好世界 hello world'
    expect(store.wordCount).toBe(6)
  })

  it('counts english words', () => {
    const store = useEditorStore()
    store.content = 'hello world test'
    expect(store.wordCount).toBe(3)
  })

  it('transitions saveStatus through dirty to saved', async () => {
    const store = useEditorStore()
    expect(store.saveStatus).toBe('idle')

    store.setContent('new content')
    expect(store.saveStatus).toBe('dirty')

    vi.advanceTimersByTime(500)
    await vi.runAllTimersAsync()
    expect(store.saveStatus).toBe('saved')
  })

  it('flushSave persists immediately', async () => {
    const store = useEditorStore()
    store.setContent('content')
    expect(store.saveStatus).toBe('dirty')

    await store.flushSave()
    expect(store.saveStatus).toBe('saved')
  })

  it('cancelPendingSave prevents the debounced save', async () => {
    const store = useEditorStore()
    store.setContent('content')
    store.cancelPendingSave()

    vi.advanceTimersByTime(500)
    await vi.runAllTimersAsync()
    expect(store.saveStatus).toBe('dirty')
  })
})
