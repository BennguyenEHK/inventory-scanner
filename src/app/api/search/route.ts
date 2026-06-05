import { callModel } from '@/lib/inference'
import { publishEvent } from '@/lib/pipeline-bus'
import { tavilySearch } from '@/lib/tavily'
import { firecrawlExtractAll } from '@/lib/firecrawl'
import type { PriceSource, SearchResult, VisionResult } from '@/types'

const TARGET_SOURCES = 5
const MAX_ATTEMPTS = 3

function deduplicate(prices: PriceSource[]): PriceSource[] {
  const seen = new Map<string, PriceSource>()
  for (const p of prices) {
    const domain = new URL(p.url).hostname
    const existing = seen.get(domain)
    if (!existing || p.price < existing.price) seen.set(domain, p)
  }
  return Array.from(seen.values())
}

function generateQuery(
  productName: string,
  attempt: number,
  existing: PriceSource[],
  vision?: VisionResult
): string {
  // Build a rich base from all available product signals
  const parts: string[] = []

  // Use brand + model number when available — much more precise than product name alone
  if (vision?.brand && vision?.model_number) {
    parts.push(vision.brand, vision.model_number)
  } else if (vision?.brand) {
    parts.push(vision.brand)
    parts.push(productName)
  } else {
    parts.push(productName)
  }

  const category = vision?.product_category ?? ''
  const types = existing.map(s => s.name.toLowerCase())

  if (attempt === 0) {
    // First attempt: brand + model + category for precision
    if (category) return `${parts.join(' ')} ${category} price`
    return `${parts.join(' ')} price buy`
  }

  if (attempt === 1) {
    // Second attempt: find a missing source type
    const missing = ['distributor', 'wholesale', 'retailer', 'supplier'].find(t =>
      !types.some(n => n.includes(t))
    ) ?? 'supplier'
    return `${parts.join(' ')} ${missing} cost`
  }

  // Third attempt: broaden with category + USD qualifier
  if (category) return `${category} ${parts.join(' ')} buy online price USD`
  return `${parts.join(' ')} supplier price USD`
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

async function isSufficient(
  productName: string,
  prices: PriceSource[],
  runId: string | null
): Promise<boolean> {
  if (prices.length < TARGET_SOURCES) {
    if (runId) {
      await publishEvent(runId, {
        kind: 'search_sufficient',
        sufficient: false,
        reason: `${prices.length}/${TARGET_SOURCES} prices — need more`,
      })
    }
    return false
  }

  const uniqueDomains = new Set(prices.map(p => new URL(p.url).hostname)).size
  if (uniqueDomains < 3) {
    if (runId) {
      await publishEvent(runId, {
        kind: 'search_sufficient',
        sufficient: false,
        reason: `only ${uniqueDomains} unique domain${uniqueDomains !== 1 ? 's' : ''} (need 3+)`,
      })
    }
    return false
  }

  try {
    const raw = await callModel({
      model: 'Qwen/Qwen3.6-35B-A3B:featherless-ai',
      enable_thinking: false,
      temperature: 0.1,
      max_tokens: 256,
      messages: [{
        role: 'user',
        content: `Are these prices for the correct product "${productName}"? Answer JSON: {"sufficient": true/false, "reason": "brief"}
Prices: ${prices.map(p => `${p.name}: $${p.price} (${p.unit})`).join(', ')}`,
      }],
    })
    const result = JSON.parse(raw) as { sufficient: boolean; reason?: string }
    if (runId) {
      await publishEvent(runId, {
        kind: 'search_sufficient',
        sufficient: result.sufficient === true,
        reason: result.reason,
      })
    }
    return result.sufficient === true
  } catch {
    return prices.length >= TARGET_SOURCES
  }
}

export async function POST(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const runId = url.searchParams.get('runId')

  try {
    const { productName, vision: visionCtx } = await request.json() as {
      productName: string
      vision?: VisionResult
    }
    let prices: PriceSource[] = []
    let attempt = 0

    while (attempt < MAX_ATTEMPTS) {
      const query = generateQuery(productName, attempt, prices, visionCtx)

      // Publish the query being used
      if (runId) {
        await publishEvent(runId, { kind: 'search_query', attempt: attempt + 1, query })
      }

      // Search for URLs
      const urls = await tavilySearch(query, 8)
      if (runId) {
        await publishEvent(runId, {
          kind: 'search_tavily',
          count: urls.length,
          urls: urls.map(r => r.url),
        })
      }

      // Scrape all URLs
      if (runId) {
        await publishEvent(runId, { kind: 'search_firecrawl', urlCount: urls.length })
      }
      const scraped = await firecrawlExtractAll(urls.map(r => r.url))
      prices = deduplicate([...prices, ...scraped])

      if (runId) {
        await publishEvent(runId, {
          kind: 'search_prices',
          newCount: scraped.length,
          totalCount: prices.length,
        })
      }

      const sufficient = await isSufficient(productName, prices, runId)
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
