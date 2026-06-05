import { firecrawlExtractImages, isProductImage } from '@/lib/firecrawl'
import { validateProductImages } from '@/lib/gemini-images'
import { tavilyImageSearch } from '@/lib/tavily'
import type { PriceSource, VisionResult } from '@/types'

const NEEDED        = 3
const MAX_CANDIDATES = 8

export async function selectProductImages(
  productName: string,
  sources: PriceSource[],
  vision: VisionResult
): Promise<string[]> {
  // Step 1 — extract images from already-verified price-source pages (free reuse of Stage 3)
  const rawImages = (
    await Promise.all(sources.map(s => firecrawlExtractImages(s.url)))
  ).flat()

  // Step 2 — deterministic pre-filter + dedup
  const candidates = [...new Set(rawImages)].filter(isProductImage)

  // Step 3 — Gemini vision gate
  if (candidates.length > 0) {
    const validated = await validateProductImages(
      candidates.slice(0, MAX_CANDIDATES),
      vision,
      NEEDED
    )
    if (validated.length >= NEEDED) return validated
  }

  // Step 4 — targeted Tavily fallback (brand + model_number are more specific than productName alone)
  const fallbackQuery = [vision.brand, vision.model_number, productName, 'product image']
    .filter(Boolean)
    .join(' ')
  const fallbackResults = await tavilyImageSearch(fallbackQuery, 9)
  const fallbackCandidates = fallbackResults
    .map(r => r.url)
    .filter(isProductImage)
    .filter(u => !candidates.includes(u))

  const allCandidates = [...candidates, ...fallbackCandidates]
  if (allCandidates.length === 0) return []

  return validateProductImages(
    allCandidates.slice(0, MAX_CANDIDATES),
    vision,
    NEEDED
  )
}
