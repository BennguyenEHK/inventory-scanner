# Search Loop Refactor — Unified Verify+Rank+Sufficiency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current pre-planned 5-query loop + separate `isSufficient` + `removeOutliers` with an adaptive per-attempt loop where each iteration generates 1 query, fills shopping metadata via Jina, then calls a single unified Qwen reasoning step that verifies sources against vision, ranks them, and decides sufficiency — exiting early once the target is reached.

**Architecture:** `planNextQuery` (1 query per attempt, informed by prior hints) → `serperShoppingSearch` → `fillShoppingMetadata` (Jina L2 + Qwen L3 for metadata only, price preserved from Serper) → `reviewAttempt` (merged verify + rank + sufficiency in one Qwen call). The old upfront `planSearchQueries`, standalone `isSufficient`, and `removeOutliers` are all removed. The organic search path is dropped entirely.

**Tech Stack:** TypeScript, Vitest, Next.js API routes, Qwen3.6-35B (thinking OFF), Jina AI Reader, Serper.dev Shopping API

---

## File Map

| File | Change |
|---|---|
| `src/types/index.ts` | Add `imageUrl?: string` to `PriceSource`; add `lastQueryHint?: string` to `SearchContext` |
| `src/lib/serper.ts` | Capture `imageUrl` in `parseShoppingItem` |
| `src/lib/serper.test.ts` | Add test for `imageUrl` pass-through |
| `src/lib/jina.ts` | Add `fillShoppingMetadata()` — partial Jina pass (L2 fetch + L3 gap-fill for metadata only, skip price) |
| `src/lib/jina.test.ts` | Add tests for `fillShoppingMetadata` |
| `src/prompt/search-review.ts` | NEW — `SEARCH_REVIEW_SYSTEM_PROMPT` + `buildReviewUserMessage()` for merged verify+rank+sufficiency |
| `src/prompt/search-query.ts` | Add `nextQueryHint?: string` to `ReSearchContext`; update `buildSearchQueryUserMessage` to include hint |
| `src/app/api/search/route.ts` | Complete refactor — `planNextQuery`, `reviewAttempt`, new loop; remove `isSufficient`, `removeOutliers`, organic path |
| `src/prompt/search-sufficiency.ts` | **DELETE** — replaced by `search-review.ts` |

---

## Task 1: Extend types — `imageUrl` on PriceSource, `lastQueryHint` on SearchContext

**Files:**
- Modify: `src/types/index.ts:60-74` (PriceSource interface)
- Modify: `src/types/index.ts:52-58` (SearchContext interface)

- [ ] **Step 1: Add `imageUrl` to PriceSource and `lastQueryHint` to SearchContext**

In `src/types/index.ts`, update the two interfaces:

```typescript
export interface PriceSource {
  name: string
  url: string
  price: number
  currency: string
  unit: string
  in_stock?: boolean
  imageUrl?: string               // ← ADD: product image from Serper shopping feed
  // v2: expanded extraction fields
  manufacturer?: string
  itemDescription?: string
  length?: string
  width?: string
  items_origin?: string
  manufacturer_flagged?: boolean
}
```

```typescript
export interface SearchContext {
  triedQueries: string[]
  excludedDomains: string[]
  contaminationReasons: string[]
  confirmedSources: PriceSource[]
  researchAttempt: number
  lastQueryHint?: string          // ← ADD: hint from reviewAttempt fed to planNextQuery
}
```

- [ ] **Step 2: Run type check**

```bash
npx tsc --noEmit
```

Expected: 0 errors (imageUrl and lastQueryHint are optional, so no existing callers break).

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "feat(types): add imageUrl to PriceSource, lastQueryHint to SearchContext"
```

---

## Task 2: Capture imageUrl in serper.ts

**Files:**
- Modify: `src/lib/serper.ts:44-55` (`parseShoppingItem`)
- Modify: `src/lib/serper.test.ts`

- [ ] **Step 1: Write the failing test**

In `src/lib/serper.test.ts`, add after the existing tests:

```typescript
test('parseShoppingItem captures imageUrl when present', () => {
  const r = parseShoppingItem({
    title: 'Makita Drill',
    link: 'https://amazon.com/dp/B001',
    source: 'Amazon',
    price: '$149.99',
    imageUrl: 'https://images.amazon.com/product/B001.jpg',
  })
  expect(r).not.toBeNull()
  expect(r!.imageUrl).toBe('https://images.amazon.com/product/B001.jpg')
})

test('parseShoppingItem imageUrl is undefined when absent', () => {
  const r = parseShoppingItem({
    title: 'Makita Drill',
    link: 'https://amazon.com/dp/B001',
    source: 'Amazon',
    price: '$149.99',
  })
  expect(r).not.toBeNull()
  expect(r!.imageUrl).toBeUndefined()
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/lib/serper.test.ts
```

Expected: 2 new tests FAIL (imageUrl not captured yet).

- [ ] **Step 3: Update parseShoppingItem to capture imageUrl**

In `src/lib/serper.ts`, update `parseShoppingItem`:

```typescript
export function parseShoppingItem(item: SerperShoppingItem): PriceSource | null {
  const parsed = parseShoppingPrice(item.price ?? '')
  if (!parsed) return null
  return {
    name: item.source,
    url: item.link,
    price: parsed.price,
    currency: parsed.currency,
    unit: 'each',
    in_stock: true,
    imageUrl: item.imageUrl ?? undefined,
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/lib/serper.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/serper.ts src/lib/serper.test.ts
git commit -m "feat(serper): capture imageUrl from shopping results"
```

---

## Task 3: Add fillShoppingMetadata to jina.ts

**Files:**
- Modify: `src/lib/jina.ts` (add after line 522 — after `jinaExtractAll`)
- Modify: `src/lib/jina.test.ts`

This function takes shopping `PriceSource[]` (which already have price/currency from Serper) and does a targeted Jina L2 fetch + Qwen L3 gap-fill for **metadata only** (`manufacturer`, `itemDescription`, `in_stock`, `items_origin`). It never overwrites `price` or `currency`. It also applies the verify gate if vision is provided.

- [ ] **Step 1: Write the failing tests**

In `src/lib/jina.test.ts`, add at the end:

```typescript
import { vi, type MockedFunction } from 'vitest'
import * as jinaModule from './jina'

describe('fillShoppingMetadata', () => {
  it('returns source unchanged when all metadata fields already present', async () => {
    const src: import('@/types').PriceSource = {
      name: 'Bunnings',
      url: 'https://bunnings.com.au/p/abc',
      price: 29.90,
      currency: 'AUD',
      unit: 'each',
      manufacturer: '3M',
      itemDescription: 'Copper foil tape 25mm',
      items_origin: 'USA',
    }
    // All metadata present — no Jina call needed
    const result = await jinaModule.fillShoppingMetadata([src])
    expect(result).toHaveLength(1)
    expect(result[0].price).toBe(29.90)      // price preserved
    expect(result[0].manufacturer).toBe('3M')
  })

  it('preserves price and currency regardless of Jina content', async () => {
    // Even if Jina returns a different price, Serper price is authoritative
    vi.spyOn(jinaModule, 'jinaFetch').mockResolvedValueOnce('Price: $999.99\nManufacturer: TestCo')
    const src: import('@/types').PriceSource = {
      name: 'Amazon',
      url: 'https://amazon.com/dp/B001',
      price: 49.99,
      currency: 'USD',
      unit: 'each',
    }
    const result = await jinaModule.fillShoppingMetadata([src])
    expect(result[0].price).toBe(49.99)      // Serper price preserved
    expect(result[0].currency).toBe('USD')   // Serper currency preserved
    vi.restoreAllMocks()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/lib/jina.test.ts
```

Expected: `fillShoppingMetadata` tests FAIL (function not defined).

- [ ] **Step 3: Add fillShoppingMetadata to jina.ts**

Add the following at the end of `src/lib/jina.ts` (after `jinaExtractAll`):

```typescript
// ─── Metadata-only fill for shopping results ─────────────────────────────────
// Shopping PriceSources already have price/currency from Serper — we only fill
// manufacturer, itemDescription, in_stock, items_origin via Jina + Qwen gap-fill.
// Price is NEVER overwritten here.

const SHOPPING_METADATA_FIELDS = ['manufacturer', 'itemDescription', 'in_stock', 'items_origin'] as const
type ShoppingMetaField = typeof SHOPPING_METADATA_FIELDS[number]

async function fillShoppingOne(
  src: PriceSource,
  vision?: VisionResult,
  runId?: string,
): Promise<PriceSource | null> {
  const missing = SHOPPING_METADATA_FIELDS.filter(f => src[f as keyof PriceSource] == null) as ShoppingMetaField[]
  if (missing.length === 0) return src
  if (!isScrapeable(src.url)) return src

  const content = await jinaFetch(src.url)
  if (!content) return src

  const patch = await qwenGapFill(missing as string[], src.url, content)

  const filled: PriceSource = {
    ...src,
    manufacturer:    patch.manufacturer    ?? src.manufacturer,
    itemDescription: patch.itemDescription ?? src.itemDescription,
    in_stock:        patch.in_stock        != null ? patch.in_stock : src.in_stock,
    items_origin:    patch.items_origin    ?? src.items_origin,
    // price and currency intentionally NOT patched — Serper is authoritative
  }

  if (vision) {
    const gate = applyVerifyGate(filled, vision)
    if (gate.discard) {
      await logEvent(runId, {
        kind: 'extract_output',
        url: src.url,
        layer: 'L3',
        output: `shopping verify-gate discard: ${gate.reason ?? 'mismatch'}`,
      })
      return null
    }
    filled.manufacturer_flagged = gate.manufacturerFlag === ManufacturerFlag.Mismatch
  }

  return filled
}

/** Fill metadata (manufacturer / itemDescription / in_stock / items_origin) for shopping
 *  PriceSources using Jina L2 + Qwen L3. Price is never overwritten. */
export async function fillShoppingMetadata(
  sources: PriceSource[],
  vision?: VisionResult,
  runId?: string,
): Promise<PriceSource[]> {
  const BATCH = 3
  const results: PriceSource[] = []
  for (let i = 0; i < sources.length; i += BATCH) {
    const batch = sources.slice(i, i + BATCH)
    const settled = await Promise.allSettled(
      batch.map(src => fillShoppingOne(src, vision, runId)),
    )
    for (const s of settled) {
      if (s.status === 'fulfilled' && s.value !== null) results.push(s.value)
    }
  }
  return results
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/lib/jina.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/jina.ts src/lib/jina.test.ts
git commit -m "feat(jina): add fillShoppingMetadata — partial L2+L3 pass preserving Serper price"
```

---

## Task 4: Create search-review.ts — merged verify+rank+sufficiency prompt

**Files:**
- Create: `src/prompt/search-review.ts`

The new prompt replaces both `search-sufficiency.ts` (sufficiency check) and the per-source verify gate done in `route.ts`. One Qwen call per attempt. Output identifies retained/rejected sources by index so `route.ts` can map them back to `PriceSource` objects.

- [ ] **Step 1: Create src/prompt/search-review.ts**

```typescript
import type { PriceSource } from '@/types'
import type { VisionQueryInput } from './search-query'

export const SEARCH_REVIEW_SYSTEM_PROMPT = `You are a price-data validator and quality auditor for an inventory valuation system.

Each attempt, you receive a product description (from vision AI) and a list of price sources found by a search engine. Your job has three parts:

## Part 1 — Verify each source
A source is INVALID if:
- The itemDescription or manufacturer clearly does not match the product being priced
- The source is for an accessory, bundle, or incompatible variant (e.g. battery-only listing when product is a complete drill kit)
- The price is implausibly wrong (10x higher or lower than all other sources without explanation)

A source is VALID if:
- It matches the product category and name, even if description is generic
- It is a different color, size, or configuration of the SAME model — still valid
- Metadata is absent (null) — absence of metadata is NOT grounds for rejection

## Part 2 — Decide sufficiency
sufficient: true ONLY when ALL of:
- retained count ≥ 5
- unique domains in retained ≥ 3

Err toward sufficient: false when ambiguous. A false negative triggers one more search; a false positive stops early with bad data.

## Part 3 — Generate next_query_hint (only when sufficient: false)
Give a specific, actionable hint for the next search query. Examples:
- "search for part number XB123 to find exact variant"
- "try wholesale distributors instead of retail stores"
- "barcode 0088381614931 may find the exact SKU"

## Output format

{"sufficient": true|false, "retained_ids": [0, 2, 3], "rejected_ids": [{"id": 1, "reason": "description says printer ink — wrong product"}], "next_query_hint": "search wholesale distributors for 3M copper foil tape"}

RULES:
- retained_ids + rejected_ids must together account for ALL source indices (0 to N-1)
- next_query_hint must be null when sufficient: true
- Return ONLY valid JSON — no markdown, no prose outside the JSON object`

export function buildReviewUserMessage(
  productName: string,
  prices: PriceSource[],
  vision?: VisionQueryInput,
  context?: { triedQueries: string[]; researchAttempt: number; excludedDomains: string[] },
): string {
  const sourceList = prices
    .map((p, i) => {
      const meta: string[] = []
      if (p.manufacturer)    meta.push(`manufacturer: ${p.manufacturer}`)
      if (p.itemDescription) meta.push(`description: ${p.itemDescription}`)
      if (p.items_origin)    meta.push(`origin: ${p.items_origin}`)
      if (p.in_stock != null) meta.push(`in_stock: ${p.in_stock}`)
      const metaStr = meta.length > 0 ? ` | ${meta.join(', ')}` : ''
      return `[${i}] ${p.name} — ${p.currency} ${p.price}/${p.unit}${metaStr}`
    })
    .join('\n')

  let msg = `Product: "${productName}"`

  if (vision) {
    msg += `
Vision data:
  Brand: ${vision.brand ?? 'unknown'}
  Model: ${vision.model_number ?? 'not identified'}
  Category: ${vision.product_category}
  Description: ${vision.visual_description}`
  }

  msg += `

Price sources (${prices.length} total):
${sourceList}`

  if (context) {
    const queries = context.triedQueries.slice(-3).join(', ') || '(none)'
    msg += `

Search context: attempt ${context.researchAttempt + 1}, tried queries: ${queries}`
  }

  return msg
}
```

- [ ] **Step 2: Run type check**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/prompt/search-review.ts
git commit -m "feat(prompt): add search-review prompt — merged verify+rank+sufficiency"
```

---

## Task 5: Update search-query.ts — add nextQueryHint to ReSearchContext

**Files:**
- Modify: `src/prompt/search-query.ts:64-93`

- [ ] **Step 1: Add nextQueryHint to ReSearchContext and update buildSearchQueryUserMessage**

Replace the `ReSearchContext` interface and `buildSearchQueryUserMessage` function in `src/prompt/search-query.ts`:

```typescript
export interface ReSearchContext {
  oldQueries: string[]
  nextQueryHint?: string   // hint from previous reviewAttempt, guides next query angle
}

export function buildSearchQueryUserMessage(
  productName: string,
  vision?: VisionQueryInput,
  reSearchContext?: ReSearchContext,
  count: number = 1
): string {
  const plural = count === 1 ? 'y' : 'ies'
  const base = `Generate exactly ${count} price-search quer${plural} for this product:

Product name: ${productName}
Brand: ${vision?.brand ?? 'unknown'}
Model: ${vision?.model_number ?? 'not identified'}
Category: ${vision?.product_category ?? 'unknown'}
Visual description: ${vision?.visual_description ?? 'not available'}
Barcode: ${vision?.barcode ?? 'none'}

Required query count: ${count}`

  if (!reSearchContext || reSearchContext.oldQueries.length === 0) return base

  let message = `${base}

IMPORTANT — RE-SEARCH MODE: Previous queries returned insufficient price data. You MUST generate queries that are creatively different from the ones already tried. Think from a completely different angle: different source types, different terminology, different specificity level, or alternative product names/synonyms.

Queries already tried (do NOT repeat or rephrase these):
${reSearchContext.oldQueries.map(q => `- ${q}`).join('\n')}`

  if (reSearchContext.nextQueryHint) {
    message += `

Data-reviewer hint for this attempt: ${reSearchContext.nextQueryHint}
Use this hint to guide the query angle.`
  }

  return message
}
```

Also update the system prompt to handle count=1 gracefully — in `SEARCH_QUERY_SYSTEM_PROMPT`, change the opening line:

```typescript
export const SEARCH_QUERY_SYSTEM_PROMPT = `You are a product market-price search strategist specializing in industrial, commercial, and consumer products.

## Your task

Analyze the product signals provided and generate **exactly** the number of search queries specified in the user message (usually 1 per loop iteration). Each query must target a genuinely different angle from any queries already tried.
// ... rest of prompt unchanged ...
```

(Change only the first sentence of the `## Your task` section — everything else stays identical.)

- [ ] **Step 2: Run type check**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/prompt/search-query.ts
git commit -m "feat(prompt): add nextQueryHint to ReSearchContext; default count to 1"
```

---

## Task 6: Refactor route.ts — new adaptive loop

**Files:**
- Modify: `src/app/api/search/route.ts` (complete rewrite of internal functions + loop)

This is the core task. Replace:
- `planSearchQueries` (generates N queries upfront) → `planNextQuery` (generates 1 per attempt, inside the loop)
- `isSufficient` (separate Qwen call) → merged into `reviewAttempt`
- `removeOutliers` (post-loop math) → merged into `reviewAttempt`
- Organic search path (serperOrganicSearch + jinaExtractAll) → removed entirely

- [ ] **Step 1: Rewrite route.ts**

Replace the full content of `src/app/api/search/route.ts` with:

```typescript
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
// - Verifies each source matches the product using vision metadata
// - Rejects outliers and mismatches
// - Decides whether retained sources are sufficient to stop
// - Returns a hint to guide the next query if not sufficient
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
      // Evaluator returned no verdict — accept what we have
      if (runId) {
        await publishEvent(runId, { kind: 'search_sufficient', sufficient: true, reason: 'auto-accepted (evaluator returned no verdict)' })
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
```

- [ ] **Step 2: Run type check**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Run full test suite**

```bash
npx vitest run
```

Expected: all tests pass (route.ts has no unit tests; we're checking nothing else broke).

- [ ] **Step 4: Commit**

```bash
git add src/app/api/search/route.ts
git commit -m "refactor(search): adaptive loop — planNextQuery + fillShoppingMetadata + reviewAttempt; drop organic path"
```

---

## Task 7: Delete dead files

**Files:**
- Delete: `src/prompt/search-sufficiency.ts` (replaced by `search-review.ts`)

- [ ] **Step 1: Verify nothing imports search-sufficiency.ts**

```bash
grep -rn "search-sufficiency" src/
```

Expected: 0 results (route.ts no longer imports it after Task 6).

- [ ] **Step 2: Delete the file**

```bash
rm src/prompt/search-sufficiency.ts
```

- [ ] **Step 3: Run type check and tests**

```bash
npx tsc --noEmit && npx vitest run
```

Expected: 0 errors, all tests pass.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: delete search-sufficiency.ts — replaced by search-review.ts"
```

---

## Self-Review

### Spec coverage

| Requirement | Task |
|---|---|
| imageUrl captured from Serper | Task 2 |
| Jina for shopping metadata (not price) | Task 3 |
| Qwen thinking OFF per-link (already was) | Task 3 — `qwenGapFill` already uses `enable_thinking: false` |
| planSearchQueries inside loop, 1 query per attempt | Task 6 |
| reviewAttempt merges isSufficient + removeOutliers + verify gate | Task 6 |
| nextQueryHint fed back to planNextQuery | Tasks 5 + 6 |
| Stop early once target hit | Task 6 — `if (sufficient) break` |
| Delete search-sufficiency.ts | Task 7 |
| Organic path removed | Task 6 — `serperOrganicSearch` and `jinaExtractAll` not called |

### Placeholder scan

None found — all steps contain concrete code.

### Type consistency

- `PriceSource.imageUrl?: string` added in Task 1, used in Task 2 (`parseShoppingItem`)
- `SearchContext.lastQueryHint?: string` added in Task 1, used in Task 6 (`planNextQuery` reads it, `reviewAttempt` writes it)
- `ReSearchContext.nextQueryHint?: string` added in Task 5, read in Task 6 (`planNextQuery` passes it to `buildSearchQueryUserMessage`)
- `buildReviewUserMessage` defined in Task 4, called in Task 6 — signatures match
- `fillShoppingMetadata` defined in Task 3, imported in Task 6 — export name matches import
- `SEARCH_REVIEW_SYSTEM_PROMPT` defined in Task 4, imported in Task 6 — name matches
