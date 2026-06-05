'use client'

import { useRef, useState } from 'react'

interface Props {
  onPhotosChange: (base64s: string[]) => void
  disabled?: boolean
}

const MAX_PHOTOS = 3

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas')
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const max = 1024
      let { width, height } = img
      if (width > max || height > max) {
        if (width > height) { height = Math.round(height * max / width); width = max }
        else { width = Math.round(width * max / height); height = max }
      }
      canvas.width = width
      canvas.height = height
      canvas.getContext('2d')!.drawImage(img, 0, 0, width, height)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/jpeg', 0.85).split(',')[1])
    }
    img.onerror = reject
    img.src = url
  })
}

export default function PhotoCapture({ onPhotosChange, disabled }: Props) {
  const [photos, setPhotos] = useState<{ preview: string; base64: string }[]>([])
  const cameraRef = useRef<HTMLInputElement>(null)
  const galleryRef = useRef<HTMLInputElement>(null)

  const addFiles = async (files: FileList | null) => {
    if (!files) return
    const remaining = MAX_PHOTOS - photos.length
    const toAdd = Array.from(files).slice(0, remaining)
    const newPhotos = await Promise.all(
      toAdd.map(async f => ({
        preview: URL.createObjectURL(f),
        base64: await fileToBase64(f),
      }))
    )
    const updated = [...photos, ...newPhotos]
    setPhotos(updated)
    onPhotosChange(updated.map(p => p.base64))
  }

  const remove = (index: number) => {
    const updated = photos.filter((_, i) => i !== index)
    setPhotos(updated)
    onPhotosChange(updated.map(p => p.base64))
  }

  return (
    <div className="bg-[#111827] rounded-xl p-3 mb-3">
      <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-2">
        Photos ({photos.length}/{MAX_PHOTOS})
      </p>
      <div className="grid grid-cols-3 gap-2 mb-3">
        {Array.from({ length: MAX_PHOTOS }).map((_, i) => {
          const photo = photos[i]
          return photo ? (
            <div key={i} className="relative rounded-lg overflow-hidden h-20 bg-blue-950">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.preview} alt="" className="w-full h-full object-cover" />
              <button
                onClick={() => remove(i)}
                disabled={disabled}
                className="absolute top-1 right-1 bg-red-500 rounded-full w-5 h-5 flex items-center justify-center text-white text-[10px] font-bold"
              >✕</button>
            </div>
          ) : (
            <div
              key={i}
              className="h-20 rounded-lg border-[1.5px] border-dashed border-slate-600 flex flex-col items-center justify-center text-slate-600"
            >
              <span className="text-xl">+</span>
              <span className="text-[9px]">add</span>
            </div>
          )
        })}
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => cameraRef.current?.click()}
          disabled={disabled || photos.length >= MAX_PHOTOS}
          className="flex-1 bg-sky-600 disabled:opacity-40 rounded-lg py-2 text-white text-xs font-bold"
        >📷 Camera</button>
        <button
          onClick={() => galleryRef.current?.click()}
          disabled={disabled || photos.length >= MAX_PHOTOS}
          className="flex-1 bg-[#1e293b] disabled:opacity-40 rounded-lg py-2 text-slate-300 text-xs"
        >🖼 Gallery</button>
      </div>
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" multiple className="hidden"
        onChange={e => addFiles(e.target.files)} />
      <input ref={galleryRef} type="file" accept="image/*" multiple className="hidden"
        onChange={e => addFiles(e.target.files)} />
    </div>
  )
}
