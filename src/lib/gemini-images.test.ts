import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { callModel } from '@/lib/inference'
import { validateProductImages } from './gemini-images'
import type { VisionResult } from '@/types'

vi.mock('@/lib/inference')

const VISION: VisionResult = {
  visible_text: ['BOSCH', 'GBH 2-28'],
  brand: 'Bosch',
  model_number: 'GBH 2-28',
  product_category: 'rotary hammer drill',
  dimensions_visible: null,
  barcode: null,
  color: 'blue',
  shape: 'handheld tool',
  material_hints: 'plastic housing',
  label_language: 'English',
  condition: 'new',
  packaging_type: 'box',
  visual_description: 'Blue Bosch rotary hammer drill in retail box',
  confidence: 0.9,
  missing_fields: [],
  image_quality: 'clear',
}

const CANDIDATE_URLS = [
  'https://store.com/bosch-1.jpg',
  'https://store.com/bosch-2.jpg',
  'https://store.com/bosch-3.jpg',
  'https://store.com/bosch-4.jpg',
]

function mockFetchImage() {
  return {
    ok: true,
    arrayBuffer: async () => new ArrayBuffer(8),
    headers: { get: (_: string) => 'image/jpeg' },
  }
}

beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue(mockFetchImage())
  vi.mocked(callModel).mockResolvedValue('{"indices":[0,2,3]}')
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('validateProductImages', () => {
  it('returns 3 URLs matching the indices Gemini chose', async () => {
    const result = await validateProductImages(CANDIDATE_URLS, VISION)
    expect(result).toEqual([
      'https://store.com/bosch-1.jpg',
      'https://store.com/bosch-3.jpg',
      'https://store.com/bosch-4.jpg',
    ])
  })

  it('calls callModel with gemini-2.5-flash and image content parts', async () => {
    await validateProductImages(CANDIDATE_URLS, VISION)
    expect(vi.mocked(callModel)).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gemini-2.5-flash',
        messages: expect.arrayContaining([
          expect.objectContaining({ role: 'user' }),
        ]),
      })
    )
    const call = vi.mocked(callModel).mock.calls[0][0]
    const content = call.messages[0].content as unknown[]
    const imageParts = content.filter(
      (p: unknown) => (p as { type: string }).type === 'image_url'
    )
    // One image part per candidate (4 candidates → 4 image parts)
    expect(imageParts).toHaveLength(4)
  })

  it('returns first N candidates when Gemini output is invalid JSON', async () => {
    vi.mocked(callModel).mockResolvedValue('not json')
    const result = await validateProductImages(CANDIDATE_URLS, VISION)
    expect(result).toHaveLength(3)
    expect(result[0]).toBe('https://store.com/bosch-1.jpg')
  })

  it('returns first N candidates when indices array is malformed', async () => {
    vi.mocked(callModel).mockResolvedValue('{"indices":"wrong"}')
    const result = await validateProductImages(CANDIDATE_URLS, VISION)
    expect(result).toHaveLength(3)
  })

  it('returns all candidates when count <= needed and skips Gemini', async () => {
    const twoUrls = ['https://store.com/a.jpg', 'https://store.com/b.jpg']
    const result = await validateProductImages(twoUrls, VISION)
    expect(result).toEqual(twoUrls)
    expect(vi.mocked(callModel)).not.toHaveBeenCalled()
  })

  it('returns empty array when candidate list is empty', async () => {
    const result = await validateProductImages([], VISION)
    expect(result).toEqual([])
    expect(vi.mocked(callModel)).not.toHaveBeenCalled()
  })

  it('skips candidates whose image fetch fails and still returns needed count', async () => {
    // First image fetch fails, rest succeed
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValue(mockFetchImage())
    vi.mocked(callModel).mockResolvedValue('{"indices":[0,1,2]}')

    const result = await validateProductImages(CANDIDATE_URLS, VISION)
    // 3 of 4 fetched successfully — still returns 3
    expect(result).toHaveLength(3)
  })

  it('returns fewer than needed when too many fetches fail', async () => {
    // Only 1 of 4 fetches succeeds — fetched.length (1) < needed (3)
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValue(mockFetchImage())
    // fetched.length <= needed → Gemini not called, returns those 1 URL directly
    const result = await validateProductImages(CANDIDATE_URLS, VISION)
    expect(result).toHaveLength(1)
    expect(vi.mocked(callModel)).not.toHaveBeenCalled()
  })

  it('respects the needed parameter', async () => {
    vi.mocked(callModel).mockResolvedValue('{"indices":[1,3]}')
    const result = await validateProductImages(CANDIDATE_URLS, VISION, 2)
    expect(result).toHaveLength(2)
  })
})
