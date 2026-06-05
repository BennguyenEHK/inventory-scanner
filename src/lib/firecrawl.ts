import type { PriceSource } from '@/types'

interface FirecrawlExtractOptions {
  schema: Record<string, string>
  timeout?: number
}

interface FirecrawlResponse {
  success: boolean
  data?: {
    price?: number
    currency?: string
    unit?: string
    source?: string
    url?: string
    in_stock?: boolean
  }
  error?: string
}

const FIRECRAWL_API_BASE = 'https://api.firecrawl.dev/v1'

export async function firecrawlExtract(
  url: string,
  options: FirecrawlExtractOptions = { schema: {} }
): Promise<PriceSource | null> {
  const apiKey = process.env.FIRECRAWL_API_KEY
  if (!apiKey) {
    throw new Error('FIRECRAWL_API_KEY not set in environment')
  }

  try {
    const response = await fetch(`${FIRECRAWL_API_BASE}/extract`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url,
        schema: options.schema,
        timeout: options.timeout || 10000,
      }),
    })

    if (!response.ok) {
      console.error(`Firecrawl extraction failed for ${url}:`, response.statusText)
      return null
    }

    const result = (await response.json()) as FirecrawlResponse
    if (!result.success || !result.data) {
      return null
    }

    const { data } = result
    if (!data.price || !data.currency) {
      return null
    }

    return {
      name: data.source || new URL(url).hostname,
      url,
      price: data.price,
      currency: data.currency,
      unit: data.unit || 'each',
      in_stock: data.in_stock !== false,
    }
  } catch (error) {
    console.error(`Error extracting from ${url}:`, error)
    return null
  }
}

// Always uses the standard price schema — that's the only purpose of this function
export async function firecrawlExtractAll(urls: string[]): Promise<PriceSource[]> {
  const priceSchema = {
    price: 'number — the product selling price',
    currency: 'string — USD, EUR, etc.',
    unit: 'string — each, pack, box, roll',
    source: 'string — retailer/supplier name',
    url: 'string — page URL',
    in_stock: 'boolean',
  }
  const results = await Promise.all(
    urls.map((url) => firecrawlExtract(url, { schema: priceSchema }))
  )
  return results.filter((result): result is PriceSource => result !== null)
}
