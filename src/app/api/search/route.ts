import { callModel, extractJson } from '@/lib/inference'
import { publishEvent } from '@/lib/pipeline-bus'
import { redis } from '@/lib/redis'
import { serperOrganicSearch, serperShoppingSearch } from '@/lib/serper'
import { jinaExtractAll } from '@/lib/jina'
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
  old_queries?: string[],
  count: number = MAX_ATTEMPTS
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

    const userMessage = buildSearchQueryUserMessage(productName, vision ?? undefined, reSearchContext, count)

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

    // Redis cache: skip entire pipeline on hit.
    // Re-search requests (CP2 flagged contamination → client re-POSTs with `context`)
    // MUST bypass the read cache, otherwise the original — possibly contaminated —
    // result is returned and the exclusion/re-search loop becomes a silent no-op.
    // Key bumped to v3 to invalidate entries cached under the old re-search-blind logic.
    const cacheKey = `search:v3:${productName}:${visionCtx?.barcode ?? 'no-barcode'}`
    const isReSearchRequest = incomingContext != null   // client only sends context on re-search
    const cached = isReSearchRequest ? null : await redis.get<SearchResult>(cacheKey).catch(() => null)
    if (cached) {
      if (runId) await publishEvent(runId, { kind: 'search_cache_hit', cacheKey })
      return Response.json(cached)
    }

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

    const isReSearch = ctx.researchAttempt > 0
    const queries = await planSearchQueries(
      productName,
      visionCtx,
      ctx,
      isReSearch || undefined,
      isReSearch ? [...ctx.triedQueries] : undefined,
      MAX_ATTEMPTS
    )

    if (runId) await publishEvent(runId, { kind: 'search_queries_planned', queries, count: queries.length })

    while (attempt < MAX_ATTEMPTS) {
      const query = queries[attempt] ?? queries[queries.length - 1]
      ctx.triedQueries.push(query)

      if (runId) await publishEvent(runId, { kind: 'search_query', attempt: attempt + 1, query })

      // Shopping-first: attempt 0 skips organic entirely.
      // Organic (Serper → Jina cascade) is expensive — only run when shopping is insufficient.
      const useShoppingApi = attempt === 0 || nextEngine === 'serper_shopping' || nextEngine === 'serpapi_shopping' /* legacy alias */ || nextEngine === 'both'
      const useOrganic = attempt > 0 || nextEngine === 'serper_organic' || nextEngine === 'both'

      // Run engines in parallel, each isolated — one engine erroring (bad key, quota,
      // network) must NOT abort the whole search. Shopping returns prices directly (no cascade).
      const [organicResults, shoppingPrices] = await Promise.all([
        useOrganic
          ? serperOrganicSearch(query).catch(e => { console.error('[search] Serper organic failed:', e); return [] })
          : Promise.resolve([]),
        useShoppingApi
          ? serperShoppingSearch(query).catch(e => { console.error('[search] Serper shopping failed:', e); return [] })
          : Promise.resolve([]),
      ])

      // Pass snippet alongside URL so L1 regex runs for free before any Jina fetch
      const organicItems = organicResults
        .filter(r => {
          try { return !ctx.excludedDomains.includes(new URL(r.url).hostname) } catch { return false }
        })
        .map(r => ({ url: r.url, snippet: r.snippet }))

      // Surface what EACH Serper engine actually returned this attempt. Attempt 0 is
      // shopping-only (shopping-first), so log shopping results and explicitly mark the
      // organic path as skipped — otherwise the skipped engine misleadingly logged
      // "Serper → 0 URLs" even though it was never called.
      if (runId) {
        if (useShoppingApi)
          await publishEvent(runId, { kind: 'search_urls', engine: 'Serper Shopping', urls: shoppingPrices.map(p => p.url) })
        if (useOrganic) {
          await publishEvent(runId, { kind: 'search_urls', engine: 'Serper Organic', urls: organicItems.map(i => i.url) })
          await publishEvent(runId, { kind: 'search_organic', urlCount: organicItems.length })
        } else {
          await publishEvent(runId, { kind: 'search_skip', engine: 'Serper Organic', reason: 'shopping-first — runs only if shopping is insufficient' })
        }
      }
      const { prices: scraped, discardReasons } = await jinaExtractAll(organicItems, visionCtx, runId ?? undefined)
      // Surface verify-gate discard reasons into context so query planner avoids similar categories
      if (discardReasons.length > 0) ctx.contaminationReasons.push(...discardReasons)

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

    // Cache successful result for 24 hours
    await redis.set(cacheKey, result, { ex: 86400 }).catch(e => {
      console.warn('[search] Redis write failed (non-blocking):', e)
    })

    return Response.json(result)
  } catch (err) {
    console.error('[search] Unexpected error:', err)
    return Response.json({ error: 'Search failed' }, { status: 500 })
  }
}
