import type { PriceSource, SerpApiResult } from '@/types'

const BASE_URL = 'https://serpapi.com/search.json'

function getApiKey(): string {
  const key = process.env.SERPAPI_KEY
  if (!key) throw new Error('SERPAPI_KEY environment variable is not set')
  return key
}

// Google organic search — returns URLs with snippets (used to feed into Firecrawl)
export async function serpApiSearch(query: string, num = 8): Promise<SerpApiResult[]> {
  if (!query.trim()) return []
  const key = getApiKey()
  const params = new URLSearchParams({
    api_key: key,
    engine: 'google',
    q: query.trim(),
    num: String(Math.min(Math.max(1, num), 20)),
  })

  const res = await fetch(`${BASE_URL}?${params}`, {
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`SerpAPI organic search failed: ${res.status} ${res.statusText}`)

  const data = await res.json() as {
    organic_results?: Array<{ link: string; title: string; snippet: string; source?: string }>
  }

  return (data.organic_results ?? []).map(r => ({
    url: r.link,
    title: r.title,
    content: r.snippet,
    source: r.source,
  }))
}

// Google Shopping — returns price data directly, NO Firecrawl needed
export async function serpApiShoppingSearch(query: string, num = 10): Promise<PriceSource[]> {
  if (!query.trim()) return []
  const key = getApiKey()
  const params = new URLSearchParams({
    api_key: key,
    engine: 'google_shopping',
    q: query.trim(),
    num: String(Math.min(Math.max(1, num), 20)),
  })

  const res = await fetch(`${BASE_URL}?${params}`, {
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`SerpAPI shopping search failed: ${res.status} ${res.statusText}`)

  const data = await res.json() as {
    shopping_results?: Array<{
      title: string
      extracted_price?: number
      currency?: string
      source: string
      link: string
      product_link?: string
    }>
  }

  return (data.shopping_results ?? [])
    .filter(r => r.extracted_price && r.extracted_price > 0)
    .map(r => ({
      name: r.source,
      url: r.product_link ?? r.link,
      price: r.extracted_price!,
      currency: r.currency ?? 'USD',
      unit: 'each',
      in_stock: true,
    }))
}
