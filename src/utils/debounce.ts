export interface DebouncedFn<T extends (...args: never[]) => void> {
  (...args: Parameters<T>): void
  cancel: () => void
  flush: (...args: Parameters<T>) => void
}

export function debounce<T extends (...args: never[]) => void>(
  fn: T,
  delay: number,
): DebouncedFn<T> {
  let timer: ReturnType<typeof setTimeout> | null = null

  const debounced = (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      fn(...args)
    }, delay)
  }

  debounced.cancel = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  debounced.flush = (...args: Parameters<T>) => {
    debounced.cancel()
    fn(...args)
  }

  return debounced
}
