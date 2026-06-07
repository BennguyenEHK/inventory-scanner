# Search Pipeline — Cost Analysis & Architecture Update

> **Date:** 2026-06-07
> **Scope:** Replacing the current Firecrawl + SerpAPI + Tavily stack with a cost-optimised alternative that fits within a $20–30/month budget for 10–50 items/day.

---

## 1. Current Stack (what exists today)

| Component | Role | File |
|---|---|---|
| `gemini-2.5-flash` | Vision / image-to-text analysis | `src/lib/gemini-images.ts` |
| `Qwen3.6-35B-A3B` via HF Featherless | Query planning + sufficiency evaluation | `src/lib/inference.ts` |
| **Tavily** | Organic web search → returns 8 URLs with content | `src/lib/tavily.ts` |
| **Firecrawl** | LLM-powered page scraping → extracts `{price, currency, unit, source}` | `src/lib/firecrawl.ts` |
| **SerpAPI** Google Shopping | Structured price data, no scraping needed | `src/lib/serpapi.ts` |
| Upstash Redis | Client exists, result caching not yet implemented | `src/lib/redis.ts` |

### Current cost at 50 items/day (~1,500/month)

| Service | Monthly cost | Why it's a problem |
|---|---|---|
| Gemini 2.5 Flash | ~$0.45 | Fine |
| HF Featherless | ~$2–4 | Fine |
| Tavily Pro | **$35** | Free tier only covers ~600 searches/month |
| SerpAPI Developer | **$50** | Fixed monthly floor, no pay-as-you-go |
| Firecrawl Growth | **$83–160+** | 1 credit per page scrape; 8 URLs × 2 attempts × 1,500 items |
| **Total** | **~$170–250/month** | Far exceeds $20–30 budget |

Firecrawl and SerpAPI together account for **~85% of the total cost**.

---

## 2. Proposed Alternative Stack

### What changes and why

#### Replace Firecrawl → Jina AI Reader + Gemini Flash extraction

**Firecrawl** is a managed LLM-powered scraping service. It charges per page scraped and runs its own internal LLM to extract structured data. At scale this becomes the single largest cost driver.

**Jina AI Reader** (`r.jina.ai/{url}`) is a free/cheap HTTP service that converts any webpage to clean markdown. We then run a single small Gemini Flash call to extract `{price, currency, unit, source}` from that markdown.

```
Before:  URL → Firecrawl (scrape + LLM extract) → PriceSource
After:   URL → GET r.jina.ai/{url} → markdown → Gemini Flash → PriceSource
```

Accuracy is equivalent — Firecrawl uses an LLM internally anyway. Jina's markdown output is often cleaner than raw HTML, giving the extraction LLM better signal.

**Code change:** Replace `firecrawlExtract(url)` in `src/lib/firecrawl.ts` with a `jinaExtract(url)` function that:
1. Fetches `https://r.jina.ai/${url}` with your Jina API key header
2. Passes the returned markdown to `callModel()` (Gemini Flash) with the existing `PRICE_SCHEMA` prompt
3. Returns the same `PriceSource | null` type — zero changes to callers

#### Replace SerpAPI → Serper.dev

**SerpAPI** charges a fixed $50/month regardless of volume. At 10 items/day (300/month), that is $50 for ~300 shopping searches — wildly inefficient.

**Serper.dev** offers the same Google Shopping structured results (extracted prices, no scraping) at **$0.001 per call** pay-as-you-go. No monthly floor.

**Code change:** Replace `serpApiShoppingSearch()` in `src/lib/serpapi.ts` with a `serperShoppingSearch()` function targeting `https://google.serper.dev/shopping`. The response shape is slightly different but maps to the same `PriceSource[]` output type.

#### Replace Tavily → Brave Search API

**Tavily** Pro costs $35/month once you exceed 1,000 searches/month (~15 items/day at 2 attempts average).

**Brave Search API** offers:
- **$5 per 1,000 requests** pay-as-you-go
- **$5 in free credits automatically applied every month** (= 1,000 free requests/month)
- No monthly subscription floor

At 10 items/day (600 searches/month) this is free. At 50 items/day with the shopping-first optimisation (see §4), it stays at ~$6/month.

**Code change:** Replace `tavilySearch()` in `src/lib/tavily.ts` with a `braveSearch()` function targeting `https://api.search.brave.com/res/v1/web/search`. Returns the same URL + snippet structure, maps directly to the `TavilyResult[]` type used by `route.ts`.

#### Wire up Redis result caching

The Upstash Redis client already exists in `src/lib/redis.ts` but is never used in the search pipeline. A 24-hour cache keyed by product name / barcode would eliminate repeat API calls for the same product — realistic hit rate for a physical inventory scanner is 40–60%.

**Code change:** At the top of the `POST` handler in `src/app/api/search/route.ts`:
1. Build a cache key from `productName` + `vision.barcode` (if available)
2. Check `redis.get(cacheKey)` → if hit, return immediately
3. At the end of a successful search, `redis.set(cacheKey, result, { ex: 86400 })`

---

## 3. Pricing Reference

### Per-call costs

| Service | Unit cost | Basis |
|---|---|---|
| Jina AI Reader | **$0.00015 per page** (avg) | $0.05 / 1M output tokens; avg product page = ~3,000 tokens |
| Jina AI Reader (heavy page) | **$0.0005 per page** (max) | 10,000 tokens at $0.05 / 1M |
| Serper.dev Shopping | **$0.001 per search** | $50 = 50,000 credits; $1 per 1,000 |
| Brave Search | **$0.005 per search** | $5 per 1,000 requests |
| Brave Search (within free credits) | **$0** | First 1,000 requests/month free via $5 monthly credit |
| Gemini 2.5 Flash (vision) | ~$0.0002 per image | $0.075/1M input + $0.30/1M output; ~1,500 input + 400 output tokens |
| Gemini 2.5 Flash (extraction) | ~$0.00028 per extraction | 3,500 input + 50 output tokens |
| HF Featherless / Qwen3.6-35B | ~$0.001–0.003 per LLM call | Est. $0.20–0.40/1M tokens; avg 2,000 tokens/call |

### Top-up longevity

#### Jina AI — $50 top-up = 1 billion tokens

| Volume | Tokens/month | Top-up lasts |
|---|---|---|
| 10 items/day (300/month × 12 pages × 3,000 tokens) | 10.8M | **~92 months (7+ years)** |
| 50 items/day (1,500/month × 12 pages × 3,000 tokens) | 54M | **~18.5 months** |

One $50 top-up covers the entire 3–6 month goal at any volume.

#### Serper.dev — $50 top-up = 50,000 credits

| Volume | Credits/month | Top-up lasts |
|---|---|---|
| 10 items/day (300 × 1.5 avg searches) | 450 | **~111 months** |
| 30 items/day (900 × 1.5) | 1,350 | **~37 months** |
| 50 items/day (1,500 × 1.5) | 2,250 | **~22 months** |

One $50 top-up covers well beyond 6 months at any volume.

#### Existing 2,500 Serper credits (before top-up)

| Volume | Lasts |
|---|---|
| 10 items/day | ~5.5 months ✅ covers 3–6 month goal |
| 30 items/day | ~1.9 months ⚠️ |
| 50 items/day | ~1.1 months ❌ top-up needed immediately |

---

## 4. Shopping-First Strategy (critical optimisation for high volume)

### The problem

Currently, the pipeline runs Brave (organic search) and Serper.dev (shopping) **in parallel on every attempt**. At 50 items/day this means ~3,000 Brave searches/month, costing $15/month ($5 base + $10 overage).

### The fix

Restructure attempt 0 to Shopping-first:

```
Attempt 0: Serper.dev Shopping only (skip Brave)
  → if 5+ prices from 3+ domains → DONE (zero Brave calls used)
  → else → continue to attempt 1

Attempt 1+: Brave organic search alongside Shopping
```

For products with a visible barcode or clear brand + model, Google Shopping alone is sufficient **~60% of the time**. This cuts Brave calls to:

```
50 items/day × 40% needing Brave × avg 2 searches = 40 Brave/day
40 × 30 days = 1,200 searches/month
1,200 − 1,000 free = 200 × $0.005 = $1 overage
Total Brave cost: $5 base credit + $1 = $6/month
```

**Saving: ~$9/month at 50 items/day.**

---

## 5. Monthly Cost Projections

### Final stack: Gemini Flash + HF Featherless + Brave + Serper.dev + Jina + Redis

#### At 10 items/day — 300 items/month

| Component | Usage/month | Monthly cost |
|---|---|---|
| Gemini 2.5 Flash (vision) | 300 calls | ~$0.07 |
| Gemini 2.5 Flash (extraction) | 3,600 calls (12 per item) | ~$1.00 |
| HF Featherless / Qwen3.6 | 900 calls (3 per item) | ~$0.50–1.00 |
| Brave Search | 600 searches (within 1K free) | **$0** |
| Serper.dev | 450 searches × $0.001 | **$0.45** |
| Jina Reader | 10.8M tokens × $0.05/1M | **$0.54** |
| Upstash Redis | — | **$0** |
| **Total** | | **~$2.50–3.50/month** |

#### At 30 items/day — 900 items/month

| Component | Usage/month | Monthly cost |
|---|---|---|
| Gemini 2.5 Flash (vision) | 900 calls | ~$0.20 |
| Gemini 2.5 Flash (extraction) | 10,800 calls | ~$3.00 |
| HF Featherless / Qwen3.6 | 2,700 calls | ~$1.50–2.70 |
| Brave Search | 1,800 searches (800 over free) | **$5 + $4 = $9** (or ~$1 with shopping-first) |
| Serper.dev | 1,350 searches × $0.001 | **$1.35** |
| Jina Reader | 32.4M tokens × $0.05/1M | **$1.62** |
| Upstash Redis | — | **$0** |
| **Total (no optimisation)** | | **~$17–19/month** |
| **Total (shopping-first)** | | **~$9–11/month** |

#### At 50 items/day — 1,500 items/month

| Component | Usage/month | Monthly cost |
|---|---|---|
| Gemini 2.5 Flash (vision) | 1,500 calls | ~$0.35 |
| Gemini 2.5 Flash (extraction) | 18,000 calls | ~$5.00 |
| HF Featherless / Qwen3.6 | 4,500 calls | ~$2.50–4.00 |
| Brave Search (no optimisation) | 3,000 searches | **$15** ⚠️ |
| Brave Search (shopping-first) | 1,200 searches | **$6** ✅ |
| Serper.dev | 2,250 searches × $0.001 | **$2.25** |
| Jina Reader | 54M tokens × $0.05/1M | **$2.70** |
| Upstash Redis | — | **$0** |
| **Total (no optimisation)** | | **~$27–29/month** ⚠️ |
| **Total (shopping-first)** | | **~$18–20/month** ✅ |

---

## 6. Budget Summary

| Volume | Without optimisations | With shopping-first + Redis cache | Budget |
|---|---|---|---|
| 10 items/day | ~$3.50/month | ~$2/month | ✅ $20–30 |
| 30 items/day | ~$18/month | ~$10/month | ✅ $20–30 |
| 50 items/day | ~$28/month | ~$20/month | ✅ $20–30 |

Redis caching provides an additional 40–60% reduction on repeat product scans — the most impactful zero-cost optimisation available since the client is already set up.

---

## 7. Implementation Checklist

### High priority (required to stay in budget)

- [ ] **Replace Firecrawl with Jina AI Reader** — `src/lib/firecrawl.ts`
  - Add `JINA_API_KEY` to `.env`
  - Replace `firecrawlExtract(url)` with `jinaExtract(url)` using `r.jina.ai`
  - Add Gemini Flash extraction call on the returned markdown
  - Keep `isScrapeable()`, `firecrawlExtractAll()`, and `isProductImage()` — only swap the core extraction logic

- [ ] **Replace SerpAPI with Serper.dev** — `src/lib/serpapi.ts`
  - Add `SERPER_API_KEY` to `.env`
  - Replace `serpApiShoppingSearch()` with `serperShoppingSearch()` targeting `https://google.serper.dev/shopping`
  - Map response to same `PriceSource[]` shape

- [ ] **Replace Tavily with Brave Search** — `src/lib/tavily.ts`
  - Add `BRAVE_API_KEY` to `.env`
  - Replace `tavilySearch()` with `braveSearch()` targeting Brave Search API
  - Map response to same `TavilyResult[]` shape

### Medium priority (meaningful cost reduction)

- [ ] **Wire up Redis caching** — `src/app/api/search/route.ts`
  - Cache key: `search:${productName}:${vision?.barcode ?? 'no-barcode'}:v1`
  - TTL: 86,400 seconds (24 hours)
  - Check cache before pipeline, write cache on success

- [ ] **Shopping-first strategy** — `src/app/api/search/route.ts`
  - Attempt 0: run Serper.dev Shopping only, skip Brave
  - Check sufficiency after Shopping results
  - Add Brave to attempt 1+ if Shopping was insufficient

### Already done

- [x] Upfront query batch planning (Option 2) — `planSearchQueries` moved outside loop
- [x] `MAX_ATTEMPTS = 5` queries generated in one LLM call
- [x] Re-search cycle carries `oldQueries` to avoid repetition
- [x] Image format blocking (SVG, BMP, TIFF, HEIC) before Gemini

---

## 8. What NOT to change

- **Do not add ChatGPT or Claude API for search** — LLM-native web search tools return synthesised summaries, not per-source structured price lists. The entire `removeOutliers()`, confidence scoring, and min/max/avg pipeline depends on raw `PriceSource[]` data from independent retailers. LLM search is architecturally incompatible with this design.
- **Keep HF Featherless for query planning and sufficiency** — it is already cheap (~$0.50–4/month at target volumes) and the model (Qwen3.6-35B-A3B) performs well for JSON reasoning tasks.
- **Keep Gemini 2.5 Flash for vision** — it is the cheapest accurate vision model available and already integrated.
- **Keep the Option 2 upfront query planning** — generates all `MAX_ATTEMPTS` queries in one LLM call before the loop, reducing planning calls from O(N) to O(1) per search cycle.

---

## NOTES

Additional optimisations identified after the initial analysis. These are not required to reach the $20–30 budget but push costs lower and simplify the stack further.

---

### NOTE 1 — Use Serper.dev for organic search too, not just Shopping (significant)

The current plan uses Serper.dev for Shopping and Brave Search for organic web results. However, Serper.dev also has a standard web search endpoint (`https://google.serper.dev/search`) that returns Google organic results with snippets at the **same $0.001/call** rate — 5× cheaper than Brave ($0.005/call after the free tier).

**Recommendation: drop Brave entirely and use Serper.dev for all search.**

Benefits:
- One API key, one billing account, one integration to maintain
- Google's index has better e-commerce coverage than Brave's independent index for price-finding
- Cheaper per call on every organic search beyond the free tier

Cost comparison at 50 items/day with shopping-first strategy:

| Approach | Monthly search cost |
|---|---|
| Serper shopping + Brave organic | $2.25 + $6.00 = **$8.25** |
| Serper shopping + Serper organic | $2.25 + $1.20 = **$3.45** |

**Saving: ~$5/month. Stack simplifies from 3 search APIs to 1.**

**Revised final stack (simplest form):**

| Role | Service |
|---|---|
| Vision | Gemini 2.5 Flash |
| Reasoning | HF Featherless / Qwen3.6-35B |
| All search (shopping + organic) | **Serper.dev only** |
| Page extraction | Jina AI Reader |
| Price parsing | Gemini 2.5 Flash (text) |
| Result caching | Upstash Redis |

**Revised 50 items/day budget with all optimisations (Serper-only search + shopping-first + snippet-first + Redis):**

| Component | Monthly cost |
|---|---|
| Gemini 2.5 Flash (vision + extraction) | ~$5.35 |
| HF Featherless / Qwen3.6 | ~$2.50–4.00 |
| Serper.dev all-in (shopping + organic) | **$3.45** |
| Jina Reader (−30% from snippet-first, see NOTE 2) | **~$1.89** |
| Upstash Redis | $0 |
| **Total** | **~$13–15/month** ✅ |

This brings 50 items/day well inside budget with meaningful headroom.

---

### NOTE 2 — Snippet-first extraction before calling Jina (minor, meaningful)

Every Serper.dev (and Brave) search result already includes a content snippet — a 150–300 word excerpt from the page. For clean product pages, the snippet frequently contains the price:

> *"Makita DF454D — $149.99 — In Stock. Free shipping on orders over $35..."*

**Before fetching the full page via Jina, run a regex against the snippet:**

```ts
const pricePattern = /[\$£€¥AU]\s?\d+[\.,]\d{2}|\d+[\.,]\d{2}\s?(USD|AUD|EUR|GBP|SGD)/i

if (pricePattern.test(snippet)) {
  // extract price directly from snippet — skip Jina call entirely
} else {
  // fall back to Jina full-page fetch
}
```

If a price is found in the snippet → parse it and skip the Jina call for that URL.

- Saves **20–35% of Jina calls** at no accuracy cost
- Reduces Gemini extraction calls by the same proportion
- Zero added latency (snippet is already in memory from the search response)

File to update: wherever Jina extraction is wired up (replacement for `firecrawlExtractAll()` in `src/lib/firecrawl.ts`).

---

### NOTE 3 — Price regex pre-filter on Jina markdown (minor)

When Jina fetches a page and returns markdown, not every page will contain a product price — category listing pages, blog posts, login walls, and "out of stock" pages with no price shown all waste a Gemini extraction call.

**Before passing Jina markdown to Gemini, run the same regex:**

```ts
const markdown = await jinaFetch(url)
if (!pricePattern.test(markdown)) return null  // skip LLM extraction entirely
const price = await geminiExtract(markdown)
```

- Saves **~15–20% of Gemini extraction calls**
- Cost of the check: zero (pure string operation in Node.js)
- No risk: pages without a price return `null` anyway after Gemini processes them

File to update: inside the `jinaExtract(url)` function before the `callModel()` call.
