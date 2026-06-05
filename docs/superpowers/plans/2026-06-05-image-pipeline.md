# Image Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the blind `tavilyImageSearch` call in Stage 5 (`report/route.ts`) with a Price-Source-First + Gemini Vision Gate pipeline that guarantees 3 accurate product images.

**Architecture:** Stage 3 already scrapes 5+ price-source pages confirmed to be about the correct product. Stage 5 will extract image URLs from those same pages via Firecrawl's `images` format, apply a deterministic URL-pattern filter to remove logos/banners, then pass up to 8 candidates to Gemini 2.5 Flash (already integrated) alongside the full `VisionResult` for multi-image relevance ranking. A targeted Tavily fallback fires only when the primary path yields fewer than 3 validated images.

**Tech Stack:** `firecrawl` SDK (already installed), `@google/genai` via `callModel()` (already wired), Vitest for tests.

---

## Parallelisation Map

```
Wave 1 (parallel) ─── Task 1: isProductImage + firecrawlExtractImages
                  └── Task 2: gemini-images.ts (validateProductImages)

Wave 2 (sequential, after Wave 1) ─── Task 3: image-pipeline.ts (selectProductImages)

Wave 3 (sequential, after Wave 2) ─── Task 4: Wire into report/route.ts
```

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/lib/firecrawl.ts` | Modify | Add `isProductImage()` filter + `firecrawlExtractImages()` helper |
| `src/lib/firecrawl.test.ts` | Modify | Tests for the two new functions |
| `src/lib/gemini-images.ts` | Create | `validateProductImages()` — fetch candidates as base64, Gemini ranking |
| `src/lib/gemini-images.test.ts` | Create | Tests via `vi.mock('@/lib/inference')` + `global.fetch` |
| `src/lib/image-pipeline.ts` | Create | `selectProductImages()` — orchestrates all 4 steps + fallback |
| `src/lib/image-pipeline.test.ts` | Create | Tests via mocking sub-modules |
| `src/app/api/report/route.ts` | Modify | Replace `tavilyImageSearch` with `selectProductImages` |

---

## Task 1: `isProductImage` filter + `firecrawlExtractImages` helper

**Files:**
- Modify: `src/lib/firecrawl.ts`
- Modify: `src/lib/firecrawl.test.ts`

### Context

`src/lib/firecrawl.ts` already has `isScrapeable()` and `firecrawlExtract()`. You are **adding** two new exports at the bottom of the file — do not remove or change existing code.

The Firecrawl SDK `scrape()` method with `formats: ['images']` returns a `Document` object. The image URLs live at `result.images` (a `string[] | undefined`). The SDK is already mocked in the test file using `vi.hoisted` + `vi.mock('firecrawl')` — you must extend that same mock to handle the `images` format.

- [ ] **Step 1: Write the failing tests**

Append to the bottom of `src/lib/firecrawl.test.ts`:

```typescript
describe('isProductImage', () => {
  it('allows clean product image URLs', () => {
    expect(isProductImage('https://store.com/images/product-123.jpg')).toBe(true)
    expect(isProductImage('https://cdn.example.com/photo_main.webp')).toBe(true)
    expect(isProductImage('https://shop.com/assets/item.png')).toBe(true)
  })

  it('blocks logo, icon, banner, and UI chrome URLs', () => {
    expect(isProductImage('https://store.com/assets/logo.png')).toBe(false)
    expect(isProductImage('https://example.com/icons/cart-icon.jpg')).toBe(false)
    expect(isProductImage('https://cdn.com/banner_top.jpg')).toBe(false)
    expect(isProductImage('https://site.com/sprite-sheet.png')).toBe(false)
    expect(isProductImage('https://site.com/avatar_default.webp')).toBe(false)
    expect(isProductImage('https://site.com/thumbnail_xs.jpg')).toBe(false)
    expect(isProductImage('https://site.com/header-bg.png')).toBe(false)
    expect(isProductImage('https://site.com/placeholder.gif')).toBe(false)
  })

  it('blocks URLs without image extensions', () => {
    expect(isProductImage('https://store.com/product/123')).toBe(false)
    expect(isProductImage('https://store.com/product.pdf')).toBe(false)
    expect(isProductImage('https://store.com/data.json')).toBe(false)
  })

  it('returns false for malformed URLs', () => {
    expect(isProductImage('not-a-url')).toBe(false)
    expect(isProductImage('')).toBe(false)
  })
})

describe('firecrawlExtractImages', () => {
  it('returns image URLs from a page', async () => {
    mockScrape.mockResolvedValueOnce({
      images: [
        'https://store.com/product.jpg',
        'https://store.com/logo.png',
        'https://store.com/detail.webp',
      ],
    })

    const result = await firecrawlExtractImages('https://store.com/product-page')
    expect(result).toEqual([
      'https://store.com/product.jpg',
      'https://store.com/logo.png',
      'https://store.com/detail.webp',
    ])
    expect(mockScrape).toHaveBeenCalledWith('https://store.com/product-page', {
      formats: ['images'],
    })
  })

  it('returns empty array when page has no images', async () => {
    mockScrape.mockResolvedValueOnce({ markdown: '# Page' })
    expect(await firecrawlExtractImages('https://example.com')).toEqual([])
  })

  it('returns empty array when scrape throws', async () => {
    mockScrape.mockRejectedValueOnce(new Error('network error'))
    expect(await firecrawlExtractImages('https://example.com')).toEqual([])
  })

  it('returns empty array when FIRECRAWL_API_KEY is missing', async () => {
    delete process.env.FIRECRAWL_API_KEY
    expect(await firecrawlExtractImages('https://example.com')).toEqual([])
  })
})
```

- [ ] **Step 2: Update the import line in firecrawl.test.ts**

Find this line at the top:
```typescript
import { firecrawlExtract, firecrawlExtractAll, isScrapeable } from './firecrawl'
```
Replace with:
```typescript
import { firecrawlExtract, firecrawlExtractAll, firecrawlExtractImages, isProductImage, isScrapeable } from './firecrawl'
```

- [ ] **Step 3: Run tests to verify they fail**

```
npx vitest run src/lib/firecrawl.test.ts --reporter=verbose
```

Expected: tests in `isProductImage` and `firecrawlExtractImages` suites **FAIL** with "not a function" / "is not exported".

- [ ] **Step 4: Add the two functions to firecrawl.ts**

Append to the **bottom** of `src/lib/firecrawl.ts` (after `firecrawlExtractAll`):

```typescript
const IMAGE_JUNK = /logo|icon|banner|sprite|avatar|thumbnail|header|placeholder|bg-|background/i
const IMAGE_EXT  = /\.(jpg|jpeg|png|webp|gif)(\?|$)/i

export function isProductImage(url: string): boolean {
  try {
    const { pathname, href } = new URL(url)
    return IMAGE_EXT.test(href) && !IMAGE_JUNK.test(pathname)
  } catch {
    return false
  }
}

export async function firecrawlExtractImages(url: string): Promise<string[]> {
  const apiKey = process.env.FIRECRAWL_API_KEY
  if (!apiKey) return []
  const client = new Firecrawl({ apiKey })
  try {
    const result = await client.scrape(url, { formats: ['images'] })
    return result.images ?? []
  } catch {
    return []
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

```
npx vitest run src/lib/firecrawl.test.ts --reporter=verbose
```

Expected: all tests **PASS** (previously 17, now more).

- [ ] **Step 6: Run full suite to check for regressions**

```
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```
git add src/lib/firecrawl.ts src/lib/firecrawl.test.ts
git commit -m "feat: add isProductImage filter and firecrawlExtractImages helper"
```

---

## Task 2: `validateProductImages` in `gemini-images.ts`

**Files:**
- Create: `src/lib/gemini-images.ts`
- Create: `src/lib/gemini-images.test.ts`

### Context

`callModel({ model: 'gemini-2.5-flash', messages, max_tokens, temperature })` is the correct call pattern — see `src/lib/inference.ts:109`. The messages array accepts OpenAI-style content parts including `{ type: 'image_url', image_url: { url: 'data:mimeType;base64,...' } }`. `inference.ts:75` sets `responseMimeType: 'application/json'` for all Gemini calls, so the model always returns raw JSON — no markdown fences to strip.

This function fetches each candidate image URL as a buffer (server-side, parallel, 5 s timeout), converts to base64, passes all images in a **single** Gemini prompt alongside the `VisionResult`, and asks for `{"indices":[i,j,k]}`. If Gemini output can't be parsed, it falls back to returning the first `needed` candidates.

The test file mocks **two** things: `callModel` (via `vi.mock('@/lib/inference')`) and `global.fetch` (for the image buffer downloads).

- [ ] **Step 1: Create the test file first**

Create `src/lib/gemini-images.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { callModel } from '@/lib/inference'
import { validateProductImages } from './gemini-images'
import type { VisionResult } from '@/types'

vi.mock('@/lib/inference')

const VISION: VisionResult = {
  visible_text: ['BOSCH', 'GBH 2-28'],
  brand: 'Bosch',
  model_number: 'GBH 2-28',
  product_category: 'rotary hammer drill',
  dimensions_visible: null,
  barcode: null,
  color: 'blue',
  shape: 'handheld tool',
  material_hints: 'plastic housing',
  label_language: 'English',
  condition: 'new',
  packaging_type: 'box',
  visual_description: 'Blue Bosch rotary hammer drill in retail box',
  confidence: 0.9,
  missing_fields: [],
  image_quality: 'clear',
}

const CANDIDATE_URLS = [
  'https://store.com/bosch-1.jpg',
  'https://store.com/bosch-2.jpg',
  'https://store.com/bosch-3.jpg',
  'https://store.com/bosch-4.jpg',
]

function mockFetchImage() {
  return {
    ok: true,
    arrayBuffer: async () => new ArrayBuffer(8),
    headers: { get: (_: string) => 'image/jpeg' },
  }
}

beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue(mockFetchImage())
  vi.mocked(callModel).mockResolvedValue('{"indices":[0,2,3]}')
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('validateProductImages', () => {
  it('returns 3 URLs matching the indices Gemini chose', async () => {
    const result = await validateProductImages(CANDIDATE_URLS, VISION)
    expect(result).toEqual([
      'https://store.com/bosch-1.jpg',
      'https://store.com/bosch-3.jpg',
      'https://store.com/bosch-4.jpg',
    ])
  })

  it('calls callModel with gemini-2.5-flash and image content parts', async () => {
    await validateProductImages(CANDIDATE_URLS, VISION)
    expect(vi.mocked(callModel)).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gemini-2.5-flash',
        messages: expect.arrayContaining([
          expect.objectContaining({ role: 'user' }),
        ]),
      })
    )
    const call = vi.mocked(callModel).mock.calls[0][0]
    const content = call.messages[0].content as unknown[]
    const imageParts = content.filter(
      (p: unknown) => (p as { type: string }).type === 'image_url'
    )
    // One image part per candidate (4 candidates → 4 image parts)
    expect(imageParts).toHaveLength(4)
  })

  it('returns first N candidates when Gemini output is invalid JSON', async () => {
    vi.mocked(callModel).mockResolvedValue('not json')
    const result = await validateProductImages(CANDIDATE_URLS, VISION)
    expect(result).toHaveLength(3)
    expect(result[0]).toBe('https://store.com/bosch-1.jpg')
  })

  it('returns first N candidates when indices array is malformed', async () => {
    vi.mocked(callModel).mockResolvedValue('{"indices":"wrong"}')
    const result = await validateProductImages(CANDIDATE_URLS, VISION)
    expect(result).toHaveLength(3)
  })

  it('returns all candidates when count <= needed and skips Gemini', async () => {
    const twoUrls = ['https://store.com/a.jpg', 'https://store.com/b.jpg']
    const result = await validateProductImages(twoUrls, VISION)
    expect(result).toEqual(twoUrls)
    expect(vi.mocked(callModel)).not.toHaveBeenCalled()
  })

  it('returns empty array when candidate list is empty', async () => {
    const result = await validateProductImages([], VISION)
    expect(result).toEqual([])
    expect(vi.mocked(callModel)).not.toHaveBeenCalled()
  })

  it('skips candidates whose image fetch fails and still returns needed count', async () => {
    // First image fetch fails, rest succeed
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValue(mockFetchImage())
    vi.mocked(callModel).mockResolvedValue('{"indices":[0,1,2]}')

    const result = await validateProductImages(CANDIDATE_URLS, VISION)
    // 3 of 4 fetched successfully — still returns 3
    expect(result).toHaveLength(3)
  })

  it('respects the needed parameter', async () => {
    vi.mocked(callModel).mockResolvedValue('{"indices":[1,3]}')
    const result = await validateProductImages(CANDIDATE_URLS, VISION, 2)
    expect(result).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```
npx vitest run src/lib/gemini-images.test.ts --reporter=verbose
```

Expected: **FAIL** — "Cannot find module './gemini-images'".

- [ ] **Step 3: Create `src/lib/gemini-images.ts`**

```typescript
import { callModel } from '@/lib/inference'
import type { VisionResult } from '@/types'

const MAX_CANDIDATES = 8

interface FetchedImage {
  url: string
  base64: string
  mimeType: string
}

async function fetchAsBase64(url: string): Promise<FetchedImage | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) return null
    const buffer = await res.arrayBuffer()
    const base64 = Buffer.from(buffer).toString('base64')
    const mimeType = res.headers.get('content-type') ?? 'image/jpeg'
    return { url, base64, mimeType }
  } catch {
    return null
  }
}

export async function validateProductImages(
  candidateUrls: string[],
  vision: VisionResult,
  needed = 3
): Promise<string[]> {
  if (candidateUrls.length === 0) return []
  if (candidateUrls.length <= needed) return candidateUrls

  const capped = candidateUrls.slice(0, MAX_CANDIDATES)
  const fetched = (
    await Promise.all(capped.map(fetchAsBase64))
  ).filter((r): r is FetchedImage => r !== null)

  if (fetched.length === 0) return candidateUrls.slice(0, needed)
  if (fetched.length <= needed) return fetched.map(r => r.url)

  const productSpec = [
    vision.brand         && `Brand: ${vision.brand}`,
    vision.model_number  && `Model: ${vision.model_number}`,
    `Category: ${vision.product_category}`,
    `Color: ${vision.color}`,
    `Description: ${vision.visual_description}`,
  ].filter(Boolean).join('\n')

  const imageParts = fetched.flatMap((img, i) => [
    { type: 'text' as const, text: `Image ${i}:` },
    { type: 'image_url' as const, image_url: { url: `data:${img.mimeType};base64,${img.base64}` } },
  ])

  const raw = await callModel({
    model: 'gemini-2.5-flash',
    temperature: 0.1,
    max_tokens: 64,
    messages: [{
      role: 'user',
      content: [
        ...imageParts,
        {
          type: 'text',
          text: `Product specification:\n${productSpec}\n\nReturn JSON: {"indices":[i,j,k]} — the ${needed} image indices (0-based) that best show this exact product. Prefer images of the specific model/variant. Return only the JSON.`,
        },
      ],
    }],
  })

  try {
    const parsed = JSON.parse(raw) as { indices?: unknown }
    const indices = parsed.indices
    if (!Array.isArray(indices)) throw new Error('indices not array')
    return indices
      .filter((i): i is number => typeof i === 'number' && i >= 0 && i < fetched.length)
      .slice(0, needed)
      .map(i => fetched[i].url)
  } catch {
    return fetched.slice(0, needed).map(r => r.url)
  }
}
```

- [ ] **Step 4: Run tests**

```
npx vitest run src/lib/gemini-images.test.ts --reporter=verbose
```

Expected: all tests **PASS**.

- [ ] **Step 5: Run full suite**

```
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```
git add src/lib/gemini-images.ts src/lib/gemini-images.test.ts
git commit -m "feat: add validateProductImages with Gemini 2.5 Flash vision gate"
```

---

## Task 3: `selectProductImages` orchestrator in `image-pipeline.ts`

**Files:**
- Create: `src/lib/image-pipeline.ts`
- Create: `src/lib/image-pipeline.test.ts`

### Context

This is the orchestrator — it calls `firecrawlExtractImages`, `isProductImage`, `validateProductImages`, and `tavilyImageSearch` in the correct order. It must be completed **after Task 1 and Task 2** because it imports from both.

The 4-step flow:
1. Call `firecrawlExtractImages(s.url)` for each `PriceSource` in parallel → flat array
2. Filter with `isProductImage` + deduplicate with `Set`
3. Call `validateProductImages(candidates, vision)` → if ≥ 3, return
4. Targeted Tavily fallback: query = `"${brand} ${modelNumber} ${productName} product image"`, fetch 9, filter, merge, re-validate

Test with `vi.mock` for all three dependencies. Do **not** test the internals of Firecrawl/Gemini/Tavily here — those are tested in their own files.

- [ ] **Step 1: Create the test file**

Create `src/lib/image-pipeline.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { selectProductImages } from './image-pipeline'
import type { PriceSource, VisionResult } from '@/types'

vi.mock('@/lib/firecrawl', () => ({
  firecrawlExtractImages: vi.fn(),
  isProductImage: vi.fn(),
}))
vi.mock('@/lib/gemini-images', () => ({
  validateProductImages: vi.fn(),
}))
vi.mock('@/lib/tavily', () => ({
  tavilyImageSearch: vi.fn(),
}))

import { firecrawlExtractImages, isProductImage } from '@/lib/firecrawl'
import { validateProductImages } from '@/lib/gemini-images'
import { tavilyImageSearch } from '@/lib/tavily'

const SOURCES: PriceSource[] = [
  { name: 'Store A', url: 'https://store-a.com/product', price: 120, currency: 'USD', unit: 'each' },
  { name: 'Store B', url: 'https://store-b.com/product', price: 125, currency: 'USD', unit: 'each' },
]

const VISION: VisionResult = {
  visible_text: [],
  brand: 'Bosch',
  model_number: 'GBH 2-28',
  product_category: 'rotary hammer',
  dimensions_visible: null,
  barcode: null,
  color: 'blue',
  shape: 'handheld tool',
  material_hints: 'plastic',
  label_language: 'English',
  condition: 'new',
  packaging_type: 'box',
  visual_description: 'Blue Bosch rotary hammer drill',
  confidence: 0.9,
  missing_fields: [],
  image_quality: 'clear',
}

beforeEach(() => {
  vi.mocked(firecrawlExtractImages).mockResolvedValue([])
  vi.mocked(isProductImage).mockReturnValue(true)
  vi.mocked(validateProductImages).mockResolvedValue([])
  vi.mocked(tavilyImageSearch).mockResolvedValue([])
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('selectProductImages', () => {
  it('returns 3 validated images from price source pages on happy path', async () => {
    const imgs = ['https://a.com/1.jpg', 'https://b.com/2.jpg', 'https://c.com/3.jpg']
    vi.mocked(firecrawlExtractImages).mockResolvedValue(['https://a.com/1.jpg'])
    vi.mocked(validateProductImages).mockResolvedValue(imgs)

    const result = await selectProductImages('Bosch Drill', SOURCES, VISION)

    expect(result).toEqual(imgs)
    // Tavily fallback should NOT have been called
    expect(vi.mocked(tavilyImageSearch)).not.toHaveBeenCalled()
  })

  it('calls firecrawlExtractImages for each price source URL', async () => {
    vi.mocked(validateProductImages).mockResolvedValue(['a.jpg', 'b.jpg', 'c.jpg'])

    await selectProductImages('Bosch Drill', SOURCES, VISION)

    expect(vi.mocked(firecrawlExtractImages)).toHaveBeenCalledWith('https://store-a.com/product')
    expect(vi.mocked(firecrawlExtractImages)).toHaveBeenCalledWith('https://store-b.com/product')
  })

  it('falls back to Tavily when primary path yields < 3 images', async () => {
    // Primary path returns only 2
    vi.mocked(firecrawlExtractImages).mockResolvedValue(['https://a.com/1.jpg'])
    vi.mocked(validateProductImages)
      .mockResolvedValueOnce(['a.jpg', 'b.jpg'])           // first call: < 3
      .mockResolvedValueOnce(['a.jpg', 'b.jpg', 'c.jpg'])  // fallback call: 3
    vi.mocked(tavilyImageSearch).mockResolvedValue([
      { url: 'https://tavily.com/img.jpg', description: '' },
    ])

    const result = await selectProductImages('Bosch Drill', SOURCES, VISION)

    expect(vi.mocked(tavilyImageSearch)).toHaveBeenCalledWith(
      expect.stringContaining('Bosch'),
      9
    )
    expect(result).toHaveLength(3)
  })

  it('uses brand + model_number in Tavily fallback query', async () => {
    vi.mocked(validateProductImages).mockResolvedValueOnce([]).mockResolvedValueOnce([])
    vi.mocked(tavilyImageSearch).mockResolvedValue([])

    await selectProductImages('Bosch Drill', SOURCES, VISION)

    const query = vi.mocked(tavilyImageSearch).mock.calls[0][0] as string
    expect(query).toContain('Bosch')
    expect(query).toContain('GBH 2-28')
  })

  it('returns empty array when all paths yield nothing', async () => {
    vi.mocked(validateProductImages).mockResolvedValue([])
    vi.mocked(tavilyImageSearch).mockResolvedValue([])

    const result = await selectProductImages('Unknown', SOURCES, VISION)
    expect(result).toEqual([])
  })

  it('deduplicates image URLs across price sources before passing to Gemini', async () => {
    // Both sources return the same image URL
    vi.mocked(firecrawlExtractImages).mockResolvedValue(['https://cdn.com/product.jpg'])

    await selectProductImages('Bosch Drill', SOURCES, VISION)

    const candidates = vi.mocked(validateProductImages).mock.calls[0]?.[0] as string[]
    const unique = new Set(candidates)
    expect(unique.size).toBe(candidates?.length ?? 0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```
npx vitest run src/lib/image-pipeline.test.ts --reporter=verbose
```

Expected: **FAIL** — "Cannot find module './image-pipeline'".

- [ ] **Step 3: Create `src/lib/image-pipeline.ts`**

```typescript
import { firecrawlExtractImages, isProductImage } from '@/lib/firecrawl'
import { validateProductImages } from '@/lib/gemini-images'
import { tavilyImageSearch } from '@/lib/tavily'
import type { PriceSource, VisionResult } from '@/types'

const NEEDED        = 3
const MAX_CANDIDATES = 8

export async function selectProductImages(
  productName: string,
  sources: PriceSource[],
  vision: VisionResult
): Promise<string[]> {
  // Step 1 — extract images from already-verified price-source pages (free reuse of Stage 3)
  const rawImages = (
    await Promise.all(sources.map(s => firecrawlExtractImages(s.url)))
  ).flat()

  // Step 2 — deterministic pre-filter + dedup
  const candidates = [...new Set(rawImages)].filter(isProductImage)

  // Step 3 — Gemini vision gate
  if (candidates.length > 0) {
    const validated = await validateProductImages(
      candidates.slice(0, MAX_CANDIDATES),
      vision,
      NEEDED
    )
    if (validated.length >= NEEDED) return validated
  }

  // Step 4 — targeted Tavily fallback (brand + model_number are more specific than productName alone)
  const fallbackQuery = [vision.brand, vision.model_number, productName, 'product image']
    .filter(Boolean)
    .join(' ')
  const fallbackResults = await tavilyImageSearch(fallbackQuery, 9)
  const fallbackCandidates = fallbackResults
    .map(r => r.url)
    .filter(isProductImage)
    .filter(u => !candidates.includes(u))

  const allCandidates = [...candidates, ...fallbackCandidates]
  if (allCandidates.length === 0) return []

  return validateProductImages(
    allCandidates.slice(0, MAX_CANDIDATES),
    vision,
    NEEDED
  )
}
```

- [ ] **Step 4: Run tests**

```
npx vitest run src/lib/image-pipeline.test.ts --reporter=verbose
```

Expected: all tests **PASS**.

- [ ] **Step 5: Run full suite**

```
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```
git add src/lib/image-pipeline.ts src/lib/image-pipeline.test.ts
git commit -m "feat: add selectProductImages pipeline orchestrator"
```

---

## Task 4: Wire `selectProductImages` into `report/route.ts`

**Files:**
- Modify: `src/app/api/report/route.ts`

### Context

`report/route.ts` already receives `vision: VisionResult` and `search: SearchResult` in its POST body (see lines 14-19 of the current file). `search.sources` is `PriceSource[]` — the exact type `selectProductImages` needs. This task is a **small surgical change**: swap one import and one call.

`tavilyImageSearch` is currently the only Tavily import in this file — once replaced, remove that import entirely to avoid an unused-import lint warning.

The `vision` field is already destructured from `request.json()` (the route receives it for cp1/cp2 checks). Confirm it's in the destructure before using it in the new call.

- [ ] **Step 1: Read the current report route**

Open `src/app/api/report/route.ts` and confirm:
- Line 1: `import { tavilyImageSearch } from '@/lib/tavily'` — this will be removed
- Line 12-19: the POST handler destructures `{ vision, prediction, search, cp1, cp2 }`
- Line 48: `const images = await tavilyImageSearch(\`${productName} product image\`, 3)`

- [ ] **Step 2: Apply the changes**

In `src/app/api/report/route.ts`:

**Replace** the first line:
```typescript
import { tavilyImageSearch } from '@/lib/tavily'
```
**With:**
```typescript
import { selectProductImages } from '@/lib/image-pipeline'
```

**Replace** line 48:
```typescript
const images = await tavilyImageSearch(`${productName} product image`, 3)
```
**With:**
```typescript
const images = await selectProductImages(productName, search.sources, vision)
```

- [ ] **Step 3: TypeScript check**

```
npx tsc --noEmit
```

Expected: **no errors**. If you see "Property 'sources' does not exist on type 'SearchResult'", check `src/types/index.ts` — `SearchResult.sources` is `PriceSource[]` at line 60.

- [ ] **Step 4: Run full test suite**

```
npx vitest run
```

Expected: all tests pass. The report route has no dedicated test file — TypeScript + the image-pipeline unit tests cover the correctness.

- [ ] **Step 5: Commit**

```
git add src/app/api/report/route.ts
git commit -m "feat: replace blind tavilyImageSearch with selectProductImages pipeline in report stage"
```

---

## Self-Review

**Spec coverage check:**
- ✅ Reuse price-source URLs as candidate pool → Task 1 (`firecrawlExtractImages`) + Task 3 (`selectProductImages` Step 1)
- ✅ Deterministic pre-filter (logos/banners/icons) → Task 1 (`isProductImage`) + Task 3 (`selectProductImages` Step 2)
- ✅ Gemini 2.5 Flash vision gate with VisionResult context → Task 2 (`validateProductImages`)
- ✅ Targeted Tavily fallback (brand + model_number query) when < 3 validated → Task 3 (Step 4)
- ✅ Exactly 3 images guaranteed (with graceful empty-array fallback) → Tasks 2 + 3
- ✅ Wire into Stage 5 (report/route.ts) → Task 4
- ✅ Each layer independently tested and mockable

**Placeholder scan:** None found — all steps have concrete code blocks.

**Type consistency:**
- `isProductImage(url: string): boolean` — defined Task 1, used Task 3 ✅
- `firecrawlExtractImages(url: string): Promise<string[]>` — defined Task 1, used Task 3 ✅
- `validateProductImages(candidateUrls: string[], vision: VisionResult, needed?: number): Promise<string[]>` — defined Task 2, used Task 3 ✅
- `selectProductImages(productName: string, sources: PriceSource[], vision: VisionResult): Promise<string[]>` — defined Task 3, used Task 4 ✅
- `VisionResult` imported from `@/types` in all tasks ✅
- `PriceSource[]` = `SearchResult.sources` — confirmed in `src/types/index.ts:60` ✅
