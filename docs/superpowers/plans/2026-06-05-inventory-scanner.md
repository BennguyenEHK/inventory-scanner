# Inventory Scanner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a mobile-first AI inventory scanner that photographs items, runs a 6-stage AI pipeline to identify products and prices, and saves structured records to a Notion database via voice/text commands or a Save button.

**Architecture:** Next.js 16 App Router with Route Handlers for all AI pipeline stages; all interactive UI is Client Components (`'use client'`); AI calls go through a universal `callModel()` wrapper (RunPod primary → HuggingFace fallback); single-page vertical flow with persistent bottom command bar.

**Tech Stack:** Next.js 16.2.7 · React 19.2.4 · TypeScript · Tailwind CSS v4 · Vitest · RunPod (vLLM) · HuggingFace Inference Providers · Tavily · Firecrawl · Notion API · Web Speech API

---

## Parallelization Map

```
Wave 0 (sequential): Task 1 → Task 2 → Task 3
Wave 1 (parallel):   Task 4 ‖ Task 5 ‖ Task 6
Wave 2 (parallel):   Task 7 ‖ Task 8
Wave 3 (sequential): Task 9 → Task 10 → Task 11
Wave 4 (parallel):   Task 12 ‖ Task 13
Wave 5 (sequential): Task 14
Wave 6 (parallel):   Task 15 ‖ Task 16 ‖ Task 17
Wave 7 (parallel):   Task 18 ‖ Task 19
Wave 8 (sequential): Task 20 → Task 21
```

---

## Task 1: Bootstrap — Vitest + TypeScript Types

**Files:**
- Create: `src/types/index.ts`
- Create: `vitest.config.ts`
- Create: `src/types/index.test.ts`
- Modify: `package.json` (add vitest scripts + deps)

- [ ] **Step 1: Install vitest**

```bash
npm install -D vitest @vitest/coverage-v8
```

Expected output ends with: `added N packages`

- [ ] **Step 2: Create vitest config**

Create `vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
})
```

- [ ] **Step 3: Add test script to package.json**

In `package.json`, add to `"scripts"`:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Create src/types/index.ts**

```typescript
// Vision extraction output — Stage 1
export interface VisionResult {
  visible_text: string[]
  brand: string | null
  model_number: string | null
  product_category: string
  dimensions_visible: string | null
  barcode: string | null
  color: string
  shape: string
  material_hints: string
  label_language: string
  condition: 'new' | 'used' | 'damaged'
  packaging_type: 'box' | 'bag' | 'blister' | 'loose' | 'roll' | 'unknown'
  visual_description: string
  confidence: number
  missing_fields: string[]
  image_quality: 'clear' | 'partial' | 'obscured' | 'unreadable'
}

// Vision routing decision
export type VisionRoute = 'A' | 'B' | 'C'
export interface RouteDecision {
  route: VisionRoute
  strategy: 'direct_search' | 'predict_then_search' | 'ask_user'
  message?: string
}

// Stage 2 — Prediction
export interface PredictionCandidate {
  name: string
  confidence: number
  differentiator: string
}
export interface PredictionResult {
  prediction: {
    product_name: string
    model_number: string | null
    manufacturer: string
    product_line: string
    reasoning: string
    prediction_confidence: number
  }
  candidates: PredictionCandidate[]
  verification_query: string
  requires_verification: boolean
}

// Stage 3 — Search
export interface PriceSource {
  name: string
  url: string
  price: number
  currency: string
  unit: string
  in_stock?: boolean
}
export interface SearchResult {
  sources: PriceSource[]
  avg: number
  min: number
  max: number
  currency: string
  confidence: 'high' | 'medium' | 'low'
  flag: string | null
  attempts: number
  contaminated_removed: PriceSource[]
}

// Stage 4 — Verification
export interface CheckpointResult {
  checkpoint: 1 | 2 | 3
  passed: boolean
  confidence?: number
  issues: string[]
  action: string
  corrections?: Record<string, string>
  clean_sources?: PriceSource[]
  removed_sources?: (PriceSource & { reason: string })[]
  clean_count?: number
}

// Stage 5 — Final Report
export interface InventoryItem {
  itemId: string
  ItemName: string
  itemDescription: string
  Qty: number | null
  Manufacturer: string
  Length: string
  Width: string
  Market_Price: number
  Currency: string
  Sales_Unit: string
  Item_Origin: string
  Ext_Price: number | null
  Notes: string
}
export interface FinalReport {
  report_html: string
  notion_json: InventoryItem
  images: string[]
  flags: string[]
  sourceCount: number
}

// Client-side pipeline state
export type StageStatus = 'pending' | 'running' | 'done' | 'skipped' | 'error'
export interface PipelineStage {
  id: number
  label: string
  status: StageStatus
  detail: string | null
}

// App state machine
export type AppState = 'capture' | 'running' | 'report' | 'saved'

// Command parser result
export interface ParsedCommand {
  action: 'save' | 'update' | 'delete' | 'navigate' | 'rescan' | 'unknown'
  qty?: number
  itemId?: string
  destination?: string
  raw: string
}
```

- [ ] **Step 5: Write a smoke test to verify types compile**

Create `src/types/index.test.ts`:
```typescript
import { describe, it, expect } from 'vitest'
import type { InventoryItem, PipelineStage, VisionResult } from './index'

describe('types', () => {
  it('InventoryItem shape is correct', () => {
    const item: InventoryItem = {
      itemId: 'INV-20260605-0001',
      ItemName: '3M Scotch 810',
      itemDescription: 'Magic tape',
      Qty: null,
      Manufacturer: '3M',
      Length: '1000 in',
      Width: '3/4 in',
      Market_Price: 12.28,
      Currency: 'USD',
      Sales_Unit: 'Each',
      Item_Origin: 'USA',
      Ext_Price: null,
      Notes: 'All verified',
    }
    expect(item.itemId).toBe('INV-20260605-0001')
    expect(item.Qty).toBeNull()
  })

  it('PipelineStage statuses are valid', () => {
    const stage: PipelineStage = { id: 1, label: 'Vision', status: 'done', detail: null }
    expect(['pending','running','done','skipped','error']).toContain(stage.status)
  })
})
```

- [ ] **Step 6: Run tests — expect PASS**

```bash
npm test
```

Expected: `✓ src/types/index.test.ts (2 tests)` — PASS

- [ ] **Step 7: Commit**

```bash
git add src/types/index.ts src/types/index.test.ts vitest.config.ts package.json
git commit -m "feat: add TypeScript types and Vitest setup"
```

---

## Task 2: lib/inference.ts — Universal Model Caller

**Files:**
- Create: `src/lib/inference.ts`
- Create: `src/lib/inference.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/inference.test.ts`:
```typescript
import { describe, it, expect } from 'vitest'
import { stripThinking, getEndpointId } from './inference'

describe('stripThinking', () => {
  it('removes <think> blocks', () => {
    const raw = '<think>reasoning here</think>\n{"result":true}'
    expect(stripThinking(raw)).toBe('{"result":true}')
  })

  it('passes through text with no think blocks', () => {
    expect(stripThinking('{"ok":1}')).toBe('{"ok":1}')
  })

  it('handles multiline think blocks', () => {
    const raw = '<think>\nline 1\nline 2\n</think>\nresult'
    expect(stripThinking(raw)).toBe('result')
  })
})

describe('getEndpointId', () => {
  it('returns vision endpoint for VL model', () => {
    process.env.RUNPOD_VISION_ENDPOINT_ID = 'vision-ep-123'
    expect(getEndpointId('Qwen/Qwen2.5-VL-7B-Instruct')).toBe('vision-ep-123')
  })

  it('returns reasoning endpoint for Qwen3 model', () => {
    process.env.RUNPOD_REASONING_ENDPOINT_ID = 'reason-ep-456'
    expect(getEndpointId('Qwen/Qwen3.6-35B-A3B')).toBe('reason-ep-456')
  })

  it('throws for unknown model', () => {
    expect(() => getEndpointId('unknown/model')).toThrow('Unknown model')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- src/lib/inference.test.ts
```

Expected: FAIL — `Cannot find module './inference'`

- [ ] **Step 3: Implement src/lib/inference.ts**

```typescript
export interface ModelMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | { type: string; [key: string]: unknown }[]
}

export interface CallModelParams {
  model: string
  messages: ModelMessage[]
  enable_thinking?: boolean
  budget_tokens?: number
  temperature?: number
  max_tokens?: number
}

// Exported for testing
export function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
}

// Exported for testing
export function getEndpointId(model: string): string {
  if (model.includes('VL')) return process.env.RUNPOD_VISION_ENDPOINT_ID!
  if (model.includes('Qwen3')) return process.env.RUNPOD_REASONING_ENDPOINT_ID!
  throw new Error(`Unknown model: ${model}`)
}

export async function callModel(params: CallModelParams): Promise<string> {
  const {
    model, messages,
    enable_thinking = false,
    budget_tokens = 2048,
    temperature = 0.1,
    max_tokens = 1024,
  } = params

  const payload: Record<string, unknown> = {
    model, messages, temperature,
    max_tokens: enable_thinking ? budget_tokens : max_tokens,
  }
  if (enable_thinking) {
    payload.chat_template_kwargs = { enable_thinking: true }
  }

  // RunPod primary
  try {
    const endpointId = getEndpointId(model)
    const res = await fetch(
      `${process.env.RUNPOD_BASE_URL}/${endpointId}/runsync`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.RUNPOD_API_KEY}` },
        body: JSON.stringify({ input: payload }),
        signal: AbortSignal.timeout(Number(process.env.RUNPOD_TIMEOUT_MS ?? 90_000)),
      }
    )
    const data = await res.json() as { status: string; output?: { choices?: { message: { content: string } }[] } }
    if (data.status === 'COMPLETED' && data.output?.choices?.[0]) {
      return stripThinking(data.output.choices[0].message.content)
    }
    throw new Error(`RunPod status: ${data.status}`)
  } catch (err) {
    console.error('[inference] RunPod failed → HF fallback:', err instanceof Error ? err.message : String(err))
  }

  // HuggingFace fallback
  const hfRes = await fetch(process.env.HF_BASE_URL!, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.HF_API_KEY}` },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(60_000),
  })
  if (!hfRes.ok) throw new Error(`HF fallback failed: ${hfRes.status}`)
  const hfData = await hfRes.json() as { choices: { message: { content: string } }[] }
  return stripThinking(hfData.choices[0].message.content)
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npm test -- src/lib/inference.test.ts
```

Expected: `✓ src/lib/inference.test.ts (6 tests)` — PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/inference.ts src/lib/inference.test.ts
git commit -m "feat: add universal inference wrapper with RunPod→HF fallback"
```

---

## Task 3: lib/itemId.ts — ID Generator

**Files:**
- Create: `src/lib/itemId.ts`
- Create: `src/lib/itemId.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/itemId.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { generateItemId, resetCounter } from './itemId'

describe('generateItemId', () => {
  beforeEach(() => resetCounter())

  it('generates correct format', () => {
    const id = generateItemId()
    expect(id).toMatch(/^INV-\d{8}-\d{4}$/)
  })

  it('increments counter on each call', () => {
    const id1 = generateItemId()
    const id2 = generateItemId()
    const seq1 = id1.split('-')[2]
    const seq2 = id2.split('-')[2]
    expect(Number(seq2)).toBe(Number(seq1) + 1)
  })

  it('starts counter at 0001', () => {
    const id = generateItemId()
    expect(id.split('-')[2]).toBe('0001')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- src/lib/itemId.test.ts
```

Expected: FAIL — `Cannot find module './itemId'`

- [ ] **Step 3: Implement src/lib/itemId.ts**

```typescript
let sessionCounter = 0

export function resetCounter(): void {
  sessionCounter = 0
}

export function generateItemId(): string {
  sessionCounter++
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const seq = String(sessionCounter).padStart(4, '0')
  return `INV-${date}-${seq}`
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npm test -- src/lib/itemId.test.ts
```

Expected: `✓ src/lib/itemId.test.ts (3 tests)` — PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/itemId.ts src/lib/itemId.test.ts
git commit -m "feat: add INV-YYYYMMDD-XXXX item ID generator"
```

---

## Task 4: lib/tavily.ts — Search Helper

> **Parallel with Tasks 5 and 6**

**Files:**
- Create: `src/lib/tavily.ts`

- [ ] **Step 1: Create src/lib/tavily.ts**

```typescript
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

export async function tavilySearch(
  query: string,
  maxResults = 8
): Promise<TavilyResult[]> {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: process.env.TAVILY_API_KEY,
      query,
      max_results: maxResults,
      search_depth: 'basic',
    }),
  })
  if (!res.ok) throw new Error(`Tavily search failed: ${res.status}`)
  const data = await res.json() as { results: TavilyResult[] }
  return data.results
}

export async function tavilyImageSearch(
  query: string,
  maxResults = 3
): Promise<TavilyImageResult[]> {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: process.env.TAVILY_API_KEY,
      query,
      max_results: maxResults,
      include_images: true,
      search_depth: 'basic',
    }),
  })
  if (!res.ok) throw new Error(`Tavily image search failed: ${res.status}`)
  const data = await res.json() as { images?: TavilyImageResult[] }
  return data.images ?? []
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/tavily.ts
git commit -m "feat: add Tavily search + image search helpers"
```

---

## Task 5: lib/firecrawl.ts — Scrape Helper

> **Parallel with Tasks 4 and 6**

**Files:**
- Create: `src/lib/firecrawl.ts`

- [ ] **Step 1: Create src/lib/firecrawl.ts**

```typescript
import type { PriceSource } from '@/types'

// Schema passed to Firecrawl for every price extract
const PRICE_SCHEMA = {
  type: 'object',
  properties: {
    price:    { type: 'number', description: 'The product selling price' },
    currency: { type: 'string', description: 'Currency code e.g. USD' },
    unit:     { type: 'string', description: 'Unit e.g. each, pack, roll' },
    source:   { type: 'string', description: 'Retailer or supplier name' },
    url:      { type: 'string', description: 'Page URL' },
    in_stock: { type: 'boolean' },
  },
  required: ['price', 'currency'],
}

export async function firecrawlExtract(url: string): Promise<PriceSource | null> {
  const res = await fetch('https://api.firecrawl.dev/v1/extract', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.FIRECRAWL_API_KEY}`,
    },
    body: JSON.stringify({ url, schema: PRICE_SCHEMA }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) return null
  const data = await res.json() as { data?: Partial<PriceSource> }
  if (!data.data?.price || !data.data.currency) return null
  return {
    name: data.data.source ?? new URL(url).hostname,
    url,
    price: data.data.price,
    currency: data.data.currency,
    unit: data.data.unit ?? 'each',
    in_stock: data.data.in_stock,
  }
}

// Scrape all URLs in parallel — never sequentially
export async function firecrawlExtractAll(urls: string[]): Promise<PriceSource[]> {
  const results = await Promise.all(urls.map(url => firecrawlExtract(url)))
  return results.filter((r): r is PriceSource => r !== null && r.price > 0)
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/firecrawl.ts
git commit -m "feat: add Firecrawl parallel price extraction helper"
```

---

## Task 6: lib/notion.ts — Notion CRUD

> **Parallel with Tasks 4 and 5**

**Files:**
- Create: `src/lib/notion.ts`
- Create: `src/lib/notion.test.ts`

- [ ] **Step 1: Write failing test for pure logic**

Create `src/lib/notion.test.ts`:
```typescript
import { describe, it, expect } from 'vitest'
import { buildNotionProperties, parseNotionPage } from './notion'
import type { InventoryItem } from '@/types'

const item: InventoryItem = {
  itemId: 'INV-20260605-0001',
  ItemName: '3M Scotch 810',
  itemDescription: 'Magic tape 3/4in x 1000in',
  Qty: 50,
  Manufacturer: '3M',
  Length: '1000 in',
  Width: '3/4 in',
  Market_Price: 12.28,
  Currency: 'USD',
  Sales_Unit: 'Each',
  Item_Origin: 'USA',
  Ext_Price: 614.00,
  Notes: 'All verified',
}

describe('buildNotionProperties', () => {
  it('sets itemId as title type', () => {
    const props = buildNotionProperties(item)
    expect(props.itemId).toEqual({ title: [{ text: { content: 'INV-20260605-0001' } }] })
  })

  it('sets Qty as number type', () => {
    const props = buildNotionProperties(item)
    expect(props.Qty).toEqual({ number: 50 })
  })

  it('sets Market_Price as number type', () => {
    const props = buildNotionProperties(item)
    expect(props.Market_Price).toEqual({ number: 12.28 })
  })

  it('sets ItemName as rich_text type', () => {
    const props = buildNotionProperties(item)
    expect(props.ItemName).toEqual({ rich_text: [{ text: { content: '3M Scotch 810' } }] })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- src/lib/notion.test.ts
```

Expected: FAIL — `Cannot find module './notion'`

- [ ] **Step 3: Implement src/lib/notion.ts**

```typescript
import type { InventoryItem } from '@/types'

const NOTION_BASE = 'https://api.notion.com/v1'
const NOTION_VERSION = '2022-06-28'

function headers() {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${process.env.NOTION_API_KEY}`,
    'Notion-Version': NOTION_VERSION,
  }
}

// Exported for testing
export function buildNotionProperties(item: InventoryItem): Record<string, unknown> {
  const rt = (s: string) => ({ rich_text: [{ text: { content: s } }] })
  return {
    itemId:          { title: [{ text: { content: item.itemId } }] },
    ItemName:        rt(item.ItemName),
    itemDescription: rt(item.itemDescription),
    Qty:             { number: item.Qty },
    Manufacturer:    rt(item.Manufacturer),
    Length:          rt(item.Length),
    Width:           rt(item.Width),
    Market_Price:    { number: item.Market_Price },
    Currency:        rt(item.Currency),
    Sales_Unit:      rt(item.Sales_Unit),
    Item_Origin:     rt(item.Item_Origin),
    Ext_Price:       { number: item.Ext_Price },
    Notes:           rt(item.Notes),
  }
}

// Exported for testing — maps Notion page response back to InventoryItem
export function parseNotionPage(page: Record<string, unknown>): InventoryItem {
  const p = page.properties as Record<string, { title?: { plain_text: string }[]; rich_text?: { plain_text: string }[]; number?: number }>
  const txt = (key: string) => p[key]?.rich_text?.[0]?.plain_text ?? ''
  const num = (key: string) => p[key]?.number ?? 0
  return {
    itemId:          p.itemId?.title?.[0]?.plain_text ?? '',
    ItemName:        txt('ItemName'),
    itemDescription: txt('itemDescription'),
    Qty:             p.Qty?.number ?? null,
    Manufacturer:    txt('Manufacturer'),
    Length:          txt('Length'),
    Width:           txt('Width'),
    Market_Price:    num('Market_Price'),
    Currency:        txt('Currency'),
    Sales_Unit:      txt('Sales_Unit'),
    Item_Origin:     txt('Item_Origin'),
    Ext_Price:       p.Ext_Price?.number ?? null,
    Notes:           txt('Notes'),
  }
}

export async function notionInsert(item: InventoryItem): Promise<{ id: string }> {
  const res = await fetch(`${NOTION_BASE}/pages`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      parent: { database_id: process.env.NOTION_DATABASE_ID },
      properties: buildNotionProperties(item),
    }),
  })
  if (!res.ok) throw new Error(`Notion insert failed: ${res.status} ${await res.text()}`)
  return res.json() as Promise<{ id: string }>
}

export async function notionQuery(filter?: Record<string, unknown>): Promise<InventoryItem[]> {
  const body: Record<string, unknown> = {
    sorts: [{ timestamp: 'created_time', direction: 'descending' }],
    page_size: 50,
  }
  if (filter) body.filter = filter
  const res = await fetch(`${NOTION_BASE}/databases/${process.env.NOTION_DATABASE_ID}/query`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Notion query failed: ${res.status}`)
  const data = await res.json() as { results: Record<string, unknown>[] }
  return data.results.map(parseNotionPage)
}

export async function notionGetPageId(itemId: string): Promise<string> {
  const res = await fetch(`${NOTION_BASE}/databases/${process.env.NOTION_DATABASE_ID}/query`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ filter: { property: 'itemId', title: { equals: itemId } } }),
  })
  const data = await res.json() as { results: { id: string }[] }
  if (!data.results[0]) throw new Error(`Item not found: ${itemId}`)
  return data.results[0].id
}

export async function notionUpdate(itemId: string, patch: Partial<InventoryItem>): Promise<void> {
  const pageId = await notionGetPageId(itemId)
  const item = patch as InventoryItem
  const props: Record<string, unknown> = {}
  if (patch.Qty !== undefined) props.Qty = { number: patch.Qty }
  if (patch.Ext_Price !== undefined) props.Ext_Price = { number: patch.Ext_Price }
  if (patch.Notes !== undefined) props.Notes = { rich_text: [{ text: { content: item.Notes } }] }
  const res = await fetch(`${NOTION_BASE}/pages/${pageId}`, {
    method: 'PATCH',
    headers: headers(),
    body: JSON.stringify({ properties: props }),
  })
  if (!res.ok) throw new Error(`Notion update failed: ${res.status}`)
}

export async function notionArchive(itemId: string): Promise<void> {
  const pageId = await notionGetPageId(itemId)
  const res = await fetch(`${NOTION_BASE}/pages/${pageId}`, {
    method: 'PATCH',
    headers: headers(),
    body: JSON.stringify({ archived: true }),
  })
  if (!res.ok) throw new Error(`Notion archive failed: ${res.status}`)
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npm test -- src/lib/notion.test.ts
```

Expected: `✓ src/lib/notion.test.ts (4 tests)` — PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/notion.ts src/lib/notion.test.ts
git commit -m "feat: add Notion CRUD helpers with tested property mapping"
```

---

## Task 7: api/vision/route.ts — Stage 1 Vision Extraction

> **Parallel with Task 8**

**Files:**
- Create: `src/app/api/vision/route.ts`

- [ ] **Step 1: Create src/app/api/vision/route.ts**

```typescript
import { callModel } from '@/lib/inference'
import type { VisionResult, RouteDecision } from '@/types'

const SYSTEM_PROMPT = `You are a product identification specialist.
Analyze this image and extract ALL visible information.
Be maximally descriptive — even for unclear images.
Never guess field values. If not visible, set null.
Always describe visual appearance even when text is unreadable.
Return valid JSON only. No preamble.`

function visionRouter(v: VisionResult): RouteDecision {
  if (v.confidence >= 0.8 && v.brand !== null)
    return { route: 'A', strategy: 'direct_search' }
  if (v.confidence >= 0.4 && (v.brand !== null || v.model_number !== null))
    return { route: 'B', strategy: 'predict_then_search' }
  return {
    route: 'C',
    strategy: 'ask_user',
    message: `Image unclear. Please retake showing the label, or confirm: is this a ${v.product_category}?`,
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const { images } = await request.json() as { images: string[] } // base64 array

    // Build multi-image message — pass all images to vision model
    const imageContent = images.map((b64: string) => ({
      type: 'image_url',
      image_url: { url: `data:image/jpeg;base64,${b64}` },
    }))

    const raw = await callModel({
      model: 'Qwen/Qwen2.5-VL-7B-Instruct',
      messages: [{
        role: 'user',
        content: [
          ...imageContent,
          { type: 'text', text: `${SYSTEM_PROMPT}\n\nExtract all product information from these images. If multiple images show the same product from different angles, combine the information. Return JSON matching the required schema exactly.` },
        ],
      }],
      temperature: 0.1,
      max_tokens: 1024,
    })

    const vision: VisionResult = JSON.parse(raw)
    if (!vision.visual_description) vision.visual_description = 'No description available'
    const route = visionRouter(vision)

    return Response.json({ vision, route })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Vision extraction failed' },
      { status: 500 }
    )
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/vision/route.ts
git commit -m "feat: add Stage 1 vision extraction route handler"
```

---

## Task 8: api/predict/route.ts — Stage 2 Black Box Prediction

> **Parallel with Task 7**

**Files:**
- Create: `src/app/api/predict/route.ts`

- [ ] **Step 1: Create src/app/api/predict/route.ts**

```typescript
import { callModel } from '@/lib/inference'
import { tavilySearch } from '@/lib/tavily'
import type { VisionResult, PredictionResult } from '@/types'

const SYSTEM_PROMPT = `You are a product identification expert with deep knowledge of industrial, commercial, and consumer products.

Given partial product information, use your training knowledge to:
1. Identify the most likely product line and model
2. Explain your reasoning step by step
3. List 2-3 candidate products ranked by likelihood
4. Return your best prediction as structured JSON

Be clinical and precise. Return JSON only after your reasoning.`

export async function POST(request: Request): Promise<Response> {
  try {
    const vision: VisionResult = await request.json()

    const inputPayload = {
      brand: vision.brand,
      model_number: vision.model_number,
      visual_description: vision.visual_description,
      dimensions_visible: vision.dimensions_visible,
      product_category: vision.product_category,
      packaging_type: vision.packaging_type,
      color: vision.color,
      barcode: vision.barcode,
    }

    const raw = await callModel({
      model: 'Qwen/Qwen3.6-35B-A3B',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify(inputPayload) },
      ],
      enable_thinking: true,
      budget_tokens: 3000,
      temperature: 0.2,
    })

    const prediction: PredictionResult = JSON.parse(raw)

    // Verify prediction with Tavily
    const query = vision.barcode
      ? `barcode ${vision.barcode} product`
      : prediction.verification_query
    const results = await tavilySearch(query, 3)
    const confirmed = results.some(r =>
      r.content.toLowerCase().includes(prediction.prediction.product_name.toLowerCase().split(' ')[0])
    )

    return Response.json({
      prediction,
      verification: {
        confirmed,
        sources: results.slice(0, 2).map(r => ({ url: r.url, title: r.title })),
      },
    })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Prediction failed' },
      { status: 500 }
    )
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/predict/route.ts
git commit -m "feat: add Stage 2 black box prediction route handler"
```

---

## Task 9: api/search/route.ts — Stage 3 Agentic Search Loop

**Files:**
- Create: `src/app/api/search/route.ts`

- [ ] **Step 1: Create src/app/api/search/route.ts**

```typescript
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

      // Sufficiency check
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
    const currency = clean[0]?.currency ?? 'USD'

    const result: SearchResult = {
      sources: clean,
      avg, min, max, currency,
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
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/search/route.ts
git commit -m "feat: add Stage 3 agentic ReAct price search loop"
```

---

## Task 10: api/verify/route.ts — Stage 4 Verification

**Files:**
- Create: `src/app/api/verify/route.ts`

- [ ] **Step 1: Create src/app/api/verify/route.ts**

```typescript
import { callModel } from '@/lib/inference'
import type { VisionResult, SearchResult, InventoryItem, CheckpointResult } from '@/types'

const INFERENCE_PARAMS = { model: 'Qwen/Qwen3.6-35B-A3B', enable_thinking: true as const, budget_tokens: 2048, temperature: 0.1, max_tokens: 1024 }

async function checkpoint1(vision: VisionResult): Promise<CheckpointResult> {
  const raw = await callModel({
    ...INFERENCE_PARAMS,
    messages: [
      { role: 'system', content: 'You are a product verification expert. Given extracted product information, verify logical consistency. Check: does manufacturer match product category? Does model number format match brand conventions? Are dimensions plausible? Return JSON only.' },
      { role: 'user', content: JSON.stringify(vision) },
    ],
  })
  return JSON.parse(raw) as CheckpointResult
}

async function checkpoint2(productName: string, search: SearchResult): Promise<CheckpointResult> {
  const raw = await callModel({
    ...INFERENCE_PARAMS,
    messages: [
      { role: 'system', content: 'You are a price verification auditor. Given a target product name and scraped prices, verify each result is for the EXACT same product. Watch for: similar model numbers, different sizes, accessories, bundles, multi-packs. For each result: KEEP or REMOVE with reason. Return JSON only.' },
      { role: 'user', content: JSON.stringify({ productName, sources: search.sources }) },
    ],
  })
  return JSON.parse(raw) as CheckpointResult
}

async function checkpoint3(item: InventoryItem): Promise<CheckpointResult> {
  const raw = await callModel({
    ...INFERENCE_PARAMS,
    messages: [
      { role: 'system', content: 'You are a data quality auditor for an inventory system. Review this record for logical consistency. Verify all fields populated, units include units string, Ext_Price equals Market_Price × Qty, Notes contains "Prices:" prefix. Return JSON only.' },
      { role: 'user', content: JSON.stringify(item) },
    ],
  })
  return JSON.parse(raw) as CheckpointResult
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      checkpoint: 1 | 2 | 3
      vision?: VisionResult
      productName?: string
      search?: SearchResult
      item?: InventoryItem
    }

    let result: CheckpointResult
    if (body.checkpoint === 1 && body.vision) result = await checkpoint1(body.vision)
    else if (body.checkpoint === 2 && body.productName && body.search) result = await checkpoint2(body.productName, body.search)
    else if (body.checkpoint === 3 && body.item) result = await checkpoint3(body.item)
    else return Response.json({ error: 'Invalid checkpoint request' }, { status: 400 })

    return Response.json(result)
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Verification failed' },
      { status: 500 }
    )
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/verify/route.ts
git commit -m "feat: add Stage 4 three-checkpoint verification route"
```

---

## Task 11: api/report/route.ts — Stage 5 Report Assembly

**Files:**
- Create: `src/app/api/report/route.ts`

- [ ] **Step 1: Create src/app/api/report/route.ts**

```typescript
import { tavilyImageSearch } from '@/lib/tavily'
import { generateItemId } from '@/lib/itemId'
import type { VisionResult, PredictionResult, SearchResult, CheckpointResult, InventoryItem, FinalReport } from '@/types'

function assembleNotes(search: SearchResult, flags: string[]): string {
  const breakdown = search.sources
    .map(s => `${s.name} $${s.price}`)
    .join(' | ')
  const summary = `Prices: ${breakdown} | Range: $${search.min}–$${search.max} | Avg: $${search.avg}`
  const flagStr = flags.length > 0 ? '\n' + flags.join('\n') : '\nAll fields verified — no issues'
  return summary + flagStr
}

export async function POST(request: Request): Promise<Response> {
  try {
    const { vision, prediction, search, cp1, cp2 } = await request.json() as {
      vision: VisionResult
      prediction?: PredictionResult
      search: SearchResult
      cp1: CheckpointResult
      cp2: CheckpointResult
    }

    const flags: string[] = []
    if (!cp1.passed) flags.push('⚠️ Low confidence match — recommend recheck')
    if (cp2.removed_sources && cp2.removed_sources.length > 0)
      flags.push(`Removed ${cp2.removed_sources.length} contaminated price sources`)
    if (search.flag) flags.push(search.flag)
    if (prediction) flags.push('Prediction used — black box image, verify product')

    const productName = prediction?.prediction.product_name ?? vision.brand ?? 'Unknown Product'

    // Parse dimensions
    const dims = vision.dimensions_visible?.split('x').map(d => d.trim()) ?? []

    const item: InventoryItem = {
      itemId: generateItemId(),
      ItemName: productName,
      itemDescription: `${vision.product_category} — ${vision.color} ${vision.shape}`,
      Qty: null,
      Manufacturer: vision.brand ?? prediction?.prediction.manufacturer ?? '',
      Length: dims[0] ?? '',
      Width: dims[1] ?? '',
      Market_Price: search.avg,
      Currency: search.currency,
      Sales_Unit: search.sources[0]?.unit ?? 'Each',
      Item_Origin: '',
      Ext_Price: null,
      Notes: assembleNotes(search, flags),
    }

    const images = await tavilyImageSearch(`${productName} product image`, 3)

    const report: FinalReport = {
      report_html: productName,
      notion_json: item,
      images: images.map(i => i.url),
      flags,
      sourceCount: cp2.clean_sources?.length ?? search.sources.length,
    }

    return Response.json(report)
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Report assembly failed' },
      { status: 500 }
    )
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/report/route.ts
git commit -m "feat: add Stage 5 report assembly with Notes and image search"
```

---

## Task 12: api/notion/route.ts — Stage 6 Notion CRUD

> **Parallel with Task 13**

**Files:**
- Create: `src/app/api/notion/route.ts`

- [ ] **Step 1: Create src/app/api/notion/route.ts**

```typescript
import { notionInsert, notionQuery, notionUpdate, notionArchive } from '@/lib/notion'
import type { InventoryItem } from '@/types'

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      action: 'insert' | 'query' | 'update' | 'archive'
      item?: InventoryItem
      qty?: number
      itemId?: string
      filter?: Record<string, unknown>
    }

    switch (body.action) {
      case 'insert': {
        if (!body.item || body.qty === undefined) {
          return Response.json({ error: 'item and qty required' }, { status: 400 })
        }
        // Compute Ext_Price in code — never trust client value
        const item: InventoryItem = {
          ...body.item,
          Qty: body.qty,
          Ext_Price: Math.round(body.item.Market_Price * body.qty * 100) / 100,
        }
        const page = await notionInsert(item)
        return Response.json({
          success: true,
          message: `✅ Saved — ${item.itemId} | ${item.ItemName} | Qty: ${item.Qty} | Ext: $${item.Ext_Price}`,
          pageId: page.id,
        })
      }

      case 'query': {
        const items = await notionQuery(body.filter)
        return Response.json({ items })
      }

      case 'update': {
        if (!body.itemId || body.qty === undefined) {
          return Response.json({ error: 'itemId and qty required' }, { status: 400 })
        }
        // Need current Market_Price to recompute Ext_Price
        const [current] = await notionQuery({ property: 'itemId', title: { equals: body.itemId } })
        if (!current) return Response.json({ error: 'Item not found' }, { status: 404 })
        const newExtPrice = Math.round(current.Market_Price * body.qty * 100) / 100
        const updatedNotes = `${current.Notes}\nUpdated: Qty ${current.Qty} → ${body.qty} | Ext $${current.Ext_Price} → $${newExtPrice}`
        await notionUpdate(body.itemId, { Qty: body.qty, Ext_Price: newExtPrice, Notes: updatedNotes })
        return Response.json({
          success: true,
          message: `✅ Updated — ${body.itemId} | Qty: ${body.qty} | Ext: $${newExtPrice}`,
        })
      }

      case 'archive': {
        if (!body.itemId) return Response.json({ error: 'itemId required' }, { status: 400 })
        await notionArchive(body.itemId)
        return Response.json({ success: true, message: `🗑️ Archived — ${body.itemId}` })
      }

      default:
        return Response.json({ error: 'Unknown action' }, { status: 400 })
    }
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Notion operation failed' },
      { status: 500 }
    )
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/notion/route.ts
git commit -m "feat: add Stage 6 Notion CRUD route (insert/query/update/archive)"
```

---

## Task 13: api/command/route.ts — NLP Command Parser

> **Parallel with Task 12**

**Files:**
- Create: `src/app/api/command/route.ts`
- Create: `src/app/api/command/route.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/app/api/command/route.test.ts`:
```typescript
import { describe, it, expect } from 'vitest'
import { parseCommand } from './parse'

describe('parseCommand', () => {
  it('parses "save qty 50"', () => {
    const r = parseCommand('save qty 50')
    expect(r.action).toBe('save')
    expect(r.qty).toBe(50)
  })

  it('parses "save 100 units"', () => {
    const r = parseCommand('save 100 units')
    expect(r.action).toBe('save')
    expect(r.qty).toBe(100)
  })

  it('parses "update qty to 75"', () => {
    const r = parseCommand('update qty to 75')
    expect(r.action).toBe('update')
    expect(r.qty).toBe(75)
  })

  it('parses "discard"', () => {
    expect(parseCommand('discard').action).toBe('rescan')
  })

  it('parses "show inventory"', () => {
    expect(parseCommand('show inventory').action).toBe('navigate')
  })

  it('returns unknown for unrecognised input', () => {
    expect(parseCommand('what is the weather').action).toBe('unknown')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm test -- src/app/api/command/route.test.ts
```

Expected: FAIL — `Cannot find module './parse'`

- [ ] **Step 3: Create src/app/api/command/parse.ts**

```typescript
import type { ParsedCommand } from '@/types'

export function parseCommand(input: string): ParsedCommand {
  const s = input.trim().toLowerCase()
  const raw = input.trim()

  // save qty 50 / save 50 / save 50 units
  const saveMatch = s.match(/^save(?:\s+qty)?\s+(\d+)/)
  if (saveMatch) return { action: 'save', qty: parseInt(saveMatch[1], 10), raw }

  // update qty to 75 / update to 75
  const updateMatch = s.match(/^update(?:\s+(?:qty\s+)?to)?\s+(\d+)/)
  if (updateMatch) return { action: 'update', qty: parseInt(updateMatch[1], 10), raw }

  // delete / archive / discard
  if (/^(delete|archive|discard|remove)\b/.test(s))
    return { action: 'rescan', raw }

  // show inventory / go to inventory / inventory
  if (/inventory/.test(s))
    return { action: 'navigate', destination: '/inventory', raw }

  // rescan / scan again / new scan
  if (/^(rescan|scan again|new scan|restart)\b/.test(s))
    return { action: 'rescan', raw }

  return { action: 'unknown', raw }
}
```

- [ ] **Step 4: Create src/app/api/command/route.ts**

```typescript
import { parseCommand } from './parse'

export async function POST(request: Request): Promise<Response> {
  try {
    const { text } = await request.json() as { text: string }
    if (!text?.trim()) return Response.json({ error: 'text required' }, { status: 400 })
    const command = parseCommand(text)
    return Response.json(command)
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Command parse failed' },
      { status: 500 }
    )
  }
}
```

- [ ] **Step 5: Run tests — expect PASS**

```bash
npm test -- src/app/api/command/route.test.ts
```

Expected: `✓ src/app/api/command/route.test.ts (6 tests)` — PASS

- [ ] **Step 6: Commit**

```bash
git add src/app/api/command/parse.ts src/app/api/command/route.ts src/app/api/command/route.test.ts
git commit -m "feat: add command parser (save/update/delete/navigate/rescan)"
```

---

## Task 14: globals.css + layout.tsx — Dark Mobile Theme

**Files:**
- Modify: `src/app/globals.css`
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: Replace src/app/globals.css**

```css
@import "tailwindcss";

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --font-sans: var(--font-geist-sans);
  --font-mono: var(--font-geist-mono);

  /* App design tokens */
  --color-surface:  #111827;
  --color-surface2: #1e293b;
  --color-border:   #334155;
  --color-primary:  #0284c7;
  --color-accent:   #38bdf8;
  --color-success:  #10b981;
  --color-warning:  #f59e0b;
  --color-danger:   #ef4444;
  --color-muted:    #64748b;
}

:root {
  --background: #0a0a0f;
  --foreground: #e2e8f0;
}

* { -webkit-tap-highlight-color: transparent; }

body {
  background: var(--background);
  color: var(--foreground);
  font-family: var(--font-geist-sans), system-ui, sans-serif;
  overscroll-behavior-y: contain;
}

/* Scrollbar — slim dark */
::-webkit-scrollbar { width: 4px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: #334155; border-radius: 2px; }
```

- [ ] **Step 2: Replace src/app/layout.tsx**

```tsx
import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] })
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'InvScan — Inventory Scanner',
  description: 'AI-powered inventory scanner with Notion integration',
}

// Mobile viewport config — prevents zoom on input focus
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full`}>
      <body className="min-h-full flex flex-col bg-[#0a0a0f] text-slate-200 antialiased">
        {children}
      </body>
    </html>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/globals.css src/app/layout.tsx
git commit -m "feat: configure dark mobile-first theme and viewport"
```

---

## Task 15: components/PhotoCapture.tsx

> **Parallel with Tasks 16 and 17**

**Files:**
- Create: `src/components/PhotoCapture.tsx`

- [ ] **Step 1: Create src/components/PhotoCapture.tsx**

```tsx
'use client'

import { useRef, useState } from 'react'

interface Props {
  onPhotosChange: (base64s: string[]) => void
  disabled?: boolean
}

const MAX_PHOTOS = 3

// Compress and convert File to base64 string
async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas')
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      // Max 1024px, keep aspect ratio
      const max = 1024
      let { width, height } = img
      if (width > max || height > max) {
        if (width > height) { height = Math.round(height * max / width); width = max }
        else { width = Math.round(width * max / height); height = max }
      }
      canvas.width = width
      canvas.height = height
      canvas.getContext('2d')!.drawImage(img, 0, 0, width, height)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/jpeg', 0.85).split(',')[1])
    }
    img.onerror = reject
    img.src = url
  })
}

export default function PhotoCapture({ onPhotosChange, disabled }: Props) {
  const [photos, setPhotos] = useState<{ preview: string; base64: string }[]>([])
  const cameraRef = useRef<HTMLInputElement>(null)
  const galleryRef = useRef<HTMLInputElement>(null)

  const addFiles = async (files: FileList | null) => {
    if (!files) return
    const remaining = MAX_PHOTOS - photos.length
    const toAdd = Array.from(files).slice(0, remaining)
    const newPhotos = await Promise.all(
      toAdd.map(async f => ({
        preview: URL.createObjectURL(f),
        base64: await fileToBase64(f),
      }))
    )
    const updated = [...photos, ...newPhotos]
    setPhotos(updated)
    onPhotosChange(updated.map(p => p.base64))
  }

  const remove = (index: number) => {
    const updated = photos.filter((_, i) => i !== index)
    setPhotos(updated)
    onPhotosChange(updated.map(p => p.base64))
  }

  return (
    <div className="bg-[#111827] rounded-xl p-3 mb-3">
      <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-2">
        Photos ({photos.length}/{MAX_PHOTOS})
      </p>

      {/* Photo grid */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        {Array.from({ length: MAX_PHOTOS }).map((_, i) => {
          const photo = photos[i]
          return photo ? (
            <div key={i} className="relative rounded-lg overflow-hidden h-20 bg-blue-950">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.preview} alt="" className="w-full h-full object-cover" />
              <button
                onClick={() => remove(i)}
                disabled={disabled}
                className="absolute top-1 right-1 bg-red-500 rounded-full w-5 h-5 flex items-center justify-center text-white text-[10px] font-bold"
              >
                ✕
              </button>
            </div>
          ) : (
            <div
              key={i}
              className="h-20 rounded-lg border-[1.5px] border-dashed border-slate-600 flex flex-col items-center justify-center text-slate-600"
            >
              <span className="text-xl">+</span>
              <span className="text-[9px]">add</span>
            </div>
          )
        })}
      </div>

      {/* Camera / Gallery buttons */}
      <div className="flex gap-2">
        <button
          onClick={() => cameraRef.current?.click()}
          disabled={disabled || photos.length >= MAX_PHOTOS}
          className="flex-1 bg-sky-600 disabled:opacity-40 rounded-lg py-2 text-white text-xs font-bold"
        >
          📷 Camera
        </button>
        <button
          onClick={() => galleryRef.current?.click()}
          disabled={disabled || photos.length >= MAX_PHOTOS}
          className="flex-1 bg-[#1e293b] disabled:opacity-40 rounded-lg py-2 text-slate-300 text-xs"
        >
          🖼 Gallery
        </button>
      </div>

      {/* Hidden file inputs */}
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" multiple className="hidden"
        onChange={e => addFiles(e.target.files)} />
      <input ref={galleryRef} type="file" accept="image/*" multiple className="hidden"
        onChange={e => addFiles(e.target.files)} />
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/PhotoCapture.tsx
git commit -m "feat: add PhotoCapture component (3-slot grid, camera/gallery, base64)"
```

---

## Task 16: components/PipelineProgress.tsx

> **Parallel with Tasks 15 and 17**

**Files:**
- Create: `src/components/PipelineProgress.tsx`

- [ ] **Step 1: Create src/components/PipelineProgress.tsx**

```tsx
'use client'

import type { PipelineStage } from '@/types'

interface Props {
  stages: PipelineStage[]
}

const STATUS_CONFIG = {
  done:    { icon: '✓', color: 'text-emerald-400', bg: 'bg-emerald-500', border: '' },
  running: { icon: '⟳', color: 'text-amber-400',  bg: 'bg-amber-500',   border: '' },
  error:   { icon: '✕', color: 'text-red-400',     bg: 'bg-red-500',     border: '' },
  skipped: { icon: '–', color: 'text-slate-500',   bg: 'bg-slate-600',   border: '' },
  pending: { icon: ' ', color: 'text-slate-600',   bg: 'bg-transparent', border: 'border border-slate-700' },
}

export default function PipelineProgress({ stages }: Props) {
  return (
    <div className="bg-[#111827] rounded-xl p-3 mb-3">
      <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-3">Pipeline Progress</p>
      <div className="space-y-0">
        {stages.map((stage, idx) => {
          const cfg = STATUS_CONFIG[stage.status]
          const isDimmed = stage.status === 'pending' || stage.status === 'skipped'
          return (
            <div
              key={stage.id}
              className={`flex items-center gap-3 py-2 ${idx < stages.length - 1 ? 'border-b border-slate-800' : ''} ${isDimmed ? 'opacity-40' : ''}`}
            >
              <div className={`w-5 h-5 rounded-full ${cfg.bg} ${cfg.border} flex items-center justify-center flex-shrink-0`}>
                <span className={`text-[9px] font-bold text-white ${stage.status === 'running' ? 'animate-spin inline-block' : ''}`}>
                  {cfg.icon}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-[11px] font-semibold ${cfg.color}`}>{stage.label}</p>
                {stage.detail && (
                  <p className="text-[9px] text-slate-500 truncate">{stage.detail}</p>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/PipelineProgress.tsx
git commit -m "feat: add PipelineProgress component with animated stage cards"
```

---

## Task 17: components/ItemReport.tsx

> **Parallel with Tasks 15 and 16**

**Files:**
- Create: `src/components/ItemReport.tsx`

- [ ] **Step 1: Create src/components/ItemReport.tsx**

```tsx
'use client'

import { useState } from 'react'
import type { FinalReport } from '@/types'

interface Props {
  report: FinalReport
}

export default function ItemReport({ report }: Props) {
  const [enlarged, setEnlarged] = useState<string | null>(null)
  const item = report.notion_json
  const hasWarnings = report.flags.some(f => f.startsWith('⚠️'))

  return (
    <div className="bg-[#111827] rounded-xl p-3 mb-3 border border-sky-900">
      {/* Header */}
      <div className="flex justify-between items-start mb-2">
        <div>
          <p className="text-sky-400 text-sm font-bold leading-tight">{item.ItemName}</p>
          <p className="text-slate-500 text-[10px]">{item.itemId}</p>
        </div>
        <span className={`text-[9px] px-2 py-0.5 rounded font-bold ${hasWarnings ? 'bg-amber-500/20 text-amber-400' : 'bg-emerald-500/20 text-emerald-400'}`}>
          {hasWarnings ? '⚠️ REVIEW' : '✓ VERIFIED'}
        </span>
      </div>

      {/* Verification images */}
      {report.images.length > 0 && (
        <div className="grid grid-cols-3 gap-1.5 mb-2">
          {report.images.map((url, i) => (
            <button key={i} onClick={() => setEnlarged(url)} className="h-14 rounded overflow-hidden bg-blue-950">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt={`ref ${i + 1}`} className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}
      {report.images.length > 0 && (
        <p className="text-[9px] text-slate-500 text-center mb-2">↑ Tap images to confirm match</p>
      )}

      {/* Pricing */}
      <div className="bg-[#0f172a] rounded-lg p-2 mb-2">
        <div className="flex justify-between items-center mb-1">
          <span className="text-emerald-400 text-[10px] font-bold">💰 {report.sourceCount} Sources</span>
          <span className="text-sky-400 text-[11px] font-bold">Avg: ${item.Market_Price}</span>
        </div>
        <p className="text-slate-500 text-[9px] leading-relaxed">
          {item.Notes.split('\n')[0].replace('Prices: ', '')}
        </p>
      </div>

      {/* Fields grid */}
      <div className="grid grid-cols-2 gap-1.5 text-[10px]">
        {[
          ['Mfr', item.Manufacturer],
          ['Origin', item.Item_Origin || '—'],
          ['Length', item.Length || '—'],
          ['Width', item.Width || '—'],
          ['Currency', item.Currency],
          ['Unit', item.Sales_Unit],
        ].map(([label, value]) => (
          <div key={label} className="bg-[#0f172a] rounded px-2 py-1">
            <span className="text-slate-500">{label}: </span>
            <span className="text-slate-300">{value}</span>
          </div>
        ))}
      </div>

      {/* Flags */}
      {report.flags.map((f, i) => (
        <p key={i} className="text-[9px] text-amber-400 mt-1">{f}</p>
      ))}

      {/* Enlarged image overlay */}
      {enlarged && (
        <div
          className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4"
          onClick={() => setEnlarged(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={enlarged} alt="enlarged" className="max-w-full max-h-full rounded-xl" />
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ItemReport.tsx
git commit -m "feat: add ItemReport component with verification images and pricing"
```

---

## Task 18: components/QtyControl.tsx + CommandBar.tsx

> **Parallel with Task 19**

**Files:**
- Create: `src/components/QtyControl.tsx`
- Create: `src/components/CommandBar.tsx`

- [ ] **Step 1: Create src/components/QtyControl.tsx**

```tsx
'use client'

import { useState } from 'react'

interface Props {
  onSave: (qty: number) => void
  disabled?: boolean
  saving?: boolean
}

export default function QtyControl({ onSave, disabled, saving }: Props) {
  const [qty, setQty] = useState(1)

  return (
    <div className="bg-[#111827] rounded-xl px-3 py-2 mb-2 flex gap-2 items-center">
      <span className="text-slate-500 text-xs">Qty:</span>
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => setQty(q => Math.max(1, q - 1))}
          disabled={disabled || saving}
          className="bg-[#1e293b] disabled:opacity-40 rounded w-7 h-7 flex items-center justify-center text-slate-300 text-sm font-bold"
        >−</button>
        <input
          type="number"
          min={1}
          value={qty}
          onChange={e => setQty(Math.max(1, parseInt(e.target.value) || 1))}
          disabled={disabled || saving}
          className="w-12 h-7 bg-[#0f172a] border border-slate-700 text-white text-center text-xs rounded disabled:opacity-40"
        />
        <button
          onClick={() => setQty(q => q + 1)}
          disabled={disabled || saving}
          className="bg-[#1e293b] disabled:opacity-40 rounded w-7 h-7 flex items-center justify-center text-slate-300 text-sm font-bold"
        >+</button>
      </div>
      <button
        onClick={() => onSave(qty)}
        disabled={disabled || saving || qty < 1}
        className="flex-1 bg-gradient-to-r from-emerald-500 to-sky-600 disabled:opacity-40 rounded-lg py-1.5 text-white text-xs font-bold"
      >
        {saving ? '⏳ Saving…' : '✅ Save to Notion'}
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Create src/components/CommandBar.tsx**

```tsx
'use client'

import { useEffect, useRef, useState } from 'react'

interface Props {
  onCommand: (text: string) => void
  placeholder?: string
  disabled?: boolean
}

export default function CommandBar({ onCommand, placeholder, disabled }: Props) {
  const [text, setText] = useState('')
  const [listening, setListening] = useState(false)
  const recognitionRef = useRef<SpeechRecognition | null>(null)

  useEffect(() => {
    // SpeechRecognition is browser-only, not available in SSR
    const SR = (window as Window & { SpeechRecognition?: typeof SpeechRecognition; webkitSpeechRecognition?: typeof SpeechRecognition }).SpeechRecognition
      ?? (window as Window & { webkitSpeechRecognition?: typeof SpeechRecognition }).webkitSpeechRecognition
    if (!SR) return
    const rec = new SR()
    rec.continuous = false
    rec.interimResults = true
    rec.lang = 'en-US'
    rec.onresult = e => {
      const transcript = Array.from(e.results)
        .map(r => r[0].transcript)
        .join('')
      setText(transcript)
      if (e.results[e.results.length - 1].isFinal) setListening(false)
    }
    rec.onend = () => setListening(false)
    recognitionRef.current = rec
  }, [])

  const toggleMic = () => {
    if (!recognitionRef.current) return
    if (listening) {
      recognitionRef.current.stop()
    } else {
      setText('')
      recognitionRef.current.start()
      setListening(true)
    }
  }

  const submit = () => {
    const trimmed = text.trim()
    if (!trimmed) return
    onCommand(trimmed)
    setText('')
  }

  return (
    <div className={`bg-[#111827] rounded-xl px-3 py-2 flex gap-2 items-center border ${listening ? 'border-sky-500' : 'border-slate-800'}`}>
      <input
        type="text"
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && submit()}
        placeholder={placeholder ?? 'Type a command or speak…'}
        disabled={disabled}
        className="flex-1 bg-transparent text-slate-300 text-[11px] placeholder-slate-600 outline-none disabled:opacity-50"
      />
      <button
        onClick={toggleMic}
        disabled={disabled}
        className={`text-base disabled:opacity-40 transition-colors ${listening ? 'text-sky-400 animate-pulse' : 'text-slate-500'}`}
        title={listening ? 'Stop listening' : 'Start voice input'}
      >🎤</button>
      <button
        onClick={submit}
        disabled={disabled || !text.trim()}
        className="bg-sky-600 disabled:opacity-40 rounded-lg w-7 h-7 flex items-center justify-center text-white text-xs font-bold"
      >↑</button>
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/QtyControl.tsx src/components/CommandBar.tsx
git commit -m "feat: add QtyControl stepper and CommandBar with Web Speech API"
```

---

## Task 19: app/page.tsx — Main Scan Orchestrator

> **Parallel with Task 18**

**Files:**
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Replace src/app/page.tsx**

```tsx
'use client'

import { useState } from 'react'
import Link from 'next/link'
import PhotoCapture from '@/components/PhotoCapture'
import PipelineProgress from '@/components/PipelineProgress'
import ItemReport from '@/components/ItemReport'
import QtyControl from '@/components/QtyControl'
import CommandBar from '@/components/CommandBar'
import type { AppState, FinalReport, PipelineStage, VisionResult, RouteDecision, PredictionResult, SearchResult, CheckpointResult } from '@/types'

const INITIAL_STAGES: PipelineStage[] = [
  { id: 1, label: 'Vision Extraction',  status: 'pending', detail: null },
  { id: 2, label: 'Prediction',          status: 'pending', detail: null },
  { id: 3, label: 'Price Search',        status: 'pending', detail: null },
  { id: 4, label: 'Verification',        status: 'pending', detail: null },
  { id: 5, label: 'Report Assembly',     status: 'pending', detail: null },
  { id: 6, label: 'Save to Notion',      status: 'pending', detail: null },
]

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${path} failed: ${res.status}`)
  return res.json() as Promise<T>
}

export default function ScanPage() {
  const [appState, setAppState] = useState<AppState>('capture')
  const [photos, setPhotos] = useState<string[]>([])
  const [stages, setStages] = useState<PipelineStage[]>(INITIAL_STAGES)
  const [report, setReport] = useState<FinalReport | null>(null)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)
  const [saving, setSaving] = useState(false)
  const [clarification, setClarification] = useState<string | null>(null)

  const setStage = (id: number, status: PipelineStage['status'], detail?: string) =>
    setStages(prev => prev.map(s => s.id === id ? { ...s, status, detail: detail ?? s.detail } : s))

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 4000)
  }

  const runPipeline = async () => {
    if (photos.length === 0) return
    setAppState('running')
    setStages(INITIAL_STAGES)
    setClarification(null)

    try {
      // Stage 1 — Vision
      setStage(1, 'running', 'Analyzing images…')
      const { vision, route } = await post<{ vision: VisionResult; route: RouteDecision }>('/api/vision', { images: photos })
      setStage(1, 'done', `${vision.brand ?? vision.product_category} · ${(vision.confidence * 100).toFixed(0)}% conf`)

      // Route C — unclear image
      if (route.route === 'C') {
        setClarification(route.message ?? 'Image unclear — please retake.')
        setAppState('capture')
        return
      }

      // Stage 2 — Prediction (Route B only)
      let productName: string = vision.brand ?? vision.product_category
      let prediction: PredictionResult | null = null
      if (route.route === 'B') {
        setStage(2, 'running', 'Predicting product…')
        const predRes = await post<{ prediction: PredictionResult }>('/api/predict', vision)
        prediction = predRes.prediction
        productName = predRes.prediction.prediction.product_name
        setStage(2, 'done', productName)
      } else {
        setStage(2, 'skipped', 'Skipped — high confidence')
      }

      // Stage 3 — Search
      setStage(3, 'running', 'Searching prices…')
      const search = await post<SearchResult>('/api/search', { productName })
      setStage(3, 'done', `${search.sources.length} sources · avg $${search.avg}`)

      // Stage 4 — Verification (CP1 + CP2)
      setStage(4, 'running', 'Verifying…')
      const [cp1, cp2] = await Promise.all([
        post<CheckpointResult>('/api/verify', { checkpoint: 1, vision }),
        post<CheckpointResult>('/api/verify', { checkpoint: 2, productName, search }),
      ])
      const cp2Clean = cp2.clean_sources?.length ?? search.sources.length
      setStage(4, 'done', `CP1: ${cp1.passed ? '✓' : '⚠'} · CP2: ${cp2Clean} clean sources`)

      // Stage 5 — Report
      setStage(5, 'running', 'Assembling report…')
      const finalReport = await post<FinalReport>('/api/report', { vision, prediction, search, cp1, cp2 })
      setStage(5, 'done', finalReport.notion_json.ItemName)
      setReport(finalReport)
      setAppState('report')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Pipeline error'
      setStages(prev => prev.map(s => s.status === 'running' ? { ...s, status: 'error', detail: msg } : s))
      showToast(`❌ ${msg}`, false)
      setAppState('capture')
    }
  }

  const handleSave = async (qty: number) => {
    if (!report) return
    setSaving(true)
    setStage(6, 'running', `Saving qty ${qty}…`)
    try {
      const res = await post<{ message: string }>('/api/notion', {
        action: 'insert',
        item: report.notion_json,
        qty,
      })
      setStage(6, 'done', 'Saved ✓')
      showToast(res.message)
      setAppState('saved')
    } catch (err) {
      setStage(6, 'error', 'Save failed')
      showToast(`❌ ${err instanceof Error ? err.message : 'Save failed'}`, false)
    } finally {
      setSaving(false)
    }
  }

  const handleCommand = async (text: string) => {
    const res = await post<ReturnType<typeof Object.create>>('/api/command', { text })
    switch (res.action) {
      case 'save':
        if (report && res.qty) await handleSave(res.qty)
        break
      case 'navigate':
        window.location.href = res.destination ?? '/inventory'
        break
      case 'rescan':
        reset()
        break
      case 'unknown':
        showToast(`Unknown command: "${text}"`, false)
        break
    }
  }

  const reset = () => {
    setAppState('capture')
    setPhotos([])
    setStages(INITIAL_STAGES)
    setReport(null)
    setClarification(null)
  }

  const isAnalyzing = appState === 'running'

  return (
    <main className="max-w-md mx-auto px-3 pt-3 pb-28 min-h-screen">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-sky-400 font-black text-base tracking-tight">📦 InvScan</h1>
        <div className="flex items-center gap-2">
          {isAnalyzing && (
            <span className="text-amber-400 text-[10px] font-bold animate-pulse">● ANALYZING</span>
          )}
          {appState === 'report' && (
            <span className="text-emerald-400 text-[10px] font-bold">✓ DONE</span>
          )}
          <Link href="/inventory" className="bg-[#1e293b] rounded-full px-3 py-1 text-slate-400 text-[10px]">
            History
          </Link>
        </div>
      </div>

      {/* Clarification message (Route C) */}
      {clarification && (
        <div className="bg-amber-900/30 border border-amber-700 rounded-xl p-3 mb-3 text-amber-300 text-xs">
          {clarification}
        </div>
      )}

      {/* STATE 1: Capture */}
      {appState === 'capture' && (
        <>
          <PhotoCapture onPhotosChange={setPhotos} disabled={isAnalyzing} />
          <button
            onClick={runPipeline}
            disabled={photos.length === 0}
            className="w-full bg-gradient-to-br from-sky-600 to-violet-600 disabled:opacity-40 rounded-xl py-3 text-white font-black text-sm mb-2"
          >
            ⚡ Analyze Items
            {photos.length > 0 && <span className="text-xs font-normal ml-1 opacity-70">{photos.length} photo{photos.length > 1 ? 's' : ''} ready</span>}
          </button>
        </>
      )}

      {/* STATE 2: Running */}
      {appState === 'running' && (
        <PipelineProgress stages={stages} />
      )}

      {/* STATE 3: Report */}
      {(appState === 'report' || appState === 'saved') && report && (
        <>
          <PipelineProgress stages={stages} />
          <ItemReport report={report} />
          {appState === 'report' && (
            <QtyControl onSave={handleSave} saving={saving} />
          )}
          {appState === 'saved' && (
            <button
              onClick={reset}
              className="w-full bg-[#1e293b] rounded-xl py-2.5 text-slate-300 text-sm font-bold mb-2"
            >
              📷 Scan Another Item
            </button>
          )}
        </>
      )}

      {/* Toast notification */}
      {toast && (
        <div className={`fixed bottom-24 left-3 right-3 max-w-md mx-auto rounded-xl px-4 py-2.5 text-sm font-bold shadow-lg z-40 ${toast.ok ? 'bg-emerald-600 text-white' : 'bg-red-700 text-white'}`}>
          {toast.msg}
        </div>
      )}

      {/* Persistent Command Bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-[#0a0a0f]/95 backdrop-blur-sm px-3 pt-2 pb-4 max-w-md mx-auto">
        <CommandBar
          onCommand={handleCommand}
          placeholder={appState === 'report' ? '"save qty 50" or speak…' : 'Type a command or speak…'}
        />
      </div>
    </main>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: build main scan page — 3-state pipeline orchestrator"
```

---

## Task 20: app/inventory/page.tsx — Inventory List

**Files:**
- Create: `src/app/inventory/page.tsx`

- [ ] **Step 1: Create src/app/inventory/page.tsx**

```tsx
'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import type { InventoryItem } from '@/types'

export default function InventoryPage() {
  const [items, setItems] = useState<InventoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/notion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'query' }),
      })
      const data = await res.json() as { items: InventoryItem[] }
      setItems(data.items)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const filtered = items.filter(item =>
    search === '' ||
    item.ItemName.toLowerCase().includes(search.toLowerCase()) ||
    item.Manufacturer.toLowerCase().includes(search.toLowerCase()) ||
    item.itemId.toLowerCase().includes(search.toLowerCase())
  )

  const handleArchive = async (itemId: string, name: string) => {
    if (!confirm(`Archive ${name} (${itemId})? This cannot be undone easily.`)) return
    await fetch('/api/notion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'archive', itemId }),
    })
    setToast(`🗑️ Archived — ${itemId}`)
    setTimeout(() => setToast(null), 3000)
    await load()
  }

  return (
    <main className="max-w-md mx-auto px-3 pt-3 pb-8 min-h-screen">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <Link href="/" className="text-slate-500 text-xl">←</Link>
        <h1 className="text-sky-400 font-black text-base flex-1">📋 Inventory</h1>
        <button onClick={load} className="text-slate-500 text-sm">↻</button>
      </div>

      {/* Search */}
      <input
        type="text"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search by name, manufacturer, or ID…"
        className="w-full bg-[#111827] border border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-300 placeholder-slate-600 outline-none mb-3"
      />

      {loading && (
        <p className="text-slate-500 text-sm text-center py-8">Loading…</p>
      )}

      {!loading && filtered.length === 0 && (
        <p className="text-slate-500 text-sm text-center py-8">
          {search ? 'No items match your search.' : 'No inventory items yet. Scan your first item!'}
        </p>
      )}

      {/* Item list */}
      <div className="space-y-2">
        {filtered.map(item => (
          <div key={item.itemId} className="bg-[#111827] rounded-xl overflow-hidden border border-slate-800">
            {/* Card header */}
            <button
              className="w-full px-3 py-2.5 flex items-center gap-3 text-left"
              onClick={() => setExpanded(expanded === item.itemId ? null : item.itemId)}
            >
              <div className="flex-1 min-w-0">
                <p className="text-slate-200 text-xs font-semibold truncate">{item.ItemName}</p>
                <div className="flex gap-2 mt-0.5">
                  <span className="text-slate-500 text-[10px]">{item.itemId}</span>
                  <span className="text-sky-400 text-[10px]">${item.Market_Price}</span>
                  <span className="text-slate-500 text-[10px]">Qty: {item.Qty ?? '—'}</span>
                </div>
              </div>
              <span className="text-slate-600 text-xs">{expanded === item.itemId ? '▲' : '▼'}</span>
            </button>

            {/* Expanded detail */}
            {expanded === item.itemId && (
              <div className="px-3 pb-3 border-t border-slate-800 pt-2">
                <div className="grid grid-cols-2 gap-1 text-[10px] mb-2">
                  {[
                    ['Manufacturer', item.Manufacturer],
                    ['Origin', item.Item_Origin || '—'],
                    ['Length', item.Length || '—'],
                    ['Width', item.Width || '—'],
                    ['Currency', item.Currency],
                    ['Ext Price', item.Ext_Price ? `$${item.Ext_Price}` : '—'],
                  ].map(([k, v]) => (
                    <div key={k} className="bg-[#0f172a] rounded px-2 py-1">
                      <span className="text-slate-500">{k}: </span>
                      <span className="text-slate-300">{v}</span>
                    </div>
                  ))}
                </div>
                <p className="text-[9px] text-slate-500 leading-relaxed mb-2">{item.Notes}</p>
                <button
                  onClick={() => handleArchive(item.itemId, item.ItemName)}
                  className="w-full bg-red-900/30 border border-red-800 rounded-lg py-1.5 text-red-400 text-[10px] font-bold"
                >
                  🗑️ Archive Item
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-3 right-3 max-w-md mx-auto bg-slate-700 text-white rounded-xl px-4 py-2.5 text-sm text-center shadow-lg z-40">
          {toast}
        </div>
      )}
    </main>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/inventory/page.tsx
git commit -m "feat: add inventory list page with search and archive"
```

---

## Task 21: Config — .env.local.example + next.config.ts

**Files:**
- Create: `.env.local.example`
- Modify: `next.config.ts`
- Modify: `.gitignore`

- [ ] **Step 1: Create .env.local.example**

```bash
# RunPod (primary inference)
RUNPOD_API_KEY=
RUNPOD_VISION_ENDPOINT_ID=
RUNPOD_REASONING_ENDPOINT_ID=
RUNPOD_BASE_URL=https://api.runpod.ai/v2
RUNPOD_TIMEOUT_MS=90000

# HuggingFace (fallback inference)
HF_API_KEY=
HF_BASE_URL=https://router.huggingface.co/v1/chat/completions

# Notion
NOTION_API_KEY=
NOTION_DATABASE_ID=

# Search + Scrape
TAVILY_API_KEY=
FIRECRAWL_API_KEY=
```

- [ ] **Step 2: Update next.config.ts to allow external image domains**

Replace `next.config.ts`:
```typescript
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  images: {
    // Allow Tavily image search results to be displayed
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
    ],
  },
}

export default nextConfig
```

- [ ] **Step 3: Ensure .env.local is gitignored**

Check `.gitignore` contains `.env.local` — it should already be there from the Next.js template. If not, add it:

```
# Add if not present:
.env.local
```

- [ ] **Step 4: Run full test suite**

```bash
npm test
```

Expected: All test suites PASS (types, inference, itemId, notion, command)

- [ ] **Step 5: Run dev server to verify it starts**

```bash
npm run dev
```

Expected: `▲ Next.js 16.x.x — ready on http://localhost:3000` — no compilation errors

- [ ] **Step 6: Final commit**

```bash
git add .env.local.example next.config.ts .gitignore
git commit -m "feat: add env config template and allow remote images"
```

---

## Summary

| Wave | Tasks | Can Parallelize |
|---|---|---|
| 0 | 1 → 2 → 3 | No — each depends on previous |
| 1 | 4, 5, 6 | Yes — all independent service libs |
| 2 | 7, 8 | Yes — independent API routes |
| 3 | 9 → 10 → 11 | No — pipeline order |
| 4 | 12, 13 | Yes — independent endpoints |
| 5 | 14 | No — foundation for UI |
| 6 | 15, 16, 17 | Yes — independent components |
| 7 | 18, 19 | Yes — independent |
| 8 | 20 → 21 | No — page then config |

**Total files created/modified:** 28  
**Total tests:** 21 assertions across 5 test suites  
**Commit count:** 21 atomic commits
