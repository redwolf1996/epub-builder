import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { debounce } from '@/utils/debounce'

describe('debounce', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('仅执行最后一次调用', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 100)

    debounced('a')
    debounced('b')
    debounced('c')

    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(100)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith('c')
  })

  it('cancel 取消待执行的调用', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 100)

    debounced('a')
    debounced.cancel()

    vi.advanceTimersByTime(100)
    expect(fn).not.toHaveBeenCalled()
  })

  it('flush 立即执行并使用传入参数', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 100)

    debounced('a')
    debounced.flush('b')

    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith('b')
  })

  it('flush 后 timer 已清除，后续延迟调用正常', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 100)

    debounced('a')
    debounced.flush('b')
    debounced('c')

    vi.advanceTimersByTime(100)
    expect(fn).toHaveBeenCalledTimes(2)
    expect(fn).toHaveBeenLastCalledWith('c')
  })
})
