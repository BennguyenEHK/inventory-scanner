import { Firecrawl } from 'firecrawl'
import type { PriceSource } from '@/types'

const BLOCKED_DOMAINS = [
  'youtube.com', 'youtu.be',
  'linkedin.com', 'facebook.com', 'instagram.com', 'twitter.com', 'x.com',
  'pinterest.com', 'zillow.com', 'pitchbook.com', 'crunchbase.com',
]
const BLOCKED_EXTENSIONS = ['.pdf', '.doc', '.docx', '.xls', '.xlsx']

export function isScrapeable(url: string): boolean {
  try {
    const { hostname, pathname } = new URL(url)
    const path = pathname.toLowerCase()
    return (
      !BLOCKED_DOMAINS.some(d => hostname.includes(d)) &&
      !BLOCKED_EXTENSIONS.some(ext => path.endsWith(ext))
    )
  } catch {
    return false
  }
}

const PRICE_SCHEMA = {
  type: 'object',
  properties: {
    price:    { type: 'number',  description: 'product selling price as a decimal' },
    currency: { type: 'string',  description: 'currency code e.g. USD, EUR, AUD' },
    unit:     { type: 'string',  description: 'unit of sale e.g. each, pack, box, roll' },
    source:   { type: 'string',  description: 'retailer or supplier name' },
    in_stock: { type: 'boolean', description: 'true if product is available to purchase' },
  },
  required: ['price', 'currency'],
}

interface PriceData {
  price?: number
  currency?: string
  unit?: string
  source?: string
  in_stock?: boolean
}

export async function firecrawlExtract(url: string): Promise<PriceSource | null> {
  const apiKey = process.env.FIRECRAWL_API_KEY
  if (!apiKey) throw new Error('FIRECRAWL_API_KEY not set in environment')

  const client = new Firecrawl({ apiKey })
  try {
    const result = await client.scrape(url, {
      formats: [{
        type: 'json',
        schema: PRICE_SCHEMA,
        prompt: 'Extract the product selling price, currency, unit of sale, retailer name, and whether the product is in stock.',
      }],
    })

    const data = result.json as PriceData | undefined
    if (!data?.price || !data?.currency) return null

    return {
      name:     data.source || new URL(url).hostname,
      url,
      price:    data.price,
      currency: data.currency,
      unit:     data.unit ?? 'each',
      in_stock: data.in_stock !== false,
    }
  } catch (error) {
    console.error(`Error extracting from ${url}:`, error)
    return null
  }
}

// Filters unscrapeable URLs first, then processes in batches of 3 to stay
// within Firecrawl's concurrent request limits instead of firing all at once.
export async function firecrawlExtractAll(urls: string[]): Promise<PriceSource[]> {
  const scrapeable = urls.filter(isScrapeable)
  const results: PriceSource[] = []
  const BATCH_SIZE = 3

  for (let i = 0; i < scrapeable.length; i += BATCH_SIZE) {
    const batch = scrapeable.slice(i, i + BATCH_SIZE)
    const batchResults = await Promise.all(batch.map(url => firecrawlExtract(url)))
    results.push(...batchResults.filter((r): r is PriceSource => r !== null))
  }

  return results
}

// Blocks known junk patterns; passes anything that looks like an image URL
const IMAGE_JUNK = /logo|icon|banner|sprite|avatar|thumbnail|header|placeholder|bg[-_]|background|favicon|pixel|tracking|beacon/i
const IMAGE_EXT  = /\.(jpg|jpeg|png|webp|gif|avif)(\?|\/|$)/i

export function isProductImage(url: string): boolean {
  try {
    const { hostname, pathname, href } = new URL(url)
    // Block known CDN junk patterns
    if (IMAGE_JUNK.test(pathname)) return false
    // Accept if href contains an image extension anywhere
    if (IMAGE_EXT.test(href)) return true
    // Accept common image CDN hostnames even without explicit extension
    const imageCdnPatterns = /cdn|img|image|media|static|assets|photo|picture|product/i
    if (imageCdnPatterns.test(hostname)) return true
    return false
  } catch {
    return false
  }
}

export async function firecrawlExtractImages(url: string): Promise<string[]> {
  const apiKey = process.env.FIRECRAWL_API_KEY
  if (!apiKey) return []
  const client = new Firecrawl({ apiKey })
  try {
    const result = await client.scrape(url, { formats: ['images'] })
    return result.images ?? []
  } catch {
    return []
  }
}
