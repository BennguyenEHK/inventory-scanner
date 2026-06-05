import { describe, it, expect, vi } from 'vitest'
import { POST } from './route'
import * as inferenceModule from '@/lib/inference'

vi.mock('@/lib/inference', () => ({
  callModel: vi.fn(),
}))

describe('api/vision/route', () => {
  it('extracts vision data and routes to A (high confidence + brand)', async () => {
    const mockVisionOutput = {
      visible_text: ['3M', 'Scotch', '810'],
      brand: '3M',
      model_number: '810',
      product_category: 'adhesive tape',
      dimensions_visible: '3/4 in x 1000 in',
      barcode: '051131001108',
      color: 'yellow and black',
      shape: 'cylindrical spool',
      material_hints: 'plastic spool, paper tape',
      label_language: 'English',
      condition: 'new' as const,
      packaging_type: 'roll' as const,
      visual_description: 'Clear product image showing 3M Scotch tape spool',
      confidence: 0.95,
      missing_fields: [],
      image_quality: 'clear' as const,
    }

    vi.mocked(inferenceModule.callModel).mockResolvedValueOnce(
      JSON.stringify(mockVisionOutput)
    )

    const request = new Request('http://localhost:3000/api/vision', {
      method: 'POST',
      body: JSON.stringify({ images: ['base64encodedimage'] }),
    })

    const response = await POST(request)
    const data = (await response.json()) as any

    expect(response.status).toBe(200)
    expect(data.vision.brand).toBe('3M')
    expect(data.vision.confidence).toBe(0.95)
    expect(data.route.route).toBe('A')
    expect(data.route.strategy).toBe('direct_search')
  })

  it('routes to B (medium confidence + partial info)', async () => {
    const mockVisionOutput = {
      visible_text: ['some', 'text'],
      brand: 'Unknown Brand',
      model_number: null,
      product_category: 'electronics',
      dimensions_visible: null,
      barcode: null,
      color: 'black',
      shape: 'rectangular box',
      material_hints: 'plastic',
      label_language: 'English',
      condition: 'used' as const,
      packaging_type: 'box' as const,
      visual_description: 'Partial image showing electronics box',
      confidence: 0.6,
      missing_fields: ['model_number', 'barcode'],
      image_quality: 'partial' as const,
    }

    vi.mocked(inferenceModule.callModel).mockResolvedValueOnce(
      JSON.stringify(mockVisionOutput)
    )

    const request = new Request('http://localhost:3000/api/vision', {
      method: 'POST',
      body: JSON.stringify({ images: ['base64encodedimage'] }),
    })

    const response = await POST(request)
    const data = (await response.json()) as any

    expect(response.status).toBe(200)
    expect(data.route.route).toBe('B')
    expect(data.route.strategy).toBe('predict_then_search')
  })

  it('routes to C (low confidence + no brand)', async () => {
    const mockVisionOutput = {
      visible_text: [],
      brand: null,
      model_number: null,
      product_category: 'unknown item',
      dimensions_visible: null,
      barcode: null,
      color: 'unclear',
      shape: 'unclear shape',
      material_hints: 'unclear material',
      label_language: 'unknown',
      condition: 'damaged' as const,
      packaging_type: 'unknown' as const,
      visual_description: 'Image too blurry to determine product',
      confidence: 0.2,
      missing_fields: ['brand', 'model_number', 'barcode', 'dimensions_visible'],
      image_quality: 'unreadable' as const,
    }

    vi.mocked(inferenceModule.callModel).mockResolvedValueOnce(
      JSON.stringify(mockVisionOutput)
    )

    const request = new Request('http://localhost:3000/api/vision', {
      method: 'POST',
      body: JSON.stringify({ images: ['base64encodedimage'] }),
    })

    const response = await POST(request)
    const data = (await response.json()) as any

    expect(response.status).toBe(200)
    expect(data.route.route).toBe('C')
    expect(data.route.strategy).toBe('ask_user')
    expect(data.route.message).toContain('Image unclear')
  })

  it('returns 500 when images array is missing', async () => {
    const request = new Request('http://localhost:3000/api/vision', {
      method: 'POST',
      body: JSON.stringify({}),
    })

    const response = await POST(request)
    expect(response.status).toBe(500)
  })

  it('handles model output parsing errors gracefully', async () => {
    vi.mocked(inferenceModule.callModel).mockResolvedValueOnce(
      'invalid json output'
    )

    const request = new Request('http://localhost:3000/api/vision', {
      method: 'POST',
      body: JSON.stringify({ images: ['base64encodedimage'] }),
    })

    const response = await POST(request)
    expect(response.status).toBe(500)
    const data = (await response.json()) as any
    expect(data.error).toBeTruthy()
  })

  it('fills in default for missing visual_description', async () => {
    const mockVisionOutput = {
      visible_text: ['text'],
      brand: null,
      model_number: null,
      product_category: 'electronics',
      dimensions_visible: null,
      barcode: null,
      color: 'blue',
      shape: 'box',
      material_hints: 'plastic',
      label_language: 'English',
      condition: 'new' as const,
      packaging_type: 'box' as const,
      confidence: 0.5,
      missing_fields: [],
      image_quality: 'partial' as const,
    }

    vi.mocked(inferenceModule.callModel).mockResolvedValueOnce(
      JSON.stringify(mockVisionOutput)
    )

    const request = new Request('http://localhost:3000/api/vision', {
      method: 'POST',
      body: JSON.stringify({ images: ['base64encodedimage'] }),
    })

    const response = await POST(request)
    const data = (await response.json()) as any

    expect(response.status).toBe(200)
    expect(data.vision.visual_description).toBe('No description available')
  })
})
