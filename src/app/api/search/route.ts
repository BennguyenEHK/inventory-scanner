import { tavilySearch } from '@/lib/tavily'
import { firecrawlExtractAll } from '@/lib/firecrawl'
import type { PriceSource, SearchResult } from '@/types'

const TARGET_SOURCES = 5
const MAX_ATTEMPTS = 3

function deduplicate(prices: PriceSource[]): PriceSource[] {
  const seen = new Map<string, PriceSource>()
  for (const p of prices) {
    const domain = new URL(p.url).hostname
    const existing = seen.get(domain)
    // Keep lower price when same domain appears twice
    if (!existing || p.price < existing.price) seen.set(domain, p)
  }
  return Array.from(seen.values())
}

function generateQuery(productName: string, attempt: number, existing: PriceSource[]): string {
  const types = existing.map(s => s.name.toLowerCase())
  if (attempt === 0) return `${productName} price buy`
  if (attempt === 1) {
    const missing = ['distributor', 'manufacturer', 'retailer'].find(t =>
      !types.some(n => n.includes(t))
    ) ?? 'supplier'
    return `${productName} ${missing} cost`
  }
  return `${productName} supplier price USD`
}

function removeOutliers(prices: PriceSource[]): { clean: PriceSource[]; removed: PriceSource[] } {
  if (prices.length < 2) return { clean: prices, removed: [] }
  const sorted = [...prices].sort((a, b) => a.price - b.price)
  const median = sorted[Math.floor(sorted.length / 2)].price
  const clean: PriceSource[] = []
  const removed: PriceSource[] = []
  for (const p of prices) {
    const ratio = p.price / median
    if (ratio < 0.1 || ratio > 10) removed.push(p)
    else clean.push(p)
  }
  return { clean, removed }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const { productName } = await request.json() as { productName: string }
    let prices: PriceSource[] = []
    let attempt = 0

    while (prices.length < TARGET_SOURCES && attempt < MAX_ATTEMPTS) {
      const query = generateQuery(productName, attempt, prices)
      const urls = await tavilySearch(query, 8)
      const scraped = await firecrawlExtractAll(urls.map(r => r.url))
      prices = deduplicate([...prices, ...scraped])

      const uniqueDomains = new Set(prices.map(p => new URL(p.url).hostname)).size
      if (prices.length >= TARGET_SOURCES && uniqueDomains >= 3) break

      attempt++
    }

    const { clean, removed } = removeOutliers(prices)
    const avg = clean.length > 0
      ? Math.round((clean.reduce((s, p) => s + p.price, 0) / clean.length) * 100) / 100
      : 0
    const min = clean.length > 0 ? Math.min(...clean.map(p => p.price)) : 0
    const max = clean.length > 0 ? Math.max(...clean.map(p => p.price)) : 0

    const result: SearchResult = {
      sources: clean,
      avg, min, max,
      currency: clean[0]?.currency ?? 'USD',
      confidence: clean.length >= TARGET_SOURCES ? 'high' : clean.length >= 3 ? 'medium' : 'low',
      flag: clean.length < TARGET_SOURCES ? `⚠️ ${clean.length} sources only — verify price` : null,
      attempts: attempt + 1,
      contaminated_removed: removed,
    }

    return Response.json(result)
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Search failed' },
      { status: 500 }
    )
  }
}
