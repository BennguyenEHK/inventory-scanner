# Search Pipeline Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Tavily + SerpAPI + Firecrawl with Serper.dev + Jina AI Reader + ScreenshotOne, add a 4-layer extraction cascade that pulls expanded product fields (manufacturer, itemDescription, length, width, items_origin), and apply a vision-based verify gate after each URL extraction.

**Architecture:** Every searched URL goes through a cascade — L1 regex on the free Serper snippet, L2 regex on full Jina markdown (fetched only when L1 finds no price), L3 Qwen 3.6 gap-fill for still-unknown fields, L4 ScreenshotOne + Gemini Flash as last resort. After extraction, each source is checked against the vision result: manufacturer mismatch = soft flag, description total mismatch = hard discard. The route adopts a shopping-first strategy (Serper shopping on attempt 0, organic + extraction on attempt 1+) and wraps the entire pipeline in a 24-hour Redis cache.

**Tech Stack:** Serper.dev (shopping + organic), Jina AI Reader (`r.jina.ai`), ScreenshotOne, Qwen3.6-35B-A3B via HF Featherless (L3), Gemini 2.5 Flash (L4 vision), Upstash Redis (existing client), Next.js API routes, TypeScript.

---

## File Map

| Action | File | Purpose |
|---|---|---|
| Modify | `src/types/index.ts` | Expand `PriceSource` with new optional fields; add `SerperOrganicResult` |
| Create | `src/lib/serper.ts` | Serper.dev HTTP client — shopping + organic search |
| Rewrite | `src/lib/serpapi.ts` | Thin wrapper: delegates to `serper.ts` |
| Rewrite | `src/lib/tavily.ts` | Thin wrapper: delegates to `serper.ts`; stubs image search |
| Create | `src/lib/extract-regex.ts` | L1/L2 pure regex extraction — no HTTP, fully testable |
| Create | `src/lib/jina.ts` | Jina AI Reader HTTP client + L2 orchestration |
| Create | `src/lib/screenshot.ts` | ScreenshotOne client + Gemini L4 extraction |
| Rewrite | `src/lib/firecrawl.ts` | 4-layer cascade (L1→L2→L3→L4); keep `isScrapeable`, `isProductImage` |
| Create | `src/lib/verify-gate.ts` | Vision-based verify gate: soft flag / hard discard |
| Modify | `src/app/api/search/route.ts` | Redis cache + shopping-first strategy + verify gate wiring |
| Modify | `src/actions/report.ts` | Fill `Length`, `Width`, `Item_Origin` from new PriceSource fields |
| Modify | `.env` | Add `SERPER_API_KEY`, `JINA_API_KEY`, `SCREENSHOTONE_ACCESS_KEY` |

**Test files** (one per new/rewritten module):
- `src/lib/extract-regex.test.ts`
- `src/lib/serper.test.ts`
- `src/lib/jina.test.ts`
- `src/lib/verify-gate.test.ts`

> **Test runner:** check `package.json` `scripts.test` before running. Commands below use `npx jest` — substitute `npx vitest run` if the project uses Vitest.

---

## Task 1: Expand PriceSource and Add SerperOrganicResult

**Files:**
- Modify: `src/types/index.ts`

- [ ] **Step 1: Write the failing type-check test**

Create `src/lib/extract-regex.test.ts` with a type-shape assertion (this file grows across tasks):

```typescript
// src/lib/extract-regex.test.ts
import type { PriceSource } from '@/types'

test('PriceSource accepts optional extended fields', () => {
  const source: PriceSource = {
    name: 'Bunnings',
    url: 'https://bunnings.com.au/p/123',
    price: 49.99,
    currency: 'AUD',
    unit: 'each',
    in_stock: true,
    manufacturer: 'Makita',
    itemDescription: 'Cordless drill driver',
    length: '80 mm',
    width: '40 mm',
    items_origin: 'Japan',
    manufacturer_flagged: false,
  }
  expect(source.manufacturer).toBe('Makita')
  expect(source.items_origin).toBe('Japan')
})
```

- [ ] **Step 2: Run test to verify it fails**

```
npx jest src/lib/extract-regex.test.ts -t "PriceSource accepts"
```

Expected: TypeScript compile error — `manufacturer` does not exist on type `PriceSource`.

- [ ] **Step 3: Expand PriceSource in `src/types/index.ts`**

Find the existing `PriceSource` interface (line ~60) and add the new optional fields:

```typescript`
export interface PriceSource {
  name: string
  url: string
  price: number
  currency: string
  unit: string
  in_stock?: boolean
  // v2: expanded extraction fields
  manufacturer?: string
  itemDescription?: string
  length?: string
  width?: string
  items_origin?: string
  manufacturer_flagged?: boolean
}
```

Add `SerperOrganicResult` after `SerpApiResult` (keep `SerpApiResult` for any other callers):

```typescript
export interface SerperOrganicResult {
  url: string
  title: string
  snippet: string
}
```

- [ ] **Step 4: Run test to verify it passes**

```
npx jest src/lib/extract-regex.test.ts -t "PriceSource accepts"
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/types/index.ts src/lib/extract-regex.test.ts
git commit -m "feat: expand PriceSource with manufacturer/description/dimension/origin fields"
```

---

## Task 2: Regex Extraction Utilities (L1 / L2)

**Files:**
- Create: `src/lib/extract-regex.ts`
- Test: `src/lib/extract-regex.test.ts`

- [ ] **Step 1: Add failing tests to `src/lib/extract-regex.test.ts`**

Append to the file:

```typescript
import { extractFromText } from './extract-regex'

test('extracts USD price and currency', () => {
  const r = extractFromText('Makita DHP453 $149.99 free shipping')
  expect(r.price).toBe(149.99)
  expect(r.currency).toBe('USD')
})

test('extracts AUD price with symbol', () => {
  const r = extractFromText('Price: AU$89.50 each. In stock.')
  expect(r.price).toBe(89.50)
  expect(r.currency).toBe('AUD')
  expect(r.unit).toBe('each')
  expect(r.in_stock).toBe(true)
})

test('labeled price takes priority over bare price', () => {
  const r = extractFromText('Was $200. Unit price: $149.99. Shop now.')
  expect(r.price).toBe(149.99)
})

test('detects out of stock', () => {
  const r = extractFromText('Out of stock. $49.99 when available.')
  expect(r.in_stock).toBe(false)
})

test('extracts pack unit', () => {
  const r = extractFromText('$12.50 pack of 10 screws')
  expect(r.unit).toBe('pack of 10')
})

test('extracts manufacturer via "by" pattern', () => {
  const r = extractFromText('Heavy duty drill by Makita. Cordless.')
  expect(r.manufacturer).toMatch(/makita/i)
})

test('extracts manufacturer via "Brand:" pattern', () => {
  const r = extractFromText('Brand: Stanley. Length: 200mm.')
  expect(r.manufacturer).toMatch(/stanley/i)
})

test('extracts dimensions', () => {
  const r = extractFromText('Dimensions: 80mm x 40mm. Made in Japan.')
  expect(r.length).toBe('80 mm')
  expect(r.width).toBe('40 mm')
})

test('extracts country of origin', () => {
  const r = extractFromText('Made in Japan. High quality tool.')
  expect(r.items_origin).toBe('Japan')
})

test('returns all nulls when nothing found', () => {
  const r = extractFromText('Click here to contact us.')
  expect(r.price).toBeNull()
  expect(r.currency).toBeNull()
  expect(r.manufacturer).toBeNull()
})
```

- [ ] **Step 2: Run tests to verify they fail**

```
npx jest src/lib/extract-regex.test.ts
```

Expected: FAIL — `extractFromText` not found.

- [ ] **Step 3: Create `src/lib/extract-regex.ts`**

```typescript
export interface ExtractedFields {
  price: number | null
  currency: string | null
  unit: string | null
  in_stock: boolean | null
  manufacturer: string | null
  itemDescription: string | null
  length: string | null
  width: string | null
  items_origin: string | null
}

const SYMBOL_MAP: Array<[string, string]> = [
  ['AU$', 'AUD'], ['CA$', 'CAD'], ['NZ$', 'NZD'], ['SG$', 'SGD'], ['US$', 'USD'],
  ['$', 'USD'], ['€', 'EUR'], ['£', 'GBP'], ['¥', 'JPY'],
]
const CODE_RE = /\b(USD|AUD|EUR|GBP|SGD|CAD|NZD|JPY)\b/i

// /g flag — must reset lastIndex before each use
const PRICE_RE = /(?:AU\$|CA\$|NZ\$|SG\$|US\$|USD|AUD|EUR|GBP|SGD|CAD|NZD|[$€£¥])\s*[\d,.]{1,12}|[\d,.]{1,12}\s*(?:USD|AUD|EUR|GBP|SGD|CAD|NZD)/gi
const LABELED_PRICE_RE = /(?:unit\s+price|selling\s+price|our\s+price|list\s+price|price\s+each|msrp)\s*:?\s*(?:[A-Z]{2,3}\$?|[$€£¥])?\s*([\d,.]{1,12})/gi
const IN_STOCK_RE = /\b(in\s+stock|available(?!\s+soon)|ships?\s+(?:now|today)|ready\s+to\s+ship)\b/i
const OUT_OF_STOCK_RE = /\b(out\s+of\s+stock|unavailable|discontinued|sold\s+out)\b/i
const UNIT_RE = /\b(pack\s+of\s+\d+|box\s+of\s+\d+|set\s+of\s+\d+|roll|each|per\s+unit|single)\b/i
const MANUFACTURER_RE = /\b(?:by|brand|manufacturer|made\s+by|manufactured\s+by)\s*:?\s*([A-Z][a-zA-Z0-9&\s\-]{1,35}?)(?=\s*[-,.|(\n]|$)/m
const DIMENSION_RE = /(\d+(?:\.\d+)?)\s*(mm|cm|m|in|")\s*[x×]\s*(\d+(?:\.\d+)?)\s*(mm|cm|m|in|")?/i
const ORIGIN_RE = /(?:made\s+in|country\s+of\s+origin\s*:?\s*|manufactured\s+in)\s*([A-Z][a-zA-Z\s]{2,24}?)(?=\s*[-.,\n]|$)/mi

function parseNumeric(token: string): number {
  const t = token.trim()
  if (/,\d{2}$/.test(t)) return parseFloat(t.replace(/\./g, '').replace(',', '.'))
  return parseFloat(t.replace(/,/g, ''))
}

function parsePriceRaw(raw: string): { price: number; currency: string } | null {
  const upper = raw.toUpperCase()
  // Multi-char symbols first (AU$, CA$, …)
  for (const [sym, cur] of SYMBOL_MAP) {
    const idx = upper.indexOf(sym.toUpperCase())
    if (idx === -1) continue
    const numPart = raw.slice(0, idx) + raw.slice(idx + sym.length)
    const price = parseNumeric(numPart.trim())
    if (isFinite(price) && price > 0) return { price, currency: cur }
  }
  // ISO code
  const codeMatch = raw.match(CODE_RE)
  if (codeMatch) {
    const numPart = raw.replace(codeMatch[0], '').trim()
    const price = parseNumeric(numPart)
    if (isFinite(price) && price > 0) return { price, currency: codeMatch[0].toUpperCase() }
  }
  return null
}

export function extractFromText(text: string): ExtractedFields {
  const result: ExtractedFields = {
    price: null, currency: null, unit: null, in_stock: null,
    manufacturer: null, itemDescription: null, length: null, width: null, items_origin: null,
  }

  // --- Price: labeled patterns take priority ---
  const labeledCandidates: Array<{ price: number; currency: string }> = []
  LABELED_PRICE_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = LABELED_PRICE_RE.exec(text)) !== null) {
    const price = parseNumeric(m[1])
    if (!isFinite(price) || price <= 0) continue
    const nearby = text.slice(Math.max(0, m.index - 15), m.index + m[0].length + 15)
    const sym = SYMBOL_MAP.find(([s]) => nearby.toUpperCase().includes(s.toUpperCase()))
    const code = nearby.match(CODE_RE)
    const currency = code ? code[0].toUpperCase() : (sym ? sym[1] : 'USD')
    labeledCandidates.push({ price, currency })
  }

  if (labeledCandidates.length > 0) {
    result.price = labeledCandidates[0].price
    result.currency = labeledCandidates[0].currency
  } else {
    PRICE_RE.lastIndex = 0
    while ((m = PRICE_RE.exec(text)) !== null) {
      const parsed = parsePriceRaw(m[0])
      if (parsed) { result.price = parsed.price; result.currency = parsed.currency; break }
    }
  }

  // --- Stock ---
  if (OUT_OF_STOCK_RE.test(text)) result.in_stock = false
  else if (IN_STOCK_RE.test(text)) result.in_stock = true

  // --- Unit ---
  const unitMatch = text.match(UNIT_RE)
  if (unitMatch) result.unit = unitMatch[1].toLowerCase().replace(/\s+/g, ' ').trim()

  // --- Manufacturer ---
  const mfgMatch = text.match(MANUFACTURER_RE)
  if (mfgMatch?.[1]?.trim()) result.manufacturer = mfgMatch[1].trim()

  // --- Dimensions ---
  const dimMatch = text.match(DIMENSION_RE)
  if (dimMatch) {
    const u1 = dimMatch[2]
    const u2 = dimMatch[4] ?? u1
    result.length = `${dimMatch[1]} ${u1}`
    result.width = `${dimMatch[3]} ${u2}`
  }

  // --- Country of origin ---
  const originMatch = text.match(ORIGIN_RE)
  if (originMatch?.[1]?.trim()) result.items_origin = originMatch[1].trim()

  return result
}

/** Merge two ExtractedFields: prefer non-null values from `overlay`. */
export function mergeFields(base: ExtractedFields, overlay: ExtractedFields): ExtractedFields {
  return {
    price:           overlay.price           ?? base.price,
    currency:        overlay.currency        ?? base.currency,
    unit:            overlay.unit            ?? base.unit,
    in_stock:        overlay.in_stock        ?? base.in_stock,
    manufacturer:    overlay.manufacturer    ?? base.manufacturer,
    itemDescription: overlay.itemDescription ?? base.itemDescription,
    length:          overlay.length          ?? base.length,
    width:           overlay.width           ?? base.width,
    items_origin:    overlay.items_origin    ?? base.items_origin,
  }
}

/** List field names that are still null in the given result. */
export function missingFieldNames(fields: ExtractedFields): Array<keyof ExtractedFields> {
  return (Object.keys(fields) as Array<keyof ExtractedFields>).filter(k => fields[k] === null)
}
```

- [ ] **Step 4: Run tests**

```
npx jest src/lib/extract-regex.test.ts
```

Expected: all pass. If a dimension or manufacturer test is flaky, adjust the regex boundary conditions — do NOT skip the test.

- [ ] **Step 5: Commit**

```bash
git add src/lib/extract-regex.ts src/lib/extract-regex.test.ts
git commit -m "feat: add L1/L2 regex extraction utilities for all PriceSource fields"
```

---

## Task 3: Serper.dev Client

**Files:**
- Create: `src/lib/serper.ts`
- Create: `src/lib/serper.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/lib/serper.test.ts
import { parseShoppingItem, parseOrganicItem } from './serper'

test('parseShoppingItem extracts USD price from dollar string', () => {
  const r = parseShoppingItem({ title: 'Makita Drill', link: 'https://amazon.com/dp/B001', source: 'Amazon', price: '$149.99' })
  expect(r).not.toBeNull()
  expect(r!.price).toBe(149.99)
  expect(r!.currency).toBe('USD')
  expect(r!.name).toBe('Amazon')
  expect(r!.url).toBe('https://amazon.com/dp/B001')
})

test('parseShoppingItem extracts AUD price', () => {
  const r = parseShoppingItem({ title: 'Makita Drill', link: 'https://bunnings.com.au/p/1', source: 'Bunnings', price: 'AU$89.50' })
  expect(r!.price).toBe(89.50)
  expect(r!.currency).toBe('AUD')
})

test('parseShoppingItem returns null for missing price', () => {
  const r = parseShoppingItem({ title: 'Makita Drill', link: 'https://amazon.com/dp/B001', source: 'Amazon', price: '' })
  expect(r).toBeNull()
})

test('parseOrganicItem maps Serper organic result', () => {
  const r = parseOrganicItem({ title: 'Makita DF454', link: 'https://example.com/product', snippet: 'Great drill for $99' })
  expect(r.url).toBe('https://example.com/product')
  expect(r.title).toBe('Makita DF454')
  expect(r.snippet).toBe('Great drill for $99')
})
```

- [ ] **Step 2: Run tests — expect FAIL**

```
npx jest src/lib/serper.test.ts
```

Expected: FAIL — `parseShoppingItem` not found.

- [ ] **Step 3: Create `src/lib/serper.ts`**

```typescript
import type { PriceSource, SerperOrganicResult } from '@/types'

// --- Internal response shapes ---
interface SerperShoppingItem {
  title: string
  link: string
  source: string
  price?: string       // e.g. "$149.99", "AU$89.50"
  imageUrl?: string
}

interface SerperOrganicItem {
  title: string
  link: string
  snippet?: string
}

// --- Price string parser ---
const SYMBOL_MAP: Array<[string, string]> = [
  ['AU$', 'AUD'], ['CA$', 'CAD'], ['NZ$', 'NZD'], ['SG$', 'SGD'], ['US$', 'USD'],
  ['$', 'USD'], ['€', 'EUR'], ['£', 'GBP'], ['¥', 'JPY'],
]

function parseShoppingPrice(raw: string): { price: number; currency: string } | null {
  if (!raw?.trim()) return null
  const upper = raw.toUpperCase()
  for (const [sym, cur] of SYMBOL_MAP) {
    if (!upper.includes(sym.toUpperCase())) continue
    const numStr = raw.replace(new RegExp(sym.replace('$', '\\$'), 'gi'), '').replace(/,/g, '').trim()
    const price = parseFloat(numStr)
    if (isFinite(price) && price > 0) return { price, currency: cur }
  }
  // ISO code prefix: "USD 149.99"
  const codeMatch = raw.match(/^(USD|AUD|EUR|GBP|SGD|CAD|NZD)\s*([\d,.]+)/i)
  if (codeMatch) {
    const price = parseFloat(codeMatch[2].replace(/,/g, ''))
    if (isFinite(price) && price > 0) return { price, currency: codeMatch[1].toUpperCase() }
  }
  return null
}

// --- Exported pure helpers (for unit testing without HTTP) ---

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
  }
}

export function parseOrganicItem(item: SerperOrganicItem): SerperOrganicResult {
  return {
    url: item.link,
    title: item.title,
    snippet: item.snippet ?? '',
  }
}

// --- HTTP helpers ---

function getKey(): string {
  const key = process.env.SERPER_API_KEY
  if (!key) throw new Error('SERPER_API_KEY is not set')
  return key
}

async function serperPost<T>(endpoint: string, body: object): Promise<T> {
  const res = await fetch(`https://google.serper.dev${endpoint}`, {
    method: 'POST',
    headers: { 'X-API-KEY': getKey(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`Serper ${endpoint} failed: ${res.status} ${res.statusText}`)
  return res.json() as Promise<T>
}

// --- Public API ---

export async function serperShoppingSearch(query: string): Promise<PriceSource[]> {
  if (!query.trim()) return []
  const data = await serperPost<{ shopping?: SerperShoppingItem[] }>('/shopping', { q: query.trim(), num: 10 })
  return (data.shopping ?? []).map(parseShoppingItem).filter((s): s is PriceSource => s !== null)
}

export async function serperOrganicSearch(query: string): Promise<SerperOrganicResult[]> {
  if (!query.trim()) return []
  const data = await serperPost<{ organic?: SerperOrganicItem[] }>('/search', { q: query.trim(), num: 10 })
  return (data.organic ?? []).map(parseOrganicItem)
}
```

- [ ] **Step 4: Run tests**

```
npx jest src/lib/serper.test.ts
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/serper.ts src/lib/serper.test.ts
git commit -m "feat: add Serper.dev client for shopping and organic search"
```

---

## Task 4: Rewrite serpapi.ts and tavily.ts as Thin Wrappers

**Files:**
- Rewrite: `src/lib/serpapi.ts`
- Rewrite: `src/lib/tavily.ts`

No new tests needed — these are pure delegation wrappers. The callers in `route.ts` are unchanged.

- [ ] **Step 1: Rewrite `src/lib/serpapi.ts`**

```typescript
// Delegates to Serper.dev — interface unchanged for existing callers.
import type { PriceSource, SerpApiResult } from '@/types'
import { serperShoppingSearch, serperOrganicSearch } from './serper'

export async function serpApiShoppingSearch(query: string): Promise<PriceSource[]> {
  return serperShoppingSearch(query)
}

// Kept for any caller expecting SerpApiResult shape (organic results).
export async function serpApiSearch(query: string): Promise<SerpApiResult[]> {
  const results = await serperOrganicSearch(query)
  return results.map(r => ({
    url: r.url,
    title: r.title,
    content: r.snippet,
  }))
}
```

- [ ] **Step 2: Rewrite `src/lib/tavily.ts`**

```typescript
// Delegates to Serper.dev organic search — interface unchanged for route.ts.
import { serperOrganicSearch } from './serper'

export interface TavilyResult {
  url: string
  title: string
  content: string
  score: number
}

export interface TavilyImageResult {
  url: string
  description?: string
}

export async function tavilySearch(query: string): Promise<TavilyResult[]> {
  const results = await serperOrganicSearch(query)
  // score=1 placeholder — route.ts uses url/content, not score
  return results.map(r => ({ url: r.url, title: r.title, content: r.snippet, score: 1 }))
}

// Serper.dev has no dedicated image search — return empty to avoid breaking callers.
export async function tavilyImageSearch(): Promise<TavilyImageResult[]> {
  return []
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/serpapi.ts src/lib/tavily.ts
git commit -m "refactor: delegate serpapi + tavily to Serper.dev (drop SerpAPI + Tavily APIs)"
```

---

## Task 5: Jina AI Reader Client

**Files:**
- Create: `src/lib/jina.ts`
- Test: `src/lib/jina.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/lib/jina.test.ts
import { extractJsonLdFromMarkdown, extractFromJsonLd } from './jina'

test('extractJsonLdFromMarkdown finds fenced JSON block', () => {
  const md = `Some text\n\`\`\`json\n{"@type":"Product","name":"Makita Drill","brand":{"@type":"Brand","name":"Makita"},"offers":{"price":"149.99","priceCurrency":"AUD"}}\n\`\`\`\nMore text`
  const blocks = extractJsonLdFromMarkdown(md)
  expect(blocks.length).toBeGreaterThan(0)
  expect(blocks[0]['@type']).toBe('Product')
})

test('extractJsonLdFromMarkdown skips malformed JSON', () => {
  const md = '```json\n{not valid}\n```'
  expect(extractJsonLdFromMarkdown(md)).toHaveLength(0)
})

test('extractFromJsonLd pulls price from Product offer', () => {
  const block = {
    '@type': 'Product',
    name: 'Makita Drill',
    brand: { '@type': 'Brand', name: 'Makita' },
    description: 'Cordless drill driver 18V',
    offers: { '@type': 'Offer', price: '149.99', priceCurrency: 'AUD' },
  }
  const fields = extractFromJsonLd([block])
  expect(fields.price).toBe(149.99)
  expect(fields.currency).toBe('AUD')
  expect(fields.manufacturer).toBe('Makita')
  expect(fields.itemDescription).toMatch(/drill/i)
})

test('extractFromJsonLd returns nulls when no product data', () => {
  const fields = extractFromJsonLd([{ '@type': 'WebSite', name: 'Bunnings' }])
  expect(fields.price).toBeNull()
})
```

- [ ] **Step 2: Run — expect FAIL**

```
npx jest src/lib/jina.test.ts
```

- [ ] **Step 3: Create `src/lib/jina.ts`**

```typescript
import { extractFromText, mergeFields, type ExtractedFields } from './extract-regex'

const JINA_TIMEOUT_MS = 15_000
const JINA_MAX_CHARS = 12_000   // cap sent to L3; full markdown still used for L2 regex

// --- JSON-LD extraction from Jina markdown ---

// Jina sometimes preserves <script type="application/ld+json"> blocks as fenced code.
const JSONLD_BLOCK_RE = /```json\s*([\s\S]*?)```|<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi

export function extractJsonLdFromMarkdown(markdown: string): Record<string, unknown>[] {
  const results: Record<string, unknown>[] = []
  JSONLD_BLOCK_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = JSONLD_BLOCK_RE.exec(markdown)) !== null) {
    const content = (m[1] ?? m[2] ?? '').trim()
    if (!content) continue
    try {
      const parsed = JSON.parse(content)
      if (typeof parsed === 'object' && parsed !== null) results.push(parsed as Record<string, unknown>)
    } catch { /* skip malformed */ }
  }
  return results
}

function normStr(v: unknown): string | null {
  if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 300)
  return null
}

function normPrice(v: unknown): number | null {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
  return isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null
}

function normCurrency(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const upper = v.trim().toUpperCase()
  return /^[A-Z]{3}$/.test(upper) ? upper : null
}

export function extractFromJsonLd(blocks: Record<string, unknown>[]): Partial<ExtractedFields> {
  const out: Partial<ExtractedFields> = {}

  for (const block of blocks) {
    const type = String(block['@type'] ?? '').toLowerCase()
    if (!type.includes('product')) continue

    if (!out.itemDescription) out.itemDescription = normStr(block['description'])
    if (!out.itemDescription) out.itemDescription = normStr(block['name'])

    // brand.name → manufacturer
    const brand = block['brand'] as Record<string, unknown> | undefined
    if (!out.manufacturer && brand) out.manufacturer = normStr(brand['name'])

    // offers → price + currency
    const offers = block['offers'] as Record<string, unknown> | undefined
    if (offers && !out.price) {
      out.price = normPrice(offers['price'])
      out.currency = normCurrency(offers['priceCurrency'])
    }

    // depth / width / height as dimensions
    if (!out.length && block['depth']) {
      const d = block['depth'] as Record<string, unknown>
      out.length = d ? `${d['value']} ${d['unitCode'] ?? 'mm'}` : null
    }
    if (!out.width && block['width']) {
      const w = block['width'] as Record<string, unknown>
      out.width = w ? `${w['value']} ${w['unitCode'] ?? 'mm'}` : null
    }

    if (!out.items_origin) out.items_origin = normStr(block['countryOfOrigin'])
  }

  return out
}

// --- HTTP client ---

export async function jinaFetch(url: string): Promise<string | null> {
  const apiKey = process.env.JINA_API_KEY
  if (!apiKey) throw new Error('JINA_API_KEY is not set')

  // Apply NOTE 3: regex pre-filter will happen in firecrawl.ts before calling Gemini
  try {
    const res = await fetch(`https://r.jina.ai/${encodeURIComponent(url)}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'text/markdown',
        'X-Return-Format': 'markdown',
      },
      signal: AbortSignal.timeout(JINA_TIMEOUT_MS),
    })
    if (!res.ok) return null
    return res.text()
  } catch {
    return null
  }
}

// --- L2 extraction: regex + JSON-LD on Jina markdown ---

export async function jinaExtract(
  url: string,
  snippet: string,
): Promise<{ fields: ExtractedFields; markdown: string | null }> {
  // L1 result on snippet is already done by caller; we get the raw snippet for merging context
  const markdown = await jinaFetch(url)
  if (!markdown) return { fields: extractFromText(snippet), markdown: null }

  // Run regex on full markdown text
  const regexFields = extractFromText(markdown)

  // Attempt JSON-LD bonus pass
  const jsonLdFields = extractFromJsonLd(extractJsonLdFromMarkdown(markdown))
  const mergedJsonLd: ExtractedFields = {
    price:           jsonLdFields.price           ?? null,
    currency:        jsonLdFields.currency        ?? null,
    unit:            null,
    in_stock:        null,
    manufacturer:    jsonLdFields.manufacturer    ?? null,
    itemDescription: jsonLdFields.itemDescription ?? null,
    length:          jsonLdFields.length          ?? null,
    width:           jsonLdFields.width           ?? null,
    items_origin:    jsonLdFields.items_origin    ?? null,
  }

  // JSON-LD wins for structured fields; regex wins for in_stock/unit (not in JSON-LD)
  return { fields: mergeFields(regexFields, mergedJsonLd), markdown }
}

export { JINA_MAX_CHARS }
```

- [ ] **Step 4: Run tests**

```
npx jest src/lib/jina.test.ts
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/jina.ts src/lib/jina.test.ts
git commit -m "feat: add Jina AI Reader client with L2 regex + JSON-LD extraction"
```

---

## Task 6: ScreenshotOne + Gemini L4 Client

**Files:**
- Create: `src/lib/screenshot.ts`

No unit tests for this file — it wraps two paid external APIs. Integration will be verified in Task 9.

- [ ] **Step 1: Read `src/lib/gemini-images.ts`**

Before writing, scan the file to find: how `GEMINI_API_KEY` is accessed, which SDK import is used, and the pattern for sending an image. Match the new function to those patterns exactly.

- [ ] **Step 2: Create `src/lib/screenshot.ts`**

```typescript
import { GoogleGenerativeAI } from '@google/generative-ai'
import type { ExtractedFields } from './extract-regex'

const SCREENSHOT_TIMEOUT_MS = 25_000
const VISION_TIMEOUT_MS = 20_000

// --- ScreenshotOne ---

export async function fetchPageScreenshot(pageUrl: string): Promise<string | null> {
  const accessKey = process.env.SCREENSHOTONE_ACCESS_KEY
  if (!accessKey) return null

  const params = new URLSearchParams({
    access_key: accessKey,
    url: pageUrl,
    full_page: 'true',
    format: 'jpg',
    response_type: 'by_format',
    image_quality: '80',
    block_ads: 'true',
    block_cookie_banners: 'true',
    block_trackers: 'true',
    timeout: '20',
  })

  try {
    const res = await fetch(`https://api.screenshotone.com/take?${params}`, {
      signal: AbortSignal.timeout(SCREENSHOT_TIMEOUT_MS),
    })
    if (!res.ok) return null
    const mime = res.headers.get('content-type')?.split(';')[0]?.trim() ?? 'image/jpeg'
    if (!mime.startsWith('image/')) return null
    const buf = Buffer.from(await res.arrayBuffer())
    return `data:${mime};base64,${buf.toString('base64')}`
  } catch {
    return null
  }
}

// --- Gemini L4 extraction ---

const L4_SYSTEM_PROMPT = `You are a product data extractor reading a webpage screenshot.
Extract ONLY the fields listed. Return a single valid JSON object.
Use null for fields not clearly visible. No explanation — JSON only.`

function buildL4UserPrompt(missingFields: string[]): string {
  const defs: Record<string, string> = {
    price: 'numeric selling price (e.g. 149.99)',
    currency: 'ISO 4217 code (USD, AUD, EUR, GBP, SGD)',
    unit: 'unit of sale (each, roll, pack of N, box of N)',
    manufacturer: 'brand or manufacturer name',
    itemDescription: 'one sentence describing what the product is',
    length: 'length with unit (e.g. "80 mm")',
    width: 'width with unit (e.g. "40 mm")',
    items_origin: 'country of manufacture (e.g. "Japan")',
  }
  const fieldLines = missingFields.map(f => `- ${f}: ${defs[f] ?? 'extract if visible'}`).join('\n')
  return `Extract these fields from the screenshot:\n${fieldLines}\n\nReturn JSON only.`
}

function parseGeminiResponse(raw: string): Partial<ExtractedFields> {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '')
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return {}
  try {
    const obj = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>
    const result: Partial<ExtractedFields> = {}
    const numericFields = ['price'] as const
    const stringFields = ['currency', 'unit', 'manufacturer', 'itemDescription', 'length', 'width', 'items_origin'] as const
    for (const k of numericFields) {
      const v = obj[k]
      if (typeof v === 'number' && isFinite(v) && v > 0) result[k] = v
    }
    for (const k of stringFields) {
      const v = obj[k]
      if (typeof v === 'string' && v.trim()) result[k] = v.trim()
    }
    return result
  } catch {
    return {}
  }
}

export async function geminiExtractFromScreenshot(
  imageDataUrl: string,
  missingFields: string[],
): Promise<Partial<ExtractedFields>> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey || missingFields.length === 0) return {}

  const genAI = new GoogleGenerativeAI(apiKey)
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-latest' })

  // base64 data URL → inline data part
  const match = imageDataUrl.match(/^data:(image\/[a-z]+);base64,(.+)$/)
  if (!match) return {}
  const mimeType = match[1] as 'image/jpeg'
  const base64Data = match[2]

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), VISION_TIMEOUT_MS)

    const result = await model.generateContent([
      { text: `${L4_SYSTEM_PROMPT}\n\n${buildL4UserPrompt(missingFields)}` },
      { inlineData: { data: base64Data, mimeType } },
    ])

    clearTimeout(timer)
    const raw = result.response.text()
    return parseGeminiResponse(raw)
  } catch {
    return {}
  }
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```
npx tsc --noEmit
```

Expected: no errors. If `GoogleGenerativeAI` import fails, check the SDK version in `package.json` — it should match `@google/generative-ai` usage already in `src/lib/gemini-images.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/screenshot.ts
git commit -m "feat: add ScreenshotOne client and Gemini L4 screenshot extraction"
```

---

## Task 7: Verify Gate

**Files:**
- Create: `src/lib/verify-gate.ts`
- Create: `src/lib/verify-gate.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/lib/verify-gate.test.ts
import { applyVerifyGate, ManufacturerFlag } from './verify-gate'
import type { PriceSource, VisionResult } from '@/types'

function makeSource(overrides: Partial<PriceSource> = {}): PriceSource {
  return {
    name: 'Bunnings', url: 'https://bunnings.com.au/p/1',
    price: 49.99, currency: 'AUD', unit: 'each',
    manufacturer: 'Makita', itemDescription: 'cordless power drill',
    ...overrides,
  }
}

function makeVision(overrides: Partial<VisionResult> = {}): VisionResult {
  return {
    visible_text: [], brand: 'Makita', model_number: null,
    product_category: 'power drill', dimensions_visible: null, barcode: null,
    color: 'teal', shape: 'rectangular', material_hints: 'plastic',
    label_language: 'en', condition: 'new', packaging_type: 'box',
    visual_description: 'cordless drill', confidence: 0.9, missing_fields: [],
    image_quality: 'clear',
    ...overrides,
  }
}

test('passes when manufacturer matches vision brand', () => {
  const r = applyVerifyGate(makeSource({ manufacturer: 'Makita' }), makeVision({ brand: 'Makita' }))
  expect(r.discard).toBe(false)
  expect(r.manufacturerFlag).toBe(ManufacturerFlag.None)
})

test('soft-flags manufacturer mismatch — does NOT discard', () => {
  const r = applyVerifyGate(makeSource({ manufacturer: 'Bosch' }), makeVision({ brand: 'Makita' }))
  expect(r.discard).toBe(false)
  expect(r.manufacturerFlag).toBe(ManufacturerFlag.Mismatch)
})

test('hard-discards when description has zero word overlap with vision category', () => {
  const r = applyVerifyGate(
    makeSource({ itemDescription: 'garden hose nozzle spray attachment' }),
    makeVision({ product_category: 'cordless power drill' }),
  )
  expect(r.discard).toBe(true)
})

test('does NOT discard when description partially matches category', () => {
  const r = applyVerifyGate(
    makeSource({ itemDescription: 'compact drill driver kit with battery' }),
    makeVision({ product_category: 'power drill' }),
  )
  expect(r.discard).toBe(false)
})

test('passes when source has no manufacturer (field not extracted)', () => {
  const r = applyVerifyGate(makeSource({ manufacturer: undefined }), makeVision({ brand: 'Makita' }))
  expect(r.manufacturerFlag).toBe(ManufacturerFlag.None)
})

test('passes when source has no itemDescription (field not extracted)', () => {
  const r = applyVerifyGate(makeSource({ itemDescription: undefined }), makeVision())
  expect(r.discard).toBe(false)
})
```

- [ ] **Step 2: Run — expect FAIL**

```
npx jest src/lib/verify-gate.test.ts
```

- [ ] **Step 3: Create `src/lib/verify-gate.ts`**

```typescript
import type { PriceSource, VisionResult } from '@/types'

export enum ManufacturerFlag {
  None = 'none',
  Mismatch = 'mismatch',
}

export interface VerifyResult {
  discard: boolean
  manufacturerFlag: ManufacturerFlag
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function significantWords(s: string): string[] {
  return s.toLowerCase().split(/\s+/).filter(w => w.length > 3)
}

export function applyVerifyGate(source: PriceSource, vision: VisionResult): VerifyResult {
  const result: VerifyResult = { discard: false, manufacturerFlag: ManufacturerFlag.None }

  // Manufacturer — soft flag only
  if (source.manufacturer && vision.brand) {
    const a = normalize(source.manufacturer)
    const b = normalize(vision.brand)
    if (a && b && !a.includes(b) && !b.includes(a)) {
      result.manufacturerFlag = ManufacturerFlag.Mismatch
    }
  }

  // Description — hard discard only when zero meaningful-word overlap
  if (source.itemDescription && vision.product_category) {
    const descWords = new Set(significantWords(source.itemDescription))
    const catWords = significantWords(vision.product_category)
    if (catWords.length > 0 && catWords.every(w => !descWords.has(w))) {
      result.discard = true
    }
  }

  return result
}
```

- [ ] **Step 4: Run tests**

```
npx jest src/lib/verify-gate.test.ts
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/verify-gate.ts src/lib/verify-gate.test.ts
git commit -m "feat: add verify gate — soft flag manufacturer mismatch, hard discard description mismatch"
```

---

## Task 8: 4-Layer Cascade (Rewrite firecrawl.ts core)

**Files:**
- Rewrite: `src/lib/firecrawl.ts` (keep `isScrapeable`, `isProductImage`, `firecrawlExtractImages`)
- Test: `src/lib/firecrawl.test.ts` (add cascade tests)

- [ ] **Step 1: Read `src/lib/firecrawl.test.ts`**

Check what existing tests cover before adding new ones — don't duplicate or break them.

- [ ] **Step 2: Add cascade tests to `src/lib/firecrawl.test.ts`**

```typescript
import { buildPriceSourceFromFields } from './firecrawl'
import type { ExtractedFields } from './extract-regex'

test('buildPriceSourceFromFields maps ExtractedFields to PriceSource', () => {
  const fields: ExtractedFields = {
    price: 49.99, currency: 'AUD', unit: 'each', in_stock: true,
    manufacturer: 'Makita', itemDescription: 'Cordless drill',
    length: '80 mm', width: '40 mm', items_origin: 'Japan',
  }
  const source = buildPriceSourceFromFields(
    fields, 'Bunnings', 'https://bunnings.com.au/p/1', false,
  )
  expect(source).not.toBeNull()
  expect(source!.price).toBe(49.99)
  expect(source!.manufacturer).toBe('Makita')
  expect(source!.items_origin).toBe('Japan')
  expect(source!.manufacturer_flagged).toBe(false)
})

test('buildPriceSourceFromFields returns null when price is missing', () => {
  const fields: ExtractedFields = {
    price: null, currency: 'AUD', unit: 'each', in_stock: null,
    manufacturer: null, itemDescription: null, length: null, width: null, items_origin: null,
  }
  expect(buildPriceSourceFromFields(fields, 'Test', 'https://test.com', false)).toBeNull()
})
```

- [ ] **Step 3: Run — expect FAIL**

```
npx jest src/lib/firecrawl.test.ts -t "buildPriceSourceFromFields"
```

- [ ] **Step 4: Rewrite `src/lib/firecrawl.ts`**

Replace the entire file. Keep `isScrapeable`, `isProductImage`, `firecrawlExtractImages` exactly as they are — only replace the extraction core.

```typescript
import { callModel, extractJson } from '@/lib/inference'
import { extractFromText, mergeFields, missingFieldNames, type ExtractedFields } from './extract-regex'
import { jinaExtract, JINA_MAX_CHARS } from './jina'
import { fetchPageScreenshot, geminiExtractFromScreenshot } from './screenshot'
import { applyVerifyGate, ManufacturerFlag } from './verify-gate'
import type { PriceSource, VisionResult } from '@/types'

// ---- isScrapeable and isProductImage remain UNCHANGED ----
// (paste the existing implementations here without modification)

const BLOCKED_DOMAINS = [
  'youtube.com', 'youtu.be',
  'linkedin.com', 'facebook.com', 'instagram.com', 'twitter.com', 'x.com',
  'pinterest.com', 'zillow.com', 'pitchbook.com', 'crunchbase.com',
]
const BLOCKED_EXTENSIONS = ['.pdf', '.doc', '.docx', '.xls', '.xlsx']

export function isScrapeable(url: string): boolean {
  try {
    const { hostname, pathname } = new URL(url)
    const path = pathname.toLowerCase()
    return (
      !BLOCKED_DOMAINS.some(d => hostname.includes(d)) &&
      !BLOCKED_EXTENSIONS.some(ext => path.endsWith(ext))
    )
  } catch {
    return false
  }
}

const IMAGE_JUNK = /logo|icon|banner|sprite|avatar|thumbnail|header|placeholder|bg[-_]|background|favicon|pixel|tracking|beacon/i
const IMAGE_EXT  = /\.(jpg|jpeg|png|webp|gif|avif)(\?|\/|$)/i
const BLOCKED_IMAGE_EXT = /\.(svg|bmp|tiff?|heic|heif|ico|cur|jp2|j2k|jpx|jpm)(\?|\/|$)/i

export function isProductImage(url: string): boolean {
  try {
    const { hostname, pathname, href } = new URL(url)
    if (IMAGE_JUNK.test(pathname)) return false
    if (BLOCKED_IMAGE_EXT.test(href)) return false
    if (IMAGE_EXT.test(href)) return true
    const imageCdnPatterns = /cdn|img|image|media|static|assets|photo|picture|product/i
    if (imageCdnPatterns.test(hostname)) return true
    return false
  } catch {
    return false
  }
}

// firecrawlExtractImages kept for image-pipeline.ts compatibility
export async function firecrawlExtractImages(): Promise<string[]> {
  return []   // Firecrawl removed — image pipeline uses vision stage instead
}

// ---- New extraction core ----

const PRICE_RE_QUICK = /(?:AU\$|CA\$|\$|€|£|USD|AUD|EUR|GBP)\s*[\d,.]{1,10}|[\d,.]{1,10}\s*(?:USD|AUD|EUR|GBP)/i

const L3_SYSTEM_PROMPT = `You are a product data extractor. Given product page content, extract ONLY the listed fields. Output a single valid JSON object. Use null for fields not present. No explanation — JSON only.`

function buildL3UserMessage(missingFields: string[], url: string, markdown: string): string {
  const defs: Record<string, string> = {
    price: 'numeric selling price (e.g. 149.99)',
    currency: 'ISO 4217 code (USD, AUD, EUR, GBP, SGD, CAD, NZD)',
    unit: 'unit of sale (each, roll, pack of N, box of N)',
    manufacturer: 'brand or manufacturer name',
    itemDescription: 'one sentence describing what the product is',
    length: 'length with unit (e.g. "80 mm")',
    width: 'width with unit (e.g. "40 mm")',
    items_origin: 'country of manufacture (e.g. "Japan")',
  }
  const fieldLines = missingFields.map(f => `- ${f}: ${defs[f] ?? f}`).join('\n')
  const content = markdown.slice(0, JINA_MAX_CHARS)
  return `Extract these fields:\n${fieldLines}\n\nURL: ${url}\n\nContent:\n${content}\n\nJSON only:`
}

async function qwenGapFill(
  missingFields: string[],
  url: string,
  markdown: string,
): Promise<Partial<ExtractedFields>> {
  if (missingFields.length === 0) return {}
  try {
    const raw = await callModel({
      model: 'Qwen/Qwen3.6-35B-A3B:featherless-ai',
      enable_thinking: false,
      temperature: 0.1,
      max_tokens: 512,
      messages: [
        { role: 'system', content: L3_SYSTEM_PROMPT },
        { role: 'user', content: buildL3UserMessage(missingFields, url, markdown) },
      ],
    })
    const parsed = extractJson<Partial<ExtractedFields>>(raw)
    return parsed ?? {}
  } catch {
    return {}
  }
}

function applyPartial(base: ExtractedFields, patch: Partial<ExtractedFields>): ExtractedFields {
  return mergeFields(base, {
    price:           patch.price           ?? null,
    currency:        patch.currency        ?? null,
    unit:            patch.unit            ?? null,
    in_stock:        patch.in_stock        ?? null,
    manufacturer:    patch.manufacturer    ?? null,
    itemDescription: patch.itemDescription ?? null,
    length:          patch.length          ?? null,
    width:           patch.width           ?? null,
    items_origin:    patch.items_origin    ?? null,
  })
}

/** Map final ExtractedFields + metadata to PriceSource. Returns null if no price. */
export function buildPriceSourceFromFields(
  fields: ExtractedFields,
  sourceName: string,
  url: string,
  manufacturerFlagged: boolean,
): PriceSource | null {
  if (!fields.price || !fields.currency) return null
  return {
    name:                sourceName,
    url,
    price:               fields.price,
    currency:            fields.currency,
    unit:                fields.unit ?? 'each',
    in_stock:            fields.in_stock ?? undefined,
    manufacturer:        fields.manufacturer ?? undefined,
    itemDescription:     fields.itemDescription ?? undefined,
    length:              fields.length ?? undefined,
    width:               fields.width ?? undefined,
    items_origin:        fields.items_origin ?? undefined,
    manufacturer_flagged: manufacturerFlagged,
  }
}

/**
 * 4-layer extraction cascade for one URL + its Serper snippet.
 *
 * L1 — regex on snippet (free)
 * L2 — Jina fetch + regex + JSON-LD (only if L1 price = null)
 * L3 — Qwen 3.6 gap-fill (only for fields still null after L2)
 * L4 — ScreenshotOne + Gemini Flash (only if price still null)
 */
export async function extractFromUrl(
  url: string,
  snippet: string,
  vision?: VisionResult,
): Promise<PriceSource | null> {
  if (!isScrapeable(url)) return null

  const sourceName = (() => { try { return new URL(url).hostname } catch { return url } })()

  // L1: regex on snippet
  let fields = extractFromText(snippet)

  // L2: Jina full page (only when L1 found no price)
  let markdown: string | null = null
  if (fields.price === null) {
    const l2 = await jinaExtract(url, snippet)
    markdown = l2.markdown

    // NOTE 3: skip if Jina markdown has no price signal at all
    if (markdown && !PRICE_RE_QUICK.test(markdown)) {
      // No price visible on page — L3/L4 unlikely to help; return null
      return null
    }

    fields = mergeFields(fields, l2.fields)
  }

  // L3: Qwen gap-fill for remaining nulls (requires markdown from L2)
  if (markdown) {
    const still = missingFieldNames(fields)
    if (still.length > 0) {
      const patch = await qwenGapFill(still, url, markdown)
      fields = applyPartial(fields, patch)
    }
  }

  // L4: ScreenshotOne + Gemini Flash (only when price still null)
  if (fields.price === null && process.env.SCREENSHOTONE_ACCESS_KEY) {
    const screenshot = await fetchPageScreenshot(url)
    if (screenshot) {
      const l4Missing = missingFieldNames(fields)
      const patch = await geminiExtractFromScreenshot(screenshot, l4Missing)
      fields = applyPartial(fields, patch)
    }
  }

  if (!fields.price || !fields.currency) return null

  // Verify gate
  let manufacturerFlagged = false
  if (vision) {
    const gate = applyVerifyGate(
      buildPriceSourceFromFields(fields, sourceName, url, false)!,
      vision,
    )
    if (gate.discard) return null
    manufacturerFlagged = gate.manufacturerFlag === ManufacturerFlag.Mismatch
  }

  return buildPriceSourceFromFields(fields, sourceName, url, manufacturerFlagged)
}

/** Process multiple URLs in batches of 3. Accepts Serper organic results (url + snippet). */
export async function firecrawlExtractAll(
  results: Array<{ url: string; snippet: string }>,
  vision?: VisionResult,
): Promise<PriceSource[]> {
  const scrapeable = results.filter(r => isScrapeable(r.url))
  const prices: PriceSource[] = []
  const BATCH = 3

  for (let i = 0; i < scrapeable.length; i += BATCH) {
    const batch = scrapeable.slice(i, i + BATCH)
    const settled = await Promise.allSettled(batch.map(r => extractFromUrl(r.url, r.snippet, vision)))
    for (const s of settled) {
      if (s.status === 'fulfilled' && s.value) prices.push(s.value)
    }
  }

  return prices
}
```

- [ ] **Step 5: Run tests**

```
npx jest src/lib/firecrawl.test.ts
```

Expected: existing tests pass + new `buildPriceSourceFromFields` tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/firecrawl.ts src/lib/firecrawl.test.ts
git commit -m "feat: replace Firecrawl with 4-layer cascade (L1 regex → L2 Jina → L3 Qwen → L4 Gemini screenshot)"
```

---

## Task 9: Route.ts — Redis Cache + Shopping-First Strategy

**Files:**
- Modify: `src/app/api/search/route.ts`

- [ ] **Step 1: Add Redis cache and update imports**

At the top of `route.ts`, add the Redis import and update search imports:

```typescript
import { redis } from '@/lib/redis'
import { tavilySearch } from '@/lib/tavily'          // now backed by Serper organic
import { firecrawlExtractAll } from '@/lib/firecrawl' // now backed by Jina 4-layer
import { serpApiShoppingSearch } from '@/lib/serpapi'  // now backed by Serper shopping
```

Remove any existing `import { tavilySearch }` / `import { serpApiShoppingSearch }` / `import { firecrawlExtractAll }` lines and replace with the block above.

- [ ] **Step 2: Add Redis cache check at the top of the POST handler**

Inside `POST`, after parsing the request body and setting `productName`, and BEFORE the query planning, insert:

```typescript
// Redis cache: skip entire pipeline on hit
const cacheKey = `search:v2:${productName}:${visionCtx?.barcode ?? 'no-barcode'}`
const cached = await redis.get<SearchResult>(cacheKey).catch(() => null)
if (cached) {
  if (runId) await publishEvent(runId, { kind: 'search_cache_hit', cacheKey })
  return Response.json(cached)
}
```

- [ ] **Step 3: Implement shopping-first strategy**

Replace the two lines that define `useShoppingApi` and `useTavily`:

```typescript
// OLD:
const useShoppingApi = attempt === 0 || nextEngine === 'serpapi_shopping' || nextEngine === 'both'
const useTavily = attempt === 0 || nextEngine === 'tavily' || nextEngine === 'both' || !nextEngine
```

With:

```typescript
// Shopping-first: attempt 0 skips organic entirely.
// Organic (Serper → Jina cascade) is expensive — only run when shopping is insufficient.
const useShoppingApi = attempt === 0 || nextEngine === 'serpapi_shopping' || nextEngine === 'both'
const useOrganic = attempt > 0 || nextEngine === 'tavily' || nextEngine === 'both'
```

- [ ] **Step 4: Update the parallel engine calls**

Replace the `Promise.all` block that runs Tavily + Shopping:

```typescript
// OLD:
const [tavilyResults, shoppingPrices] = await Promise.all([
  useTavily
    ? tavilySearch(query, 8).catch(...)
    : Promise.resolve([]),
  useShoppingApi
    ? serpApiShoppingSearch(query).catch(...)
    : Promise.resolve([]),
])
```

With:

```typescript
const [organicResults, shoppingPrices] = await Promise.all([
  useOrganic
    ? tavilySearch(query).catch(e => { console.error('[search] Serper organic failed:', e); return [] })
    : Promise.resolve([]),
  useShoppingApi
    ? serpApiShoppingSearch(query).catch(e => { console.error('[search] Serper shopping failed:', e); return [] })
    : Promise.resolve([]),
])
```

- [ ] **Step 5: Update the scraping block**

Replace everything from the `urlsToScrape` definition through `firecrawlExtractAll`:

```typescript
// OLD:
const urlsToScrape = tavilyResults.map(r => r.url).filter(...)
const scraped = await firecrawlExtractAll(urlsToScrape)
```

With:

```typescript
// Pass snippet alongside URL so L1 regex runs for free before any Jina fetch
const organicItems = organicResults
  .filter(r => {
    try { return !ctx.excludedDomains.includes(new URL(r.url).hostname) } catch { return false }
  })
  .map(r => ({ url: r.url, snippet: r.content }))

if (runId) await publishEvent(runId, { kind: 'search_organic', urlCount: organicItems.length })
const scraped = await firecrawlExtractAll(organicItems, visionCtx)
```

Also update the event that previously said `search_tavily`:
```typescript
// Replace:
if (runId) await publishEvent(runId, { kind: 'search_tavily', count: tavilyResults.length, urls: tavilyResults.map(r => r.url) })
// With: (already handled above in search_organic event)
```

- [ ] **Step 6: Add Redis write at the end of the handler**

Just before `return Response.json(result)`, add:

```typescript
// Cache successful result for 24 hours
await redis.set(cacheKey, result, { ex: 86400 }).catch(e => {
  console.warn('[search] Redis write failed (non-blocking):', e)
})
```

- [ ] **Step 7: Verify TypeScript compiles**

```
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/app/api/search/route.ts
git commit -m "feat: shopping-first strategy + Redis 24h cache in search route"
```

---

## Task 10: Report Assembly — Use New PriceSource Fields

**Files:**
- Modify: `src/actions/report.ts`
- Modify: `src/app/api/report/route.ts` (same logic, kept in sync)

- [ ] **Step 1: Update `src/actions/report.ts`**

Inside `assembleReport`, find the `InventoryItem` construction block and update the fields that currently fall back to empty strings:

```typescript
// Find the first source with each optional field
const firstWith = <K extends keyof PriceSource>(key: K) =>
  search.sources.find(s => s[key] != null)?.[key]

const item: InventoryItem = {
  itemId:          generateItemId(),
  ItemName:        productName,
  itemDescription: `${vision.product_category} — ${vision.color} ${vision.shape}`,
  Qty:             null,
  Manufacturer:    vision.brand
                   ?? prediction?.prediction.manufacturer
                   ?? firstWith('manufacturer') as string | undefined
                   ?? '',
  Length:          dims[0] ?? firstWith('length') as string | undefined ?? '',
  Width:           dims[1] ?? firstWith('width')  as string | undefined ?? '',
  Market_Price:    safeAvg,
  Currency:        search.currency,
  Sales_Unit:      search.sources[0]?.unit ?? 'Each',
  Item_Origin:     firstWith('items_origin') as string | undefined ?? '',
  Ext_Price:       null,
  Notes:           assembleNotes(search, flags),
}
```

- [ ] **Step 2: Apply the identical change to `src/app/api/report/route.ts`**

The same `InventoryItem` block exists in `src/app/api/report/route.ts`. Apply the same `firstWith` helper and updated field values there.

- [ ] **Step 3: Verify TypeScript compiles**

```
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/actions/report.ts src/app/api/report/route.ts
git commit -m "feat: populate Length, Width, Item_Origin from search-extracted PriceSource fields"
```

---

## Task 11: Environment Variables

**Files:**
- Modify: `.env` (or `.env.local` if that's the active env file — check which exists)

- [ ] **Step 1: Add the three new keys**

```bash
# Serper.dev — replaces SerpAPI ($50/mo) and Tavily ($35/mo)
# Get key at: https://serper.dev → Dashboard → API Key
SERPER_API_KEY=your_serper_key_here

# Jina AI Reader — replaces Firecrawl page scraping
# Get key at: https://jina.ai → Get API Key
JINA_API_KEY=your_jina_key_here

# ScreenshotOne — full-page render for L4 vision extraction
# Copy from Voritucra .env.local: SCREENSHOTONE_ACCESS_KEY=qlZ267LiqsqzxA
SCREENSHOTONE_ACCESS_KEY=qlZ267LiqsqzxA
```

- [ ] **Step 2: Remove (or comment out) the old keys**

```bash
# SERPAPI_KEY=...          ← remove
# TAVILY_API_KEY=...       ← remove
# FIRECRAWL_API_KEY=...    ← remove
```

- [ ] **Step 3: Commit**

```bash
git add .env
git commit -m "config: swap SerpAPI/Tavily/Firecrawl keys for Serper.dev/Jina/ScreenshotOne"
```

> **Note:** If `.env` is gitignored (it should be), commit `.env.example` instead with placeholder values.

---

## Task 12: Smoke Test End-to-End

No automated test — this is a manual integration check to confirm all layers wire up.

- [ ] **Step 1: Start the dev server**

```
npm run dev
```

- [ ] **Step 2: Scan a product with a clear barcode or brand label**

Use the app's camera capture on a product like a Makita drill or Stanley tape measure. Confirm the pipeline runs through to the report stage without errors.

- [ ] **Step 3: Check server logs for layer signals**

Expected log sequence:
```
[search] attempt 1 — shopping only
[search] Serper shopping: N results
  (if insufficient)
[search] attempt 2 — organic + shopping
[search] Serper organic: N URLs
[extract] L1 regex on snippet: price=XX, manufacturer=YY
  (if L1 price = null)
[extract] L2 Jina fetch: markdown=XXXX chars
  (if fields still missing)
[extract] L3 Qwen gap-fill: missing=[...]
  (if price still null)
[extract] L4 screenshot → Gemini
[verify] source https://... manufacturerFlag=none discard=false
```

- [ ] **Step 4: Verify new fields in the final report**

Open the report and confirm:
- `Item_Origin` is populated (e.g. "Japan" or "China") for at least one source
- `Length` / `Width` are filled when visible on product pages
- `Manufacturer` in the report matches (or soft-flags against) the vision brand

- [ ] **Step 5: Final commit**

```bash
git add .
git commit -m "feat: complete search pipeline upgrade — Serper + Jina + ScreenshotOne + 4-layer extraction cascade"
```

---

## Self-Review

### Spec coverage

| Requirement | Task |
|---|---|
| Replace Firecrawl → Jina | Task 8 |
| Replace SerpAPI → Serper.dev shopping | Task 3 + 4 |
| Replace Tavily → Serper.dev organic | Task 3 + 4 |
| No Brave API | Confirmed — not referenced anywhere |
| L1 snippet regex | Task 2 |
| L2 Jina markdown regex + JSON-LD | Task 5 |
| L3 Qwen 3.6 gap-fill | Task 8 |
| L4 ScreenshotOne + Gemini Flash | Task 6 + 8 |
| Expanded PriceSource fields | Task 1 |
| Verify gate: soft flag manufacturer | Task 7 |
| Verify gate: hard discard description | Task 7 |
| Shopping-first strategy | Task 9 |
| Redis 24h cache | Task 9 |
| Report uses new fields | Task 10 |
| Env vars | Task 11 |

### Type consistency

- `ExtractedFields` defined in `extract-regex.ts`, imported by `jina.ts`, `screenshot.ts`, `firecrawl.ts` ✓
- `SerperOrganicResult` defined in `types/index.ts`, used in `serper.ts` ✓
- `firecrawlExtractAll` signature changed from `string[]` to `Array<{url, snippet}>` — only one caller in `route.ts`, updated in Task 9 ✓
- `ManufacturerFlag` enum used in `verify-gate.ts` and `firecrawl.ts` ✓
- `buildPriceSourceFromFields` exported from `firecrawl.ts`, tested directly ✓
