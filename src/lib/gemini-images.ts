import { callModel } from '@/lib/inference'
import type { VisionResult } from '@/types'

export const MAX_CANDIDATES = 8

// Gemini-supported MIME types (raster images only)
const GEMINI_SUPPORTED_MIMES = /^image\/(jpeg|png|webp|gif)$/i

interface FetchedImage {
  url: string
  base64: string
  mimeType: string
}

async function fetchAsBase64(url: string): Promise<FetchedImage | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) return null
    
    // Extract MIME type, strip charset/params
    const contentType = res.headers.get('content-type') ?? 'image/jpeg'
    const mimeType = contentType.split(';')[0].trim()
    
    // Filter out unsupported formats (SVG, BMP, TIFF, HEIC, ICO, etc.)
    if (!GEMINI_SUPPORTED_MIMES.test(mimeType)) {
      console.warn(`[gemini-images] Skipping unsupported format: ${url} (${mimeType})`)
      return null
    }
    
    const buffer = await res.arrayBuffer()
    const base64 = Buffer.from(buffer).toString('base64')
    return { url, base64, mimeType }
  } catch {
    return null
  }
}

export async function validateProductImages(
  candidateUrls: string[],
  vision: VisionResult,
  needed = 3
): Promise<string[]> {
  if (candidateUrls.length === 0) return []
  if (candidateUrls.length <= needed) return candidateUrls

  const capped = candidateUrls.slice(0, MAX_CANDIDATES)
  const fetched = (
    await Promise.all(capped.map(fetchAsBase64))
  ).filter((r): r is FetchedImage => r !== null)

  // Last resort: if every image fetch failed, return raw candidate URLs unvalidated
  if (fetched.length === 0) return candidateUrls.slice(0, needed)
  if (fetched.length <= needed) return fetched.map(r => r.url)

  const productSpec = [
    vision.brand         && `Brand: ${vision.brand}`,
    vision.model_number  && `Model: ${vision.model_number}`,
    vision.product_category   && `Category: ${vision.product_category}`,
    vision.color              && `Color: ${vision.color}`,
    vision.visual_description && `Description: ${vision.visual_description}`,
  ].filter(Boolean).join('\n')

  const imageParts = fetched.flatMap((img, i) => [
    { type: 'text' as const, text: `Image ${i}:` },
    { type: 'image_url' as const, image_url: { url: `data:${img.mimeType};base64,${img.base64}` } },
  ])

  const raw = await callModel({
    model: 'gemini-2.5-flash',
    temperature: 0.1,
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: [
        ...imageParts,
        {
          type: 'text',
          text: `Product specification:\n${productSpec}\n\nReturn JSON: {"indices":[i,j,k]} — the ${needed} image indices (0-based) that best show this exact product. Prefer images of the specific model/variant. Return only the JSON.`,
        },
      ],
    }],
  })

  try {
    const parsed = JSON.parse(raw) as { indices?: unknown }
    const indices = parsed.indices
    if (!Array.isArray(indices)) throw new Error('indices not array')
    return indices
      .filter((i): i is number => typeof i === 'number' && i >= 0 && i < fetched.length)
      .slice(0, needed)
      .map(i => fetched[i].url) // indices are into fetched[], not candidateUrls[]
  } catch {
    return fetched.slice(0, needed).map(r => r.url)
  }
}
