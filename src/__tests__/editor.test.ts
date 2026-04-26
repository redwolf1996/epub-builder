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

  it('charCount 返回纯文本长度', () => {
    const store = useEditorStore()
    store.content = 'Hello 世界'
    expect(store.charCount).toBe(8)
  })

  it('wordCount 混合 CJK + 英文计数', () => {
    const store = useEditorStore()
    store.content = '你好世界 hello world'
    expect(store.wordCount).toBe(6) // 4 CJK + 2 English words
  })

  it('wordCount 纯英文计数', () => {
    const store = useEditorStore()
    store.content = 'hello world test'
    expect(store.wordCount).toBe(3)
  })

  it('saveStatus 状态机：idle → dirty → saving → saved', () => {
    const store = useEditorStore()
    expect(store.saveStatus).toBe('idle')

    store.setContent('new content')
    expect(store.saveStatus).toBe('dirty')

    vi.advanceTimersByTime(500)
    expect(store.saveStatus).toBe('saving')

    // saveCurrentChapter 是 async，需要 flush microtasks
    return vi.runAllTimersAsync().then(() => {
      expect(store.saveStatus).toBe('saved')
    })
  })

  it('flushSave 在 dirty 状态下立即保存', () => {
    const store = useEditorStore()
    store.setContent('content')
    expect(store.saveStatus).toBe('dirty')

    store.flushSave()
    expect(store.saveStatus).toBe('saving')

    return vi.runAllTimersAsync().then(() => {
      expect(store.saveStatus).toBe('saved')
    })
  })

  it('cancelPendingSave 取消后不触发保存', () => {
    const store = useEditorStore()
    store.setContent('content')
    store.cancelPendingSave()

    vi.advanceTimersByTime(500)
    expect(store.saveStatus).toBe('dirty')
  })
})
