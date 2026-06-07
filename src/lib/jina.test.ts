import { describe, it, test, expect } from 'vitest'
import {
  extractJsonLdFromMarkdown,
  extractFromJsonLd,
  isScrapeable,
  isProductImage,
  buildPriceSourceFromFields,
} from './jina'
import type { ExtractedFields } from './extract-regex'

// ─── JSON-LD extraction ───────────────────────────────────────────────────

test('extractJsonLdFromMarkdown finds fenced JSON block', () => {
  const md = `Some text\n\`\`\`json\n{"@type":"Product","name":"Makita Drill","brand":{"@type":"Brand","name":"Makita"},"offers":{"price":"149.99","priceCurrency":"AUD"}}\n\`\`\`\nMore text`
  const blocks = extractJsonLdFromMarkdown(md)
  expect(blocks.length).toBeGreaterThan(0)
  expect(blocks[0]['@type']).toBe('Product')
})

test('extractJsonLdFromMarkdown skips malformed JSON', () => {
  const md = '```json\n{not valid}\n```'
  expect(extractJsonLdFromMarkdown(md)).toHaveLength(0)
})

test('extractFromJsonLd pulls price from Product offer', () => {
  const block = {
    '@type': 'Product',
    name: 'Makita Drill',
    brand: { '@type': 'Brand', name: 'Makita' },
    description: 'Cordless drill driver 18V',
    offers: { '@type': 'Offer', price: '149.99', priceCurrency: 'AUD' },
  }
  const fields = extractFromJsonLd([block])
  expect(fields.price).toBe(149.99)
  expect(fields.currency).toBe('AUD')
  expect(fields.manufacturer).toBe('Makita')
  expect(fields.itemDescription).toMatch(/drill/i)
})

test('extractFromJsonLd returns no fields when no product data', () => {
  const fields = extractFromJsonLd([{ '@type': 'WebSite', name: 'Bunnings' }])
  expect(fields.price).toBeUndefined()
})

// ─── URL classification ───────────────────────────────────────────────────

describe('isScrapeable', () => {
  it('allows normal e-commerce URLs', () => {
    expect(isScrapeable('https://premiumfasteners.com.au/product/hex-bolt')).toBe(true)
    expect(isScrapeable('https://www.ebay.com/itm/12345')).toBe(true)
    expect(isScrapeable('https://industrialelectricalwarehouse.com/products/bolt')).toBe(true)
  })

  it('blocks social media and gated sites', () => {
    expect(isScrapeable('https://www.linkedin.com/in/someone')).toBe(false)
    expect(isScrapeable('https://www.facebook.com/posts/123')).toBe(false)
    expect(isScrapeable('https://www.youtube.com/watch?v=abc')).toBe(false)
    expect(isScrapeable('https://www.instagram.com/p/abc')).toBe(false)
    expect(isScrapeable('https://twitter.com/user/status/123')).toBe(false)
    expect(isScrapeable('https://www.zillow.com/homedetails/123')).toBe(false)
    expect(isScrapeable('https://pitchbook.com/profiles/company/123')).toBe(false)
  })

  it('blocks non-web file extensions', () => {
    expect(isScrapeable('https://example.com/catalogue.pdf')).toBe(false)
    expect(isScrapeable('https://example.com/data.xls')).toBe(false)
    expect(isScrapeable('https://example.com/doc.docx')).toBe(false)
  })

  it('returns false for malformed URLs', () => {
    expect(isScrapeable('not-a-url')).toBe(false)
    expect(isScrapeable('')).toBe(false)
  })
})

describe('isProductImage', () => {
  it('allows clean product image URLs', () => {
    expect(isProductImage('https://store.com/images/product-123.jpg')).toBe(true)
    expect(isProductImage('https://cdn.example.com/photo_main.webp')).toBe(true)
    expect(isProductImage('https://shop.com/assets/item.png')).toBe(true)
  })

  it('blocks logo, icon, banner, and UI chrome URLs', () => {
    expect(isProductImage('https://store.com/assets/logo.png')).toBe(false)
    expect(isProductImage('https://example.com/icons/cart-icon.jpg')).toBe(false)
    expect(isProductImage('https://cdn.com/banner_top.jpg')).toBe(false)
    expect(isProductImage('https://site.com/sprite-sheet.png')).toBe(false)
    expect(isProductImage('https://site.com/avatar_default.webp')).toBe(false)
    expect(isProductImage('https://site.com/thumbnail_xs.jpg')).toBe(false)
    expect(isProductImage('https://site.com/header-bg.png')).toBe(false)
    expect(isProductImage('https://site.com/placeholder.gif')).toBe(false)
  })

  it('blocks URLs without image extensions', () => {
    expect(isProductImage('https://store.com/product/123')).toBe(false)
    expect(isProductImage('https://store.com/product.pdf')).toBe(false)
    expect(isProductImage('https://store.com/data.json')).toBe(false)
  })

  it('returns false for malformed URLs', () => {
    expect(isProductImage('not-a-url')).toBe(false)
    expect(isProductImage('')).toBe(false)
  })
})

// ─── PriceSource builder ──────────────────────────────────────────────────

describe('buildPriceSourceFromFields', () => {
  it('maps ExtractedFields to PriceSource', () => {
    const fields: ExtractedFields = {
      price: 49.99, currency: 'AUD', unit: 'each', in_stock: true,
      manufacturer: 'Makita', itemDescription: 'Cordless drill',
      length: '80 mm', width: '40 mm', items_origin: 'Japan',
    }
    const source = buildPriceSourceFromFields(
      fields, 'Bunnings', 'https://bunnings.com.au/p/1', false,
    )
    expect(source).not.toBeNull()
    expect(source!.price).toBe(49.99)
    expect(source!.manufacturer).toBe('Makita')
    expect(source!.items_origin).toBe('Japan')
    expect(source!.manufacturer_flagged).toBe(false)
  })

  it('returns null when price is missing', () => {
    const fields: ExtractedFields = {
      price: null, currency: 'AUD', unit: 'each', in_stock: null,
      manufacturer: null, itemDescription: null, length: null, width: null, items_origin: null,
    }
    expect(buildPriceSourceFromFields(fields, 'Test', 'https://test.com', false)).toBeNull()
  })
})
