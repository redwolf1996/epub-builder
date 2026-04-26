const MAX_SIZE_KB = 2048
const MAX_DIMENSION = 800
const JPEG_QUALITY = 0.8

export async function compressImage(file: File): Promise<string> {
  // 非图片直接拒绝
  if (!file.type.startsWith('image/')) {
    throw new Error('Not an image file')
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const result = e.target?.result
      if (typeof result !== 'string') {
        reject(new Error('Failed to read file'))
        return
      }

      // 小图且非大尺寸，直接返回原 data URL
      if (file.size <= MAX_SIZE_KB * 1024) {
        const img = new Image()
        img.onload = () => {
          if (img.width <= MAX_DIMENSION && img.height <= MAX_DIMENSION) {
            resolve(result)
            return
          }
          // 尺寸超标，需要压缩
          doCompress(img).then(resolve).catch(reject)
        }
        img.onerror = () => reject(new Error('Failed to load image'))
        img.src = result
        return
      }

      // 大图：Canvas 压缩
      const img = new Image()
      img.onload = () => {
        doCompress(img).then(resolve).catch(reject)
      }
      img.onerror = () => reject(new Error('Failed to load image'))
      img.src = result
    }
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}

function doCompress(img: HTMLImageElement): Promise<string> {
  return new Promise((resolve, reject) => {
    let { width, height } = img
    if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
      const ratio = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height)
      width = Math.round(width * ratio)
      height = Math.round(height * ratio)
    }

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      reject(new Error('Canvas not supported'))
      return
    }
    ctx.drawImage(img, 0, 0, width, height)

    const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY)
    // 检查压缩后大小
    const sizeKB = Math.round((dataUrl.length - 'data:image/jpeg;base64,'.length) * 3 / 4 / 1024)
    if (sizeKB > MAX_SIZE_KB) {
      reject(new Error(`Image too large after compression (${sizeKB}KB)`))
      return
    }
    resolve(dataUrl)
  })
}
