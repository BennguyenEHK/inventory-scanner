import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from './route'
import type { VisionResult, PredictionResult } from '@/types'

vi.mock('@/lib/inference')
vi.mock('@/lib/tavily')

const mockVision: VisionResult = {
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
  confidence: 0.6,
  missing_fields: [],
  image_quality: 'clear',
}

// Matches PredictionResult exactly
const mockPrediction: PredictionResult = {
  prediction: {
    product_name: 'Sony BRAVIA KDL-55XE8505',
    model_number: 'KDL-55XE8505',
    manufacturer: 'Sony',
    product_line: 'BRAVIA XE8505',
    reasoning: 'Model number visible on bezel',
    prediction_confidence: 0.9,
  },
  candidates: [
    { name: 'Sony BRAVIA KDL-55XE8505', confidence: 0.9, differentiator: 'Model number match' },
  ],
  verification_query: 'Sony BRAVIA KDL-55XE8505',
  requires_verification: true,
}

describe('POST /api/predict', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns prediction wrapped in route response', async () => {
    const { callModel } = await import('@/lib/inference')
    const { tavilySearch } = await import('@/lib/tavily')
    vi.mocked(callModel).mockResolvedValueOnce(JSON.stringify(mockPrediction))
    vi.mocked(tavilySearch).mockResolvedValueOnce([])

    const req = new Request('http://localhost/api/predict', {
      method: 'POST',
      body: JSON.stringify(mockVision),
    })
    const res = await POST(req)
    const data = await res.json()

    // Route returns { prediction: PredictionResult, verification: { confirmed, sources } }
    expect(data).toHaveProperty('prediction')
    expect(data.prediction.prediction.product_name).toBe('Sony BRAVIA KDL-55XE8505')
    expect(data.prediction.prediction.manufacturer).toBe('Sony')
    expect(data.prediction.requires_verification).toBe(true)
    expect(data).toHaveProperty('verification')
  })

  it('calls Qwen3.6-35B-A3B with thinking enabled', async () => {
    const { callModel } = await import('@/lib/inference')
    const { tavilySearch } = await import('@/lib/tavily')
    vi.mocked(callModel).mockResolvedValueOnce(JSON.stringify(mockPrediction))
    vi.mocked(tavilySearch).mockResolvedValueOnce([])

    await POST(new Request('http://localhost/api/predict', {
      method: 'POST',
      body: JSON.stringify(mockVision),
    }))

    expect(callModel).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'Qwen/Qwen3.6-35B-A3B',
        enable_thinking: true,
        budget_tokens: 3000,
      })
    )
  })

  it('uses barcode in Tavily query when present', async () => {
    const { callModel } = await import('@/lib/inference')
    const { tavilySearch } = await import('@/lib/tavily')
    vi.mocked(callModel).mockResolvedValueOnce(JSON.stringify(mockPrediction))
    vi.mocked(tavilySearch).mockResolvedValueOnce([])

    const visionWithBarcode = { ...mockVision, barcode: '4901780870448' }
    await POST(new Request('http://localhost/api/predict', {
      method: 'POST',
      body: JSON.stringify(visionWithBarcode),
    }))

    expect(tavilySearch).toHaveBeenCalledWith('barcode 4901780870448 product', 3)
  })

  it('returns 500 on invalid JSON from model', async () => {
    const { callModel } = await import('@/lib/inference')
    vi.mocked(callModel).mockResolvedValueOnce('not valid json {{')

    const res = await POST(new Request('http://localhost/api/predict', {
      method: 'POST',
      body: JSON.stringify(mockVision),
    }))
    expect(res.status).toBe(500)
    expect(await res.json()).toHaveProperty('error')
  })
})
