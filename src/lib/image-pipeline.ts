import { firecrawlExtractImages, isProductImage } from '@/lib/firecrawl'
import { validateProductImages, MAX_CANDIDATES } from '@/lib/gemini-images'
import { tavilyImageSearch } from '@/lib/tavily'
import type { PriceSource, VisionResult } from '@/types'

const NEEDED = 3

export async function selectProductImages(
  productName: string,
  sources: PriceSource[],
  vision: VisionResult
): Promise<string[]> {
  // Step 1 — extract images from already-verified price-source pages (free reuse of Stage 3)
  const rawImages = (
    await Promise.all(sources.map(() => firecrawlExtractImages()))
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
  const fallbackResults = await tavilyImageSearch()
  const fallbackCandidates = fallbackResults
    .map(r => r.url)
    .filter(isProductImage)
    .filter(u => !candidates.includes(u))

  const allCandidates = [...candidates, ...fallbackCandidates]
  if (allCandidates.length === 0) return []

  const validated = await validateProductImages(
    allCandidates.slice(0, MAX_CANDIDATES),
    vision,
    NEEDED
  )

  // If Gemini validation rejected everything, fall back to returning raw candidates
  // (better to show some images than none)
  return validated.length > 0 ? validated : allCandidates.slice(0, NEEDED)
}
