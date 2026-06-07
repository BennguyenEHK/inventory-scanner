import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { selectProductImages } from './image-pipeline'
import type { PriceSource, VisionResult } from '@/types'

vi.mock('@/lib/jina', () => ({
  isProductImage: vi.fn(),
  jinaExtractImages: vi.fn(),
}))
vi.mock('@/lib/gemini-images', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/gemini-images')>()
  return { ...actual, validateProductImages: vi.fn() }
})

import { isProductImage, jinaExtractImages } from '@/lib/jina'
import { validateProductImages } from '@/lib/gemini-images'

const SOURCES: PriceSource[] = [
  { name: 'Store A', url: 'https://store-a.com/product', price: 120, currency: 'USD', unit: 'each' },
  { name: 'Store B', url: 'https://store-b.com/product', price: 125, currency: 'USD', unit: 'each' },
]

const VISION: VisionResult = {
  visible_text: [], brand: 'Bosch', model_number: 'GBH 2-28', product_category: 'rotary hammer',
  dimensions_visible: null, barcode: null, color: 'blue', shape: 'handheld tool',
  material_hints: 'plastic', label_language: 'English', condition: 'new', packaging_type: 'box',
  visual_description: 'Blue Bosch rotary hammer drill', confidence: 0.9, missing_fields: [], image_quality: 'clear',
}

beforeEach(() => {
  vi.mocked(jinaExtractImages).mockResolvedValue([])
  vi.mocked(isProductImage).mockReturnValue(true)
  vi.mocked(validateProductImages).mockResolvedValue([])
})
afterEach(() => { vi.clearAllMocks() })

describe('selectProductImages', () => {
  it('returns validated images from price-source pages on happy path', async () => {
    const imgs = ['https://a.com/1.jpg', 'https://b.com/2.jpg', 'https://c.com/3.jpg']
    vi.mocked(jinaExtractImages).mockResolvedValue(['https://a.com/1.jpg'])
    vi.mocked(validateProductImages).mockResolvedValue(imgs)
    const result = await selectProductImages('Bosch Drill', SOURCES, VISION)
    expect(result).toEqual(imgs)
  })

  it('calls jinaExtractImages for each price-source URL', async () => {
    vi.mocked(jinaExtractImages).mockResolvedValue(['https://x.com/1.jpg'])
    vi.mocked(validateProductImages).mockResolvedValue(['a.jpg', 'b.jpg', 'c.jpg'])
    await selectProductImages('Bosch Drill', SOURCES, VISION)
    expect(vi.mocked(jinaExtractImages)).toHaveBeenCalledWith('https://store-a.com/product')
    expect(vi.mocked(jinaExtractImages)).toHaveBeenCalledWith('https://store-b.com/product')
  })

  it('deduplicates image URLs across price sources before the vision gate', async () => {
    vi.mocked(jinaExtractImages).mockResolvedValue(['https://cdn.com/product.jpg'])
    await selectProductImages('Bosch Drill', SOURCES, VISION)
    const candidates = vi.mocked(validateProductImages).mock.calls[0]?.[0] as string[]
    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toBe('https://cdn.com/product.jpg')
  })

  it('returns empty array when no candidate images are found', async () => {
    vi.mocked(jinaExtractImages).mockResolvedValue([])
    const result = await selectProductImages('Unknown', SOURCES, VISION)
    expect(result).toEqual([])
    expect(vi.mocked(validateProductImages)).not.toHaveBeenCalled()
  })

  it('drops non-product images via isProductImage before the vision gate', async () => {
    vi.mocked(jinaExtractImages).mockResolvedValue(['https://cdn.com/logo.png', 'https://cdn.com/product.jpg'])
    vi.mocked(isProductImage).mockImplementation((u: string) => !u.includes('logo'))
    vi.mocked(validateProductImages).mockResolvedValue(['https://cdn.com/product.jpg'])
    await selectProductImages('Bosch Drill', SOURCES, VISION)
    const candidates = vi.mocked(validateProductImages).mock.calls[0]?.[0] as string[]
    expect(candidates).toEqual(['https://cdn.com/product.jpg'])
  })

  it('falls back to raw candidates when the vision gate rejects everything', async () => {
    vi.mocked(jinaExtractImages).mockResolvedValue(['https://cdn.com/p1.jpg', 'https://cdn.com/p2.jpg'])
    vi.mocked(validateProductImages).mockResolvedValue([])
    const result = await selectProductImages('Bosch Drill', SOURCES, VISION)
    expect(result).toEqual(['https://cdn.com/p1.jpg', 'https://cdn.com/p2.jpg'])
  })
})
