import { callModel, extractJson } from '@/lib/inference'
import { publishEvent } from '@/lib/pipeline-bus'
import { redis } from '@/lib/redis'
import { serperShoppingSearch } from '@/lib/serper'
import { fillShoppingMetadata } from '@/lib/jina'
import { SEARCH_QUERY_SYSTEM_PROMPT, buildSearchQueryUserMessage, type ReSearchContext } from '@/prompt/search-query'
import { SEARCH_REVIEW_SYSTEM_PROMPT, buildReviewUserMessage } from '@/prompt/search-review'
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

// Generates exactly 1 high-quality query for this attempt, informed by prior context.
async function planNextQuery(
  productName: string,
  vision?: VisionResult,
  context?: SearchContext,
): Promise<string> {
  const fallback = `${productName} price buy`
  const hasPriorAttempts = context && context.triedQueries.length > 0
  try {
    const reSearchContext: ReSearchContext | undefined = hasPriorAttempts
      ? { oldQueries: context.triedQueries, nextQueryHint: context.lastQueryHint }
      : undefined

    const raw = await callModel({
      model: 'Qwen/Qwen3.6-35B-A3B:featherless-ai',
      enable_thinking: false,
      temperature: hasPriorAttempts ? 0.4 : 0.2,
      max_tokens: 1024,
      messages: [
        { role: 'system', content: SEARCH_QUERY_SYSTEM_PROMPT },
        { role: 'user', content: buildSearchQueryUserMessage(productName, vision ?? undefined, reSearchContext, 1) },
      ],
    })
    const result = extractJson<{ queries: string[] }>(raw)
    const q = result?.queries?.[0]
    return typeof q === 'string' && q.trim().length > 0 ? q.trim() : fallback
  } catch {
    return fallback
  }
}

// Unified verify + rank + sufficiency. Replaces isSufficient() + removeOutliers().
// Verifies each source matches the product using vision metadata, rejects mismatches,
// decides whether retained sources are sufficient to stop, and returns a query hint.
async function reviewAttempt(
  productName: string,
  prices: PriceSource[],
  runId: string | null,
  context?: SearchContext,
  vision?: VisionResult,
): Promise<{
  sufficient: boolean
  retained: PriceSource[]
  rejected: Array<PriceSource & { reason: string }>
  nextQueryHint?: string
}> {
  if (prices.length === 0) return { sufficient: false, retained: [], rejected: [] }

  // Fast-path: below the floor — no point calling the LLM
  if (prices.length < TARGET_SOURCES) {
    if (runId) {
      await publishEvent(runId, {
        kind: 'search_sufficient',
        sufficient: false,
        reason: `${prices.length}/${TARGET_SOURCES} prices`,
      })
    }
    return { sufficient: false, retained: prices, rejected: [] }
  }

  try {
    const raw = await callModel({
      model: 'Qwen/Qwen3.6-35B-A3B:featherless-ai',
      enable_thinking: false,
      temperature: 0.1,
      max_tokens: 1024,
      messages: [
        { role: 'system', content: SEARCH_REVIEW_SYSTEM_PROMPT },
        {
          role: 'user',
          content: buildReviewUserMessage(
            productName,
            prices,
            vision ?? undefined,
            context ? {
              triedQueries: context.triedQueries,
              researchAttempt: context.researchAttempt,
              excludedDomains: context.excludedDomains,
            } : undefined,
          ),
        },
      ],
    })

    const result = extractJson<{
      sufficient: boolean
      retained_ids: number[]
      rejected_ids: Array<{ id: number; reason: string }>
      next_query_hint?: string
    }>(raw)

    if (!result) {
      if (runId) {
        await publishEvent(runId, {
          kind: 'search_sufficient',
          sufficient: true,
          reason: 'auto-accepted (evaluator returned no verdict)',
        })
      }
      return { sufficient: true, retained: prices, rejected: [] }
    }

    const retainedSet = new Set(result.retained_ids ?? [])
    const rejectedMap = new Map((result.rejected_ids ?? []).map(r => [r.id, r.reason]))
    const retained = prices.filter((_, i) => retainedSet.has(i))
    const rejected = prices
      .map((p, i) => retainedSet.has(i) ? null : { ...p, reason: rejectedMap.get(i) ?? 'rejected by review' })
      .filter((p): p is PriceSource & { reason: string } => p !== null)

    if (runId) {
      await publishEvent(runId, {
        kind: 'search_sufficient',
        sufficient: result.sufficient,
        reason: `${retained.length} retained, ${rejected.length} rejected`,
      })
    }

    return {
      sufficient: result.sufficient,
      retained,
      rejected,
      nextQueryHint: result.next_query_hint ?? undefined,
    }
  } catch {
    return { sufficient: prices.length >= TARGET_SOURCES, retained: prices, rejected: [] }
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
    const productName = typeof rawName === 'string' ? rawName.slice(0, 200) : 'Unknown Product'

    // Redis cache: skip entire pipeline on hit.
    // Re-search requests MUST bypass the read cache so the exclusion/re-search loop works.
    // Key bumped to v3 to invalidate entries cached under the old re-search-blind logic.
    const cacheKey = `search:v3:${productName}:${visionCtx?.barcode ?? 'no-barcode'}`
    const isReSearchRequest = incomingContext != null
    const cached = isReSearchRequest ? null : await redis.get<SearchResult>(cacheKey).catch(() => null)
    if (cached) {
      if (runId) await publishEvent(runId, { kind: 'search_cache_hit', cacheKey })
      return Response.json(cached)
    }

    const ctx: SearchContext = incomingContext ?? {
      triedQueries: [],
      excludedDomains: [],
      contaminationReasons: [],
      confirmedSources: [],
      researchAttempt: 0,
    }

    let prices: PriceSource[] = [...ctx.confirmedSources]
    let attempt = 0
    const allRejected: Array<PriceSource & { reason: string }> = []

    while (attempt < MAX_ATTEMPTS) {
      // 1. Generate one query for this attempt, informed by what was tried + last hint
      const query = await planNextQuery(productName, visionCtx, ctx)
      ctx.triedQueries.push(query)

      if (runId) await publishEvent(runId, { kind: 'search_query', attempt: attempt + 1, query })

      // 2. Shopping harvest — price is authoritative from Serper
      const shoppingRaw = await serperShoppingSearch(query).catch(e => {
        console.error('[search] Serper shopping failed:', e)
        return [] as PriceSource[]
      })
      if (runId) await publishEvent(runId, {
        kind: 'search_urls',
        engine: 'Serper Shopping',
        urls: shoppingRaw.map(p => p.url),
      })

      // 3. Fill metadata gaps (manufacturer, itemDescription, in_stock, items_origin)
      //    via Jina L2 + Qwen L3. Price is never overwritten.
      const shoppingFilled = await fillShoppingMetadata(shoppingRaw, visionCtx, runId ?? undefined)

      // 4. Merge with retained sources from prior attempts
      prices = deduplicate([...prices, ...shoppingFilled])
      if (runId) await publishEvent(runId, {
        kind: 'search_prices',
        newCount: shoppingFilled.length,
        totalCount: prices.length,
      })

      // 5. Unified verify + rank + sufficiency decision
      const { sufficient, retained, rejected, nextQueryHint } = await reviewAttempt(
        productName, prices, runId, ctx, visionCtx,
      )
      prices = retained
      allRejected.push(...rejected)
      ctx.lastQueryHint = nextQueryHint

      if (sufficient) break
      attempt++
    }

    const avg = prices.length > 0
      ? Math.round((prices.reduce((s, p) => s + p.price, 0) / prices.length) * 100) / 100
      : 0
    const min = prices.length > 0 ? Math.min(...prices.map(p => p.price)) : 0
    const max = prices.length > 0 ? Math.max(...prices.map(p => p.price)) : 0

    const contextForRetry: SearchContext = {
      triedQueries: ctx.triedQueries,
      excludedDomains: ctx.excludedDomains,
      contaminationReasons: ctx.contaminationReasons,
      confirmedSources: prices,
      researchAttempt: ctx.researchAttempt + 1,
    }

    const result: SearchResult = {
      sources: prices,
      avg, min, max,
      currency: prices[0]?.currency ?? 'USD',
      confidence: prices.length >= TARGET_SOURCES ? 'high' : prices.length >= 3 ? 'medium' : 'low',
      flag: prices.length < TARGET_SOURCES ? `⚠️ ${prices.length} sources only — verify price` : null,
      attempts: attempt + 1,
      contaminated_removed: allRejected,
      context_for_retry: contextForRetry,
    }

    await redis.set(cacheKey, result, { ex: 86400 }).catch(e => {
      console.warn('[search] Redis write failed (non-blocking):', e)
    })

    return Response.json(result)
  } catch (err) {
    console.error('[search] Unexpected error:', err)
    return Response.json({ error: 'Search failed' }, { status: 500 })
  }
}
