'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

interface PhotoEntry {
  preview: string
  base64: string
}

interface Props {
  open: boolean
  onClose: () => void
  onAnalyze: (photos: PhotoEntry[]) => void
}

const MAX_PHOTOS = 3

export function computeResizeDimensions(
  width: number,
  height: number,
  maxPx = 1024
): { width: number; height: number } {
  if (width <= maxPx && height <= maxPx) return { width, height }
  if (width > height) {
    return { width: maxPx, height: Math.round(height * maxPx / width) }
  }
  return { width: Math.round(width * maxPx / height), height: maxPx }
}

export function captureFrame(video: HTMLVideoElement): string {
  const canvas = document.createElement('canvas')
  canvas.width = video.videoWidth
  canvas.height = video.videoHeight
  canvas.getContext('2d')!.drawImage(video, 0, 0)
  return canvas.toDataURL('image/jpeg', 0.85)
}

export async function resizeDataUrl(dataUrl: string, maxPx = 1024): Promise<string> {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => {
      const { width, height } = computeResizeDimensions(img.naturalWidth, img.naturalHeight, maxPx)
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      canvas.getContext('2d')!.drawImage(img, 0, 0, width, height)
      resolve(canvas.toDataURL('image/jpeg', 0.85).split(',')[1])
    }
    img.src = dataUrl
  })
}

export async function fileToEntry(file: File): Promise<PhotoEntry> {
  const preview = URL.createObjectURL(file)
  const base64 = await resizeDataUrl(preview)
  return { preview, base64 }
}

export default function CameraOverlay({ open, onClose, onAnalyze }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const galleryRef = useRef<HTMLInputElement>(null)
  const [photos, setPhotos] = useState<PhotoEntry[]>([])
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment')
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null)
  const [fallback, setFallback] = useState(false)

  const stopStream = useCallback((stream: MediaStream | null) => {
    stream?.getTracks().forEach(t => t.stop())
  }, [])

  useEffect(() => {
    if (!open) {
      stopStream(mediaStream)
      setMediaStream(null)
      setPhotos(prev => {
        prev.forEach(p => {
          // Only revoke blob: URLs (gallery files), not data: URLs (camera captures)
          if (p.preview.startsWith('blob:')) URL.revokeObjectURL(p.preview)
        })
        return []
      })
      setFallback(false)
      return
    }

    let active = true
    let launchedStream: MediaStream | null = null

    navigator.mediaDevices?.getUserMedia({ video: { facingMode }, audio: false })
      .then(stream => {
        if (!active) { stream.getTracks().forEach(t => t.stop()); return }
        launchedStream = stream
        setMediaStream(stream)
        setFallback(false)
        if (videoRef.current) videoRef.current.srcObject = stream
      })
      .catch(() => { if (active) setFallback(true) })

    return () => {
      active = false
      launchedStream?.getTracks().forEach(t => t.stop())
    }
  // mediaStream intentionally excluded — would cause loop
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, facingMode])

  const capture = async () => {
    if (!videoRef.current || photos.length >= MAX_PHOTOS) return
    const dataUrl = captureFrame(videoRef.current)
    const base64 = await resizeDataUrl(dataUrl)
    const preview = dataUrl
    setPhotos(prev => [...prev, { preview, base64 }])
  }

  const handleGalleryFiles = async (files: FileList | null) => {
    if (!files) return
    const remaining = MAX_PHOTOS - photos.length
    const toAdd = Array.from(files).slice(0, remaining)
    const entries = await Promise.all(toAdd.map(fileToEntry))
    setPhotos(prev => [...prev, ...entries])
  }

  const handleAnalyze = () => {
    onAnalyze(photos)
    stopStream(mediaStream)
    onClose()
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      {/* Viewfinder */}
      <div className="relative flex-1 overflow-hidden bg-[#080610]">
        {!fallback ? (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-4 px-8">
            <p className="text-[#4c3a6e] text-sm text-center">Camera access unavailable</p>
            <button
              onClick={() => galleryRef.current?.click()}
              className="bg-gradient-to-r from-[#7c3aed] to-[#2563eb] rounded-xl px-6 py-3 text-white font-semibold text-sm"
            >
              Choose Photos from Gallery
            </button>
          </div>
        )}

        {/* Corner brackets */}
        <div className="absolute top-5 left-5 w-6 h-6 border-t-2 border-l-2 border-[#c084fc] rounded-tl" />
        <div className="absolute top-5 right-5 w-6 h-6 border-t-2 border-r-2 border-[#c084fc] rounded-tr" />
        <div className="absolute bottom-24 left-5 w-6 h-6 border-b-2 border-l-2 border-[#c084fc] rounded-bl" />
        <div className="absolute bottom-24 right-5 w-6 h-6 border-b-2 border-r-2 border-[#c084fc] rounded-br" />

        {/* Top bar: close + count */}
        <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 pt-4">
          <button
            onClick={() => { stopStream(mediaStream); onClose() }}
            className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center text-white/60 text-sm"
          >✕</button>
          <span className="text-[#c084fc] text-xs font-semibold tracking-wider">
            {photos.length} / {MAX_PHOTOS}
          </span>
        </div>

        {/* Analyze button + photo strip */}
        {photos.length > 0 && (
          <div className="absolute bottom-3 left-4 right-4 flex flex-col gap-2">
            <button
              onClick={handleAnalyze}
              className="w-full bg-gradient-to-r from-[#7c3aed] to-[#2563eb] rounded-xl py-3 text-white font-semibold text-sm"
            >
              ⚡ Analyze {photos.length} Photo{photos.length !== 1 ? 's' : ''} →
            </button>
            <div className="flex gap-2">
              {photos.map((p, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={i}
                  src={p.preview}
                  alt=""
                  className="w-9 h-9 rounded-lg object-cover border border-[#c084fc]/60"
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Controls row */}
      <div className="bg-black px-6 py-5 flex items-center justify-between border-t border-[#1a1630]">
        {/* Gallery */}
        <button
          onClick={() => galleryRef.current?.click()}
          disabled={photos.length >= MAX_PHOTOS}
          className="flex flex-col items-center gap-1.5 disabled:opacity-30"
        >
          <div className="w-11 h-11 rounded-xl bg-[#12101e] border border-[#2d1f50] flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
              <rect x="1" y="3" width="14" height="11" rx="2" stroke="#6b4fa0" strokeWidth="1.2"/>
              <path d="M1 10l4-3 3 3 2-2 5 4" stroke="#6b4fa0" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <span className="text-[#6b4fa0] text-[9px] font-semibold tracking-wide">Gallery</span>
        </button>

        {/* Shutter */}
        <button
          onClick={capture}
          disabled={photos.length >= MAX_PHOTOS || fallback}
          className="w-16 h-16 rounded-full border-[2.5px] border-[#c084fc] flex items-center justify-center disabled:opacity-30"
          style={{ boxShadow: '0 0 20px rgba(192,132,252,0.3)' }}
        >
          <div className="w-[52px] h-[52px] rounded-full bg-white" />
        </button>

        {/* Flip */}
        <button
          onClick={() => setFacingMode(m => m === 'environment' ? 'user' : 'environment')}
          disabled={fallback}
          className="flex flex-col items-center gap-1.5 disabled:opacity-30"
        >
          <div className="w-11 h-11 rounded-xl bg-[#12101e] border border-[#2d1f50] flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
              <path d="M3 8a5 5 0 1 1 10 0" stroke="#6b4fa0" strokeWidth="1.2" strokeLinecap="round"/>
              <path d="M13 8l-2-2M13 8l-2 2" stroke="#6b4fa0" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
          </div>
          <span className="text-[#6b4fa0] text-[9px] font-semibold tracking-wide">Flip</span>
        </button>
      </div>

      <input
        ref={galleryRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={e => handleGalleryFiles(e.target.files)}
      />
    </div>
  )
}
