'use client'

import { useRef, useState } from 'react'

interface PhotoCaptureProps {
  onPhotosChange: (photos: string[]) => void
  maxPhotos?: number
}

const MAX_PHOTOS = 3

async function fileToBase64(file: File, maxDimension: number = 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const img = new window.Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        let { width, height } = img

        // Calculate new dimensions maintaining aspect ratio
        if (width > height) {
          if (width > maxDimension) {
            height = Math.round((height * maxDimension) / width)
            width = maxDimension
          }
        } else {
          if (height > maxDimension) {
            width = Math.round((width * maxDimension) / height)
            height = maxDimension
          }
        }

        canvas.width = width
        canvas.height = height

        const ctx = canvas.getContext('2d')
        if (!ctx) {
          reject(new Error('Failed to get canvas context'))
          return
        }

        ctx.drawImage(img, 0, 0, width, height)
        const base64 = canvas.toDataURL('image/jpeg', 0.85)
        resolve(base64)
      }
      img.onerror = () => reject(new Error('Failed to load image'))
      img.src = e.target?.result as string
    }
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}

export function PhotoCapture({ onPhotosChange, maxPhotos = MAX_PHOTOS }: PhotoCaptureProps) {
  const [photos, setPhotos] = useState<string[]>([])
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const galleryInputRef = useRef<HTMLInputElement>(null)

  const handlePhotoSelect = async (files: FileList | null) => {
    if (!files) return

    const newPhotos = [...photos]
    for (let i = 0; i < files.length && newPhotos.length < maxPhotos; i++) {
      try {
        const base64 = await fileToBase64(files[i])
        newPhotos.push(base64)
      } catch (error) {
        console.error('Failed to process image:', error)
      }
    }

    setPhotos(newPhotos)
    onPhotosChange(newPhotos)

    // Reset input so same file can be selected again
    if (cameraInputRef.current) cameraInputRef.current.value = ''
    if (galleryInputRef.current) galleryInputRef.current.value = ''
  }

  const handleRemovePhoto = (index: number) => {
    const newPhotos = photos.filter((_, i) => i !== index)
    setPhotos(newPhotos)
    onPhotosChange(newPhotos)
  }

  const hasSpace = photos.length < maxPhotos

  return (
    <div className="space-y-4 p-4 bg-color-surface2 rounded-lg border border-color-border">
      <h2 className="text-sm font-semibold text-color-foreground">
        Capture Photos
        <span className="ml-2 text-xs text-color-muted">
          ({photos.length}/{maxPhotos})
        </span>
      </h2>

      <div className="flex gap-2">
        <button
          onClick={() => cameraInputRef.current?.click()}
          disabled={!hasSpace}
          className="flex-1 px-3 py-2 text-sm font-medium rounded bg-color-accent text-color-foreground hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
        >
          📷 Camera
        </button>
        <button
          onClick={() => galleryInputRef.current?.click()}
          disabled={!hasSpace}
          className="flex-1 px-3 py-2 text-sm font-medium rounded bg-color-accent text-color-foreground hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
        >
          🖼️ Gallery
        </button>
      </div>

      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(e) => handlePhotoSelect(e.target.files)}
        className="hidden"
      />

      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={(e) => handlePhotoSelect(e.target.files)}
        className="hidden"
      />

      <div className="grid grid-cols-3 gap-2">
        {Array.from({ length: maxPhotos }).map((_, index) => {
          const photo = photos[index]
          return (
            <div
              key={index}
              className="relative aspect-square rounded-lg bg-color-surface3 border border-color-border overflow-hidden group"
            >
              {photo ? (
                <>
                  <img
                    src={photo}
                    alt={`Photo ${index + 1}`}
                    className="w-full h-full object-cover"
                  />
                  <button
                    onClick={() => handleRemovePhoto(index)}
                    className="absolute inset-0 bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                  >
                    <span className="text-2xl">✕</span>
                  </button>
                </>
              ) : (
                <div className="w-full h-full flex items-center justify-center text-color-muted text-2xl">
                  📸
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
