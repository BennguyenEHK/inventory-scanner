import { test, expect } from 'vitest'
import { extractJsonLdFromMarkdown, extractFromJsonLd } from './jina'

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
  // Returns a Partial — absent fields are undefined, not null
  const fields = extractFromJsonLd([{ '@type': 'WebSite', name: 'Bunnings' }])
  expect(fields.price).toBeUndefined()
})
