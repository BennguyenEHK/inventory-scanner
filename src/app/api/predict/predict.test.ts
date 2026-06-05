import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from './route'
import { VisionResult } from '@/types'

vi.mock('@/lib/inference')
vi.mock('@/lib/tavily')

const mockVisionResult: VisionResult = {
  visible_text: ['SONY', 'KDL-55'],
  brand: 'Sony',
  model_number: 'KDL-55XE8505',
  product_category: 'Television',
  dimensions_visible: '55"',
  barcode: null,
  color: 'Black',
  shape: 'Rectangular Display',
  material_hints: 'Glass, Plastic, Metal',
  label_language: 'English',
  condition: 'new',
  packaging_type: 'box',
  visual_description: 'Large flat-screen television with bezel',
  confidence: 0.95,
  missing_fields: [],
  image_quality: 'clear',
}

describe('POST /api/predict', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns prediction result with correct structure', async () => {
    const { callModel } = await import('@/lib/inference')
    const { tavilySearch } = await import('@/lib/tavily')

    vi.mocked(callModel).mockResolvedValueOnce(JSON.stringify({
      product_name: 'BRAVIA KDL-55XE8505',
      model_number: 'KDL-55XE8505',
      manufacturer: 'Sony',
      product_line: 'BRAVIA XE8505',
      reasoning: 'Model number visible on bezel, Sony branding clear',
      confidence: 0.95,
      candidates: [
        { name: 'BRAVIA KDL-55XE8505', confidence: 0.95, differentiator: 'Model number match' },
        { name: 'BRAVIA KDL-55XE7100', confidence: 0.6, differentiator: 'Similar model' },
      ],
    }))

    vi.mocked(tavilySearch).mockResolvedValueOnce([
      { url: 'https://sony.com/...', title: 'KDL-55XE8505', content: 'Product page', score: 0.95 },
    ])

    const req = new Request('http://localhost:3000/api/predict', {
      method: 'POST',
      body: JSON.stringify(mockVisionResult),
    })

    const res = await POST(req)
    const data = await res.json()

    expect(data).toHaveProperty('prediction')
    expect(data.prediction).toHaveProperty('product_name')
    expect(data.prediction).toHaveProperty('manufacturer')
    expect(data.prediction).toHaveProperty('prediction_confidence')
    expect(data).toHaveProperty('candidates')
    expect(data).toHaveProperty('verification_query')
    expect(data).toHaveProperty('requires_verification')
  })

  it('calls Qwen3.6 with reasoning enabled', async () => {
    const { callModel } = await import('@/lib/inference')
    const { tavilySearch } = await import('@/lib/tavily')

    vi.mocked(callModel).mockResolvedValueOnce('{"product_name": "Test", "confidence": 0.5}')
    vi.mocked(tavilySearch).mockResolvedValueOnce([])

    const req = new Request('http://localhost:3000/api/predict', {
      method: 'POST',
      body: JSON.stringify(mockVisionResult),
    })

    await POST(req)

    expect(callModel).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'Qwen3.6',
        enable_thinking: true,
      })
    )
  })

  it('sets requires_verification to true for low confidence', async () => {
    const { callModel } = await import('@/lib/inference')
    const { tavilySearch } = await import('@/lib/tavily')

    vi.mocked(callModel).mockResolvedValueOnce(JSON.stringify({
      product_name: 'Unknown Product',
      confidence: 0.6,
    }))
    vi.mocked(tavilySearch).mockResolvedValueOnce([])

    const req = new Request('http://localhost:3000/api/predict', {
      method: 'POST',
      body: JSON.stringify(mockVisionResult),
    })

    const res = await POST(req)
    const data = await res.json()

    expect(data.requires_verification).toBe(true)
  })

  it('handles parsing errors gracefully', async () => {
    const { callModel } = await import('@/lib/inference')

    vi.mocked(callModel).mockResolvedValueOnce('Invalid JSON response')

    const req = new Request('http://localhost:3000/api/predict', {
      method: 'POST',
      body: JSON.stringify(mockVisionResult),
    })

    const res = await POST(req)
    expect(res.status).toBe(500)
    const data = await res.json()
    expect(data).toHaveProperty('error')
  })
})
