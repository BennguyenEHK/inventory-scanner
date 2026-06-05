import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Firecrawl } from 'firecrawl'
import { firecrawlExtract, firecrawlExtractAll, firecrawlExtractImages, isProductImage, isScrapeable } from './firecrawl'

// vi.hoisted ensures mockScrape exists when vi.mock factory runs (vi.mock is hoisted above imports)
const mockScrape = vi.hoisted(() => vi.fn())

// SDK uses axios internally — mock the module, not global.fetch.
// Must use a regular function (not arrow) so `new Firecrawl()` works as a constructor.
vi.mock('firecrawl', () => ({
  Firecrawl: vi.fn().mockImplementation(function () {
    return { scrape: mockScrape }
  }),
}))

beforeEach(() => {
  process.env.FIRECRAWL_API_KEY = 'test-key-123'
})

afterEach(() => {
  delete process.env.FIRECRAWL_API_KEY
  vi.clearAllMocks()
})

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

describe('firecrawlExtract', () => {
  it('calls scrape with json format, schema, and prompt', async () => {
    mockScrape.mockResolvedValueOnce({ json: { price: 10, currency: 'USD' } })

    await firecrawlExtract('https://example.com/product')

    expect(mockScrape).toHaveBeenCalledWith('https://example.com/product', {
      formats: [expect.objectContaining({
        type: 'json',
        schema: expect.any(Object),
        prompt: expect.any(String),
      })],
    })
  })

  it('instantiates Firecrawl with the API key from env', async () => {
    mockScrape.mockResolvedValueOnce({ json: { price: 10, currency: 'USD' } })

    await firecrawlExtract('https://example.com/product')

    expect(vi.mocked(Firecrawl)).toHaveBeenCalledWith({ apiKey: 'test-key-123' })
  })

  it('extracts price data from a valid response', async () => {
    mockScrape.mockResolvedValueOnce({
      json: { price: 12.99, currency: 'USD', unit: 'each', source: 'Amazon', in_stock: true },
    })

    const result = await firecrawlExtract('https://amazon.com/product')
    expect(result).toEqual({
      name: 'Amazon',
      url: 'https://amazon.com/product',
      price: 12.99,
      currency: 'USD',
      unit: 'each',
      in_stock: true,
    })
  })

  it('returns null when scrape returns no json field', async () => {
    mockScrape.mockResolvedValueOnce({ markdown: '# Product page' })
    expect(await firecrawlExtract('https://example.com/product')).toBeNull()
  })

  it('returns null when price is missing', async () => {
    mockScrape.mockResolvedValueOnce({ json: { currency: 'USD', unit: 'each' } })
    expect(await firecrawlExtract('https://example.com/product')).toBeNull()
  })

  it('returns null when scrape throws (e.g. 400 / 429)', async () => {
    mockScrape.mockRejectedValueOnce(new Error('Bad Request'))
    expect(await firecrawlExtract('https://example.com/product')).toBeNull()
  })

  it('defaults to hostname when source name is absent', async () => {
    mockScrape.mockResolvedValueOnce({ json: { price: 5.50, currency: 'USD', unit: 'roll' } })
    const result = await firecrawlExtract('https://retailer.com/product')
    expect(result?.name).toBe('retailer.com')
  })

  it('throws if FIRECRAWL_API_KEY is not set', async () => {
    delete process.env.FIRECRAWL_API_KEY
    await expect(firecrawlExtract('https://example.com/product')).rejects.toThrow(
      'FIRECRAWL_API_KEY not set'
    )
  })
})

describe('firecrawlExtractAll', () => {
  it('skips unscrapeable URLs without calling scrape', async () => {
    mockScrape.mockResolvedValueOnce({
      json: { price: 10.0, currency: 'USD', unit: 'each', source: 'Store A', in_stock: true },
    })

    const results = await firecrawlExtractAll([
      'https://store-a.com/product',
      'https://www.linkedin.com/in/someone',
      'https://www.youtube.com/watch?v=abc',
      'https://example.com/catalogue.pdf',
    ])

    expect(mockScrape).toHaveBeenCalledTimes(1)
    expect(results).toHaveLength(1)
    expect(results[0].price).toBe(10.0)
  })

  it('processes URLs in batches of 3', async () => {
    for (let i = 1; i <= 7; i++) {
      mockScrape.mockResolvedValueOnce({ json: { price: i * 1.0, currency: 'USD', unit: 'each' } })
    }

    const urls = Array.from({ length: 7 }, (_, i) => `https://store.com/product-${i + 1}`)
    const results = await firecrawlExtractAll(urls)

    expect(mockScrape).toHaveBeenCalledTimes(7)
    expect(results).toHaveLength(7)
  })

  it('filters out null results', async () => {
    mockScrape
      .mockResolvedValueOnce({ json: { price: 10.0, currency: 'USD', unit: 'each', source: 'Store A' } })
      .mockResolvedValueOnce({ markdown: 'no price here' })

    const results = await firecrawlExtractAll([
      'https://store-a.com/product',
      'https://invalid.com/product',
    ])

    expect(results).toHaveLength(1)
    expect(results[0].price).toBe(10.0)
  })

  it('returns empty array if all extractions fail', async () => {
    mockScrape
      .mockRejectedValueOnce(new Error('fail'))
      .mockRejectedValueOnce(new Error('fail'))

    const results = await firecrawlExtractAll([
      'https://invalid1.com/product',
      'https://invalid2.com/product',
    ])

    expect(results).toHaveLength(0)
  })

  it('returns empty array if all URLs are unscrapeable', async () => {
    const results = await firecrawlExtractAll([
      'https://linkedin.com/in/a',
      'https://youtube.com/watch?v=b',
      'https://example.com/file.pdf',
    ])
    expect(mockScrape).not.toHaveBeenCalled()
    expect(results).toHaveLength(0)
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

describe('firecrawlExtractImages', () => {
  it('returns image URLs from a page', async () => {
    mockScrape.mockResolvedValueOnce({
      images: [
        'https://store.com/product.jpg',
        'https://store.com/logo.png',
        'https://store.com/detail.webp',
      ],
    })

    const result = await firecrawlExtractImages('https://store.com/product-page')
    expect(result).toEqual([
      'https://store.com/product.jpg',
      'https://store.com/logo.png',
      'https://store.com/detail.webp',
    ])
    expect(mockScrape).toHaveBeenCalledWith('https://store.com/product-page', {
      formats: ['images'],
    })
  })

  it('returns empty array when page has no images', async () => {
    mockScrape.mockResolvedValueOnce({ markdown: '# Page' })
    expect(await firecrawlExtractImages('https://example.com')).toEqual([])
  })

  it('returns empty array when scrape throws', async () => {
    mockScrape.mockRejectedValueOnce(new Error('network error'))
    expect(await firecrawlExtractImages('https://example.com')).toEqual([])
  })

  it('returns empty array when FIRECRAWL_API_KEY is missing', async () => {
    delete process.env.FIRECRAWL_API_KEY
    expect(await firecrawlExtractImages('https://example.com')).toEqual([])
  })
})
