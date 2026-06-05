import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { firecrawlExtract, firecrawlExtractAll } from './firecrawl'

describe('firecrawl', () => {
  const originalFetch = global.fetch
  const originalEnv = process.env.FIRECRAWL_API_KEY

  beforeEach(() => {
    process.env.FIRECRAWL_API_KEY = 'test-key-123'
  })

  afterEach(() => {
    global.fetch = originalFetch
    process.env.FIRECRAWL_API_KEY = originalEnv
  })

  describe('firecrawlExtract', () => {
    it('extracts price data from a valid response', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            price: 12.99,
            currency: 'USD',
            unit: 'each',
            source: 'Amazon',
            url: 'https://amazon.com/product',
            in_stock: true,
          },
        }),
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

    it('returns null if response is not ok', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        statusText: 'Not Found',
      })

      const result = await firecrawlExtract('https://invalid.com/product')
      expect(result).toBeNull()
    })

    it('returns null if extraction fails', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: false,
          error: 'Extraction failed',
        }),
      })

      const result = await firecrawlExtract('https://example.com/product')
      expect(result).toBeNull()
    })

    it('returns null if price is missing', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            currency: 'USD',
            unit: 'each',
          },
        }),
      })

      const result = await firecrawlExtract('https://example.com/product')
      expect(result).toBeNull()
    })

    it('defaults to hostname if source name is missing', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            price: 5.50,
            currency: 'USD',
            unit: 'roll',
            url: 'https://retailer.com/product',
          },
        }),
      })

      const result = await firecrawlExtract('https://retailer.com/product')
      expect(result?.name).toBe('retailer.com')
    })

    it('throws error if FIRECRAWL_API_KEY is not set', async () => {
      delete process.env.FIRECRAWL_API_KEY
      await expect(firecrawlExtract('https://example.com/product')).rejects.toThrow(
        'FIRECRAWL_API_KEY not set'
      )
    })
  })

  describe('firecrawlExtractAll', () => {
    it('extracts prices from multiple URLs in parallel', async () => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              price: 10.0,
              currency: 'USD',
              unit: 'each',
              source: 'Store A',
              url: 'https://store-a.com/product',
              in_stock: true,
            },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              price: 12.0,
              currency: 'USD',
              unit: 'each',
              source: 'Store B',
              url: 'https://store-b.com/product',
              in_stock: true,
            },
          }),
        })

      const results = await firecrawlExtractAll([
        'https://store-a.com/product',
        'https://store-b.com/product',
      ])

      expect(results).toHaveLength(2)
      expect(results[0].price).toBe(10.0)
      expect(results[1].price).toBe(12.0)
    })

    it('filters out null results', async () => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              price: 10.0,
              currency: 'USD',
              unit: 'each',
              source: 'Store A',
              url: 'https://store-a.com/product',
            },
          }),
        })
        .mockResolvedValueOnce({
          ok: false,
          statusText: 'Not Found',
        })

      const results = await firecrawlExtractAll([
        'https://store-a.com/product',
        'https://invalid.com/product',
      ])

      expect(results).toHaveLength(1)
      expect(results[0].price).toBe(10.0)
    })

    it('returns empty array if all extractions fail', async () => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: false,
          statusText: 'Not Found',
        })
        .mockResolvedValueOnce({
          ok: false,
          statusText: 'Not Found',
        })

      const results = await firecrawlExtractAll([
        'https://invalid1.com/product',
        'https://invalid2.com/product',
      ])

      expect(results).toHaveLength(0)
    })
  })
})
