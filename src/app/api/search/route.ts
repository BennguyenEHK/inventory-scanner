import { callModel, extractJson } from '@/lib/inference'
import { publishEvent } from '@/lib/pipeline-bus'
import { tavilySearch } from '@/lib/tavily'
import { firecrawlExtractAll } from '@/lib/firecrawl'
import { serpApiShoppingSearch } from '@/lib/serpapi'
import { SEARCH_QUERY_SYSTEM_PROMPT, buildSearchQueryUserMessage, type ReSearchContext } from '@/prompt/search-query'
import { SEARCH_SUFFICIENCY_SYSTEM_PROMPT, buildSufficiencyUserMessage } from '@/prompt/search-sufficiency'
import type { PriceSource, SearchResult, VisionResult, SearchContext } from '@/types'

export const maxDuration = 300

const TARGET_SOURCES = 5
const MAX_ATTEMPTS = 5

function safeHostname(url: string): string {
  try { return new URL(url).hostname } catch { return url }
}

function deduplicate(prices: PriceSource[]): PriceSource[] {
  const seen = new Map<string, PriceSource>()
  for (const p of prices) {
    const domain = safeHostname(p.url)
    const existing = seen.get(domain)
    if (!existing || p.price < existing.price) seen.set(domain, p)
  }
  return Array.from(seen.values())
}

async function planSearchQueries(
  productName: string,
  vision?: VisionResult,
  context?: SearchContext,
  re_search?: boolean,
  old_queries?: string[]
): Promise<string[]> {
  // Template fallback — only used if the AI call fails or returns nothing usable
  const fallback = [
    `${productName} price buy`,
    `${productName} supplier cost`,
    `${productName} buy online USD`,
  ]
  try {
    const reSearchContext: ReSearchContext | undefined =
      re_search && old_queries && old_queries.length > 0
        ? { oldQueries: old_queries }
        : undefined

    const userMessage = buildSearchQueryUserMessage(productName, vision ?? undefined, reSearchContext)

    const raw = await callModel({
      model: 'Qwen/Qwen3.6-35B-A3B:featherless-ai',
      enable_thinking: false,
      temperature: re_search ? 0.4 : 0.2,
      max_tokens: 4096,
      messages: [
        { role: 'system', content: SEARCH_QUERY_SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
    })
    const result = extractJson<{ queries: string[]; reasoning?: string; rationale?: string }>(raw)
    const queries = (result?.queries ?? []).filter(q => typeof q === 'string' && q.trim().length > 0)
    return queries.length > 0 ? queries : fallback
  } catch {
    return fallback
  }
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
  runId: string | null,
  context?: SearchContext
): Promise<{ sufficient: boolean; next_engine?: string }> {
  if (prices.length < TARGET_SOURCES) {
    if (runId) {
      await publishEvent(runId, {
        kind: 'search_sufficient',
        sufficient: false,
        reason: `${prices.length}/${TARGET_SOURCES} prices — need more`,
      })
    }
    return { sufficient: false }
  }

  const uniqueDomains = new Set(prices.map(p => safeHostname(p.url))).size
  if (uniqueDomains < 3) {
    if (runId) {
      await publishEvent(runId, {
        kind: 'search_sufficient',
        sufficient: false,
        reason: `only ${uniqueDomains} unique domain${uniqueDomains !== 1 ? 's' : ''} (need 3+)`,
      })
    }
    return { sufficient: false }
  }

  try {
    const raw = await callModel({
      model: 'Qwen/Qwen3.6-35B-A3B:featherless-ai',
      enable_thinking: false,
      temperature: 0.1,
      max_tokens: 4096,
      messages: [
        { role: 'system', content: SEARCH_SUFFICIENCY_SYSTEM_PROMPT },
        {
          role: 'user',
          content: buildSufficiencyUserMessage(
            productName,
            prices.map(p => ({ name: p.name, price: p.price, unit: p.unit })),
            context
              ? {
                  triedQueries: context.triedQueries,
                  researchAttempt: context.researchAttempt,
                  excludedDomains: context.excludedDomains,
                }
              : undefined
          ),
        },
      ],
    })
    const result = extractJson<{ sufficient: boolean; reason?: string; next_engine?: string }>(raw)
    if (!result) {
      // Could not parse — we already passed the ≥5 prices / ≥3 domains guards above,
      // so accept rather than loop forever burning API calls on an unresponsive evaluator.
      if (runId) {
        await publishEvent(runId, {
          kind: 'search_sufficient',
          sufficient: true,
          reason: 'auto-accepted (evaluator returned no verdict)',
        })
      }
      return { sufficient: true }
    }
    if (runId) {
      await publishEvent(runId, {
        kind: 'search_sufficient',
        sufficient: result.sufficient === true,
        reason: result.reason,
      })
    }
    return { sufficient: result.sufficient === true, next_engine: result.next_engine ?? undefined }
  } catch {
    return { sufficient: prices.length >= TARGET_SOURCES }
  }
}

export async function POST(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const runId = url.searchParams.get('runId')

  try {
    const { productName: rawName, vision: visionCtx, context: incomingContext } = await request.json() as {
      productName: string
      vision?: VisionResult
      context?: SearchContext
    }
    // Truncate product name to prevent prompt injection / oversized AI calls
    const productName = typeof rawName === 'string' ? rawName.slice(0, 200) : 'Unknown Product'

    // Build initial context (merge with incoming if re-search)
    const ctx: SearchContext = incomingContext ?? {
      triedQueries: [],
      excludedDomains: [],
      contaminationReasons: [],
      confirmedSources: [],
      researchAttempt: 0,
    }

    // Start with already-confirmed sources from a previous search cycle
    let prices: PriceSource[] = [...ctx.confirmedSources]

    let attempt = 0
    let nextEngine: string | undefined

    while (attempt < MAX_ATTEMPTS) {
      const isReSearch = attempt > 0
      const queries = await planSearchQueries(
        productName,
        visionCtx,
        ctx,
        isReSearch || undefined,
        isReSearch ? [...ctx.triedQueries] : undefined
      )
      const query = queries[0]
      ctx.triedQueries.push(query)

      if (runId) await publishEvent(runId, { kind: 'search_query', attempt: attempt + 1, query })

      // Engine selection: Tavily always runs; Shopping runs on attempt 0 (high-signal direct
      // prices) and whenever the sufficiency evaluator recommends it for the next attempt.
      const useShoppingApi = attempt === 0 || nextEngine === 'serpapi_shopping' || nextEngine === 'both'
      const useTavily = attempt === 0 || nextEngine === 'tavily' || nextEngine === 'both' || !nextEngine

      // Run engines in parallel, each isolated — one engine erroring (bad key, quota,
      // network) must NOT abort the whole search. Shopping returns prices directly (no Firecrawl).
      const [tavilyResults, shoppingPrices] = await Promise.all([
        useTavily
          ? tavilySearch(query, 8).catch(e => { console.error('[search] Tavily failed:', e); return [] })
          : Promise.resolve([]),
        useShoppingApi
          ? serpApiShoppingSearch(query).catch(e => { console.error('[search] SerpAPI Shopping failed:', e); return [] })
          : Promise.resolve([]),
      ])

      if (runId) await publishEvent(runId, {
        kind: 'search_tavily',
        count: tavilyResults.length,
        urls: tavilyResults.map(r => r.url),
      })

      // Filter out excluded domains before scraping
      const urlsToScrape = tavilyResults
        .map(r => r.url)
        .filter(u => {
          try { return !ctx.excludedDomains.includes(new URL(u).hostname) } catch { return false }
        })

      if (runId) await publishEvent(runId, { kind: 'search_firecrawl', urlCount: urlsToScrape.length })
      const scraped = await firecrawlExtractAll(urlsToScrape)

      // Merge: scraped organic + direct shopping prices
      prices = deduplicate([...prices, ...scraped, ...shoppingPrices])

      if (runId) await publishEvent(runId, {
        kind: 'search_prices',
        newCount: scraped.length + shoppingPrices.length,
        totalCount: prices.length,
      })

      const { sufficient, next_engine } = await isSufficient(productName, prices, runId, ctx)
      nextEngine = next_engine
      if (sufficient) break

      attempt++
    }

    const { clean, removed } = removeOutliers(prices)
    const avg = clean.length > 0
      ? Math.round((clean.reduce((s, p) => s + p.price, 0) / clean.length) * 100) / 100
      : 0
    const min = clean.length > 0 ? Math.min(...clean.map(p => p.price)) : 0
    const max = clean.length > 0 ? Math.max(...clean.map(p => p.price)) : 0

    const contextForRetry: SearchContext = {
      triedQueries: ctx.triedQueries,
      excludedDomains: ctx.excludedDomains,
      contaminationReasons: ctx.contaminationReasons,
      confirmedSources: clean,
      researchAttempt: ctx.researchAttempt + 1,
    }

    const result: SearchResult = {
      sources: clean,
      avg, min, max,
      currency: clean[0]?.currency ?? 'USD',
      confidence: clean.length >= TARGET_SOURCES ? 'high' : clean.length >= 3 ? 'medium' : 'low',
      flag: clean.length < TARGET_SOURCES ? `⚠️ ${clean.length} sources only — verify price` : null,
      attempts: attempt + 1,
      contaminated_removed: removed,
      context_for_retry: contextForRetry,
    }

    return Response.json(result)
  } catch (err) {
    console.error('[search] Unexpected error:', err)
    return Response.json({ error: 'Search failed' }, { status: 500 })
  }
}
