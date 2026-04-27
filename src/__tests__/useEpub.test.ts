import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useEpub } from '@/composables/useEpub'

const mocks = vi.hoisted(() => ({
  exportToEpub: vi.fn(),
  downloadEpub: vi.fn(),
}))

vi.mock('@/utils/epub', () => ({
  exportToEpub: mocks.exportToEpub,
  downloadEpub: mocks.downloadEpub,
}))

describe('useEpub', () => {
  beforeEach(() => {
    mocks.exportToEpub.mockReset()
    mocks.downloadEpub.mockReset()
  })

  it('returns saved status after a successful export', async () => {
    const blob = new Blob(['ok'])
    mocks.exportToEpub.mockResolvedValue(blob)
    mocks.downloadEpub.mockResolvedValue({ status: 'saved' })

    const { handleExport, exporting, error } = useEpub()
    const result = await handleExport('book-1', 'demo')

    expect(result).toEqual({ status: 'saved' })
    expect(exporting.value).toBe(false)
    expect(error.value).toBeNull()
    expect(mocks.downloadEpub).toHaveBeenCalledWith(blob, 'demo')
  })

  it('returns cancelled status when the save dialog is cancelled', async () => {
    mocks.exportToEpub.mockResolvedValue(new Blob(['ok']))
    mocks.downloadEpub.mockResolvedValue({ status: 'cancelled' })

    const { handleExport } = useEpub()
    await expect(handleExport('book-1', 'demo')).resolves.toEqual({ status: 'cancelled' })
  })

  it('stores an error when export fails', async () => {
    mocks.exportToEpub.mockRejectedValue(new Error('boom'))

    const { handleExport, exporting, error } = useEpub()
    await expect(handleExport('book-1', 'demo')).rejects.toThrow('boom')

    expect(exporting.value).toBe(false)
    expect(error.value).toBe('boom')
  })
})
