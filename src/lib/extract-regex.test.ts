import { test, expect } from 'vitest'
import type { PriceSource } from '@/types'
import { extractFromText } from './extract-regex'

test('PriceSource accepts optional extended fields', () => {
  const source: PriceSource = {
    name: 'Bunnings',
    url: 'https://bunnings.com.au/p/123',
    price: 49.99,
    currency: 'AUD',
    unit: 'each',
    in_stock: true,
    manufacturer: 'Makita',
    itemDescription: 'Cordless drill driver',
    length: '80 mm',
    width: '40 mm',
    items_origin: 'Japan',
    manufacturer_flagged: false,
  }
  expect(source.manufacturer).toBe('Makita')
  expect(source.items_origin).toBe('Japan')
})

test('extracts USD price and currency', () => {
  const r = extractFromText('Makita DHP453 $149.99 free shipping')
  expect(r.price).toBe(149.99)
  expect(r.currency).toBe('USD')
})

test('extracts AUD price with symbol', () => {
  const r = extractFromText('Price: AU$89.50 each. In stock.')
  expect(r.price).toBe(89.50)
  expect(r.currency).toBe('AUD')
  expect(r.unit).toBe('each')
  expect(r.in_stock).toBe(true)
})

test('labeled price takes priority over bare price', () => {
  const r = extractFromText('Was $200. Unit price: $149.99. Shop now.')
  expect(r.price).toBe(149.99)
})

test('detects out of stock', () => {
  const r = extractFromText('Out of stock. $49.99 when available.')
  expect(r.in_stock).toBe(false)
})

test('extracts pack unit', () => {
  const r = extractFromText('$12.50 pack of 10 screws')
  expect(r.unit).toBe('pack of 10')
})

test('extracts manufacturer via "by" pattern', () => {
  const r = extractFromText('Heavy duty drill by Makita. Cordless.')
  expect(r.manufacturer).toMatch(/makita/i)
})

test('extracts manufacturer via "Brand:" pattern', () => {
  const r = extractFromText('Brand: Stanley. Length: 200mm.')
  expect(r.manufacturer).toMatch(/stanley/i)
})

test('extracts dimensions', () => {
  const r = extractFromText('Dimensions: 80mm x 40mm. Made in Japan.')
  expect(r.length).toBe('80 mm')
  expect(r.width).toBe('40 mm')
})

test('extracts country of origin', () => {
  const r = extractFromText('Made in Japan. High quality tool.')
  expect(r.items_origin).toBe('Japan')
})

test('returns all nulls when nothing found', () => {
  const r = extractFromText('Click here to contact us.')
  expect(r.price).toBeNull()
  expect(r.currency).toBeNull()
  expect(r.manufacturer).toBeNull()
})
