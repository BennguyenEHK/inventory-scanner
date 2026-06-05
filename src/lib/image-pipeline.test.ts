import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { selectProductImages } from './image-pipeline'
import type { PriceSource, VisionResult } from '@/types'

vi.mock('@/lib/firecrawl', () => ({
  firecrawlExtractImages: vi.fn(),
  isProductImage: vi.fn(),
}))
vi.mock('@/lib/gemini-images', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/gemini-images')>()
  return {
    ...actual,
    validateProductImages: vi.fn(),
  }
})
vi.mock('@/lib/tavily', () => ({
  tavilyImageSearch: vi.fn(),
}))

import { firecrawlExtractImages, isProductImage } from '@/lib/firecrawl'
import { validateProductImages } from '@/lib/gemini-images'
import { tavilyImageSearch } from '@/lib/tavily'

const SOURCES: PriceSource[] = [
  { name: 'Store A', url: 'https://store-a.com/product', price: 120, currency: 'USD', unit: 'each' },
  { name: 'Store B', url: 'https://store-b.com/product', price: 125, currency: 'USD', unit: 'each' },
]

const VISION: VisionResult = {
  visible_text: [],
  brand: 'Bosch',
  model_number: 'GBH 2-28',
  product_category: 'rotary hammer',
  dimensions_visible: null,
  barcode: null,
  color: 'blue',
  shape: 'handheld tool',
  material_hints: 'plastic',
  label_language: 'English',
  condition: 'new',
  packaging_type: 'box',
  visual_description: 'Blue Bosch rotary hammer drill',
  confidence: 0.9,
  missing_fields: [],
  image_quality: 'clear',
}

beforeEach(() => {
  vi.mocked(firecrawlExtractImages).mockResolvedValue([])
  vi.mocked(isProductImage).mockReturnValue(true)
  vi.mocked(validateProductImages).mockResolvedValue([])
  vi.mocked(tavilyImageSearch).mockResolvedValue([])
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('selectProductImages', () => {
  it('returns 3 validated images from price source pages on happy path', async () => {
    const imgs = ['https://a.com/1.jpg', 'https://b.com/2.jpg', 'https://c.com/3.jpg']
    vi.mocked(firecrawlExtractImages).mockResolvedValue(['https://a.com/1.jpg'])
    vi.mocked(validateProductImages).mockResolvedValue(imgs)

    const result = await selectProductImages('Bosch Drill', SOURCES, VISION)

    expect(result).toEqual(imgs)
    // Tavily fallback should NOT have been called
    expect(vi.mocked(tavilyImageSearch)).not.toHaveBeenCalled()
  })

  it('calls firecrawlExtractImages for each price source URL', async () => {
    vi.mocked(validateProductImages).mockResolvedValue(['a.jpg', 'b.jpg', 'c.jpg'])

    await selectProductImages('Bosch Drill', SOURCES, VISION)

    expect(vi.mocked(firecrawlExtractImages)).toHaveBeenCalledWith('https://store-a.com/product')
    expect(vi.mocked(firecrawlExtractImages)).toHaveBeenCalledWith('https://store-b.com/product')
  })

  it('falls back to Tavily when primary path yields < 3 images', async () => {
    // Primary path returns only 2
    vi.mocked(firecrawlExtractImages).mockResolvedValue(['https://a.com/1.jpg'])
    vi.mocked(validateProductImages)
      .mockResolvedValueOnce(['a.jpg', 'b.jpg'])           // first call: < 3
      .mockResolvedValueOnce(['a.jpg', 'b.jpg', 'c.jpg'])  // fallback call: 3
    vi.mocked(tavilyImageSearch).mockResolvedValue([
      { url: 'https://tavily.com/img.jpg', description: '' },
    ])

    const result = await selectProductImages('Bosch Drill', SOURCES, VISION)

    expect(vi.mocked(tavilyImageSearch)).toHaveBeenCalledWith(
      expect.stringContaining('Bosch'),
      9
    )
    expect(result).toHaveLength(3)
  })

  it('uses brand + model_number in Tavily fallback query', async () => {
    vi.mocked(validateProductImages).mockResolvedValueOnce([]).mockResolvedValueOnce([])
    vi.mocked(tavilyImageSearch).mockResolvedValue([])

    await selectProductImages('Bosch Drill', SOURCES, VISION)

    const query = vi.mocked(tavilyImageSearch).mock.calls[0][0] as string
    expect(query).toContain('Bosch')
    expect(query).toContain('GBH 2-28')
  })

  it('returns empty array when all paths yield nothing', async () => {
    vi.mocked(validateProductImages).mockResolvedValue([])
    vi.mocked(tavilyImageSearch).mockResolvedValue([])

    const result = await selectProductImages('Unknown', SOURCES, VISION)
    expect(result).toEqual([])
  })

  it('deduplicates image URLs across price sources before passing to Gemini', async () => {
    // Both sources return the same image URL
    vi.mocked(firecrawlExtractImages).mockResolvedValue(['https://cdn.com/product.jpg'])

    await selectProductImages('Bosch Drill', SOURCES, VISION)

    const candidates = vi.mocked(validateProductImages).mock.calls[0]?.[0] as string[]
    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toBe('https://cdn.com/product.jpg')
  })

  it('does not pass primary candidate URLs to Tavily fallback pool', async () => {
    const primaryUrl = 'https://store-a.com/product-img.jpg'
    vi.mocked(firecrawlExtractImages).mockResolvedValue([primaryUrl])
    vi.mocked(validateProductImages)
      .mockResolvedValueOnce([])  // primary path: < 3
      .mockResolvedValueOnce([])
    vi.mocked(tavilyImageSearch).mockResolvedValue([
      { url: primaryUrl, description: '' },           // duplicate — should be excluded
      { url: 'https://tavily.com/new.jpg', description: '' },
    ])

    await selectProductImages('Bosch Drill', SOURCES, VISION)

    // Second validateProductImages call should contain primaryUrl once (from candidates),
    // not twice (not also from Tavily results)
    const secondCallCandidates = vi.mocked(validateProductImages).mock.calls[1]?.[0] as string[]
    const occurrences = secondCallCandidates?.filter(u => u === primaryUrl).length ?? 0
    expect(occurrences).toBe(1)
  })
})
