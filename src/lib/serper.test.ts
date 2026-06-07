import { test, expect } from 'vitest'
import { parseShoppingItem, parseOrganicItem } from './serper'

test('parseShoppingItem extracts USD price from dollar string', () => {
  const r = parseShoppingItem({ title: 'Makita Drill', link: 'https://amazon.com/dp/B001', source: 'Amazon', price: '$149.99' })
  expect(r).not.toBeNull()
  expect(r!.price).toBe(149.99)
  expect(r!.currency).toBe('USD')
  expect(r!.name).toBe('Amazon')
  expect(r!.url).toBe('https://amazon.com/dp/B001')
})

test('parseShoppingItem extracts AUD price', () => {
  const r = parseShoppingItem({ title: 'Makita Drill', link: 'https://bunnings.com.au/p/1', source: 'Bunnings', price: 'AU$89.50' })
  expect(r!.price).toBe(89.50)
  expect(r!.currency).toBe('AUD')
})

test('parseShoppingItem returns null for missing price', () => {
  const r = parseShoppingItem({ title: 'Makita Drill', link: 'https://amazon.com/dp/B001', source: 'Amazon', price: '' })
  expect(r).toBeNull()
})

test('parseOrganicItem maps Serper organic result', () => {
  const r = parseOrganicItem({ title: 'Makita DF454', link: 'https://example.com/product', snippet: 'Great drill for $99' })
  expect(r.url).toBe('https://example.com/product')
  expect(r.title).toBe('Makita DF454')
  expect(r.snippet).toBe('Great drill for $99')
})
