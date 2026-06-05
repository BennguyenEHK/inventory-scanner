import { callModel } from '@/lib/inference'
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

// ReAct sufficiency check — Qwen3.6 (thinking=OFF, fast mode) verifies prices
// are for the correct product, not just that we have enough of them
async function isSufficient(productName: string, prices: PriceSource[]): Promise<boolean> {
  if (prices.length < TARGET_SOURCES) return false
  const uniqueDomains = new Set(prices.map(p => new URL(p.url).hostname)).size
  if (uniqueDomains < 3) return false

  try {
    const raw = await callModel({
      model: 'Qwen/Qwen3.6-35B-A3B',
      enable_thinking: false, // fast mode for loop decisions
      temperature: 0.1,
      max_tokens: 64,
      messages: [{
        role: 'user',
        content: `Are these prices for the correct product "${productName}"? Answer JSON: {"sufficient": true/false, "reason": "brief"}
Prices: ${prices.map(p => `${p.name}: $${p.price} (${p.unit})`).join(', ')}`,
      }],
    })
    const result = JSON.parse(raw) as { sufficient: boolean }
    return result.sufficient === true
  } catch {
    // If model call fails, fall back to count-only check
    return prices.length >= TARGET_SOURCES
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const { productName } = await request.json() as { productName: string }
    let prices: PriceSource[] = []
    let attempt = 0

    while (attempt < MAX_ATTEMPTS) {
      // THINK — generate query based on what source types we still need
      const query = generateQuery(productName, attempt, prices)

      // ACT — search for URLs
      const urls = await tavilySearch(query, 8)

      // ACT — scrape all URLs in parallel (never sequential)
      const scraped = await firecrawlExtractAll(urls.map(r => r.url))
      prices = deduplicate([...prices, ...scraped])

      // OBSERVE + THINK — AI sufficiency check (semantic, not just count)
      const sufficient = await isSufficient(productName, prices)
      if (sufficient) break

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
