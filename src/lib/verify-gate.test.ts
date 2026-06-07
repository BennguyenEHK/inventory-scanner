import { test, expect } from 'vitest'
import { applyVerifyGate, ManufacturerFlag } from './verify-gate'
import type { PriceSource, VisionResult } from '@/types'

function makeSource(overrides: Partial<PriceSource> = {}): PriceSource {
  return {
    name: 'Bunnings', url: 'https://bunnings.com.au/p/1',
    price: 49.99, currency: 'AUD', unit: 'each',
    manufacturer: 'Makita', itemDescription: 'cordless power drill',
    ...overrides,
  }
}

function makeVision(overrides: Partial<VisionResult> = {}): VisionResult {
  return {
    visible_text: [], brand: 'Makita', model_number: null,
    product_category: 'power drill', dimensions_visible: null, barcode: null,
    color: 'teal', shape: 'rectangular', material_hints: 'plastic',
    label_language: 'en', condition: 'new', packaging_type: 'box',
    visual_description: 'cordless drill', confidence: 0.9, missing_fields: [],
    image_quality: 'clear',
    ...overrides,
  }
}

test('passes when manufacturer matches vision brand', () => {
  const r = applyVerifyGate(makeSource({ manufacturer: 'Makita' }), makeVision({ brand: 'Makita' }))
  expect(r.discard).toBe(false)
  expect(r.manufacturerFlag).toBe(ManufacturerFlag.None)
})

test('soft-flags manufacturer mismatch — does NOT discard', () => {
  const r = applyVerifyGate(makeSource({ manufacturer: 'Bosch' }), makeVision({ brand: 'Makita' }))
  expect(r.discard).toBe(false)
  expect(r.manufacturerFlag).toBe(ManufacturerFlag.Mismatch)
})

test('hard-discards when description has zero word overlap with vision category', () => {
  const r = applyVerifyGate(
    makeSource({ itemDescription: 'garden hose nozzle spray attachment' }),
    makeVision({ product_category: 'cordless power drill' }),
  )
  expect(r.discard).toBe(true)
})

test('does NOT discard when description partially matches category', () => {
  const r = applyVerifyGate(
    makeSource({ itemDescription: 'compact drill driver kit with battery' }),
    makeVision({ product_category: 'power drill' }),
  )
  expect(r.discard).toBe(false)
})

test('passes when source has no manufacturer (field not extracted)', () => {
  const r = applyVerifyGate(makeSource({ manufacturer: undefined }), makeVision({ brand: 'Makita' }))
  expect(r.manufacturerFlag).toBe(ManufacturerFlag.None)
})

test('passes when source has no itemDescription (field not extracted)', () => {
  const r = applyVerifyGate(makeSource({ itemDescription: undefined }), makeVision())
  expect(r.discard).toBe(false)
})
