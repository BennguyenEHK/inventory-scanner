import { isProductImage } from '@/lib/firecrawl'
import { jinaExtractImages } from '@/lib/jina'
import { validateProductImages, MAX_CANDIDATES } from '@/lib/gemini-images'
import type { PriceSource, VisionResult } from '@/types'

const NEEDED = 3

/**
 * Build the report's product-image set by harvesting JSON-LD / inline images from
 * the price-source pages already discovered in Stage 3 (via Jina), then letting
 * Gemini vision pick the ones that actually match the scanned product.
 *
 * Replaces the dead Firecrawl image-scrape + Tavily image-search path: Serper has
 * no image endpoint and Firecrawl was removed, so both legacy sources returned [].
 */
export async function selectProductImages(
  _productName: string,            // kept for caller compatibility; no longer used
  sources: PriceSource[],
  vision: VisionResult,
): Promise<string[]> {
  // Step 1 — harvest candidate images from each verified price-source page via Jina
  const rawImages = (
    await Promise.all(sources.map(s => jinaExtractImages(s.url)))
  ).flat()

  // Step 2 — deterministic pre-filter (drop logos/icons/sprites) + dedup
  const candidates = [...new Set(rawImages)].filter(isProductImage)
  if (candidates.length === 0) return []

  // Step 3 — Gemini vision gate picks the images matching the scanned product
  const validated = await validateProductImages(candidates.slice(0, MAX_CANDIDATES), vision, NEEDED)

  // If the gate rejected everything, show the top raw candidates anyway
  // (better to show some images than none).
  return validated.length > 0 ? validated : candidates.slice(0, NEEDED)
}
