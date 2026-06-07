import { callModel, extractJson } from '@/lib/inference'
import { extractFromText, mergeFields, missingFieldNames, type ExtractedFields } from './extract-regex'
import { fetchPageScreenshot, geminiExtractFromScreenshot } from './screenshot'
import { applyVerifyGate, ManufacturerFlag } from './verify-gate'
import { isProductPageUrl } from './url-filter'
import type { PriceSource, VisionResult } from '@/types'
import { publishEvent, type BusEvent } from './pipeline-bus'

// ─── Jina AI Reader client ────────────────────────────────────────────────

const JINA_TIMEOUT_MS = 15_000
export const JINA_MAX_CHARS = 12_000
const JINA_TOKEN_BUDGET = '10000'

/** Text format fetch — used for extraction (smaller, cheaper, no image links). */
export async function jinaFetch(url: string): Promise<string | null> {
  const apiKey = process.env.JINA_API_KEY
  if (!apiKey) throw new Error('JINA_API_KEY is not set')
  try {
    const res = await fetch(`https://r.jina.ai/${encodeURIComponent(url)}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'text/plain',
        'X-Return-Format': 'text',
        'X-Token-Budget': JINA_TOKEN_BUDGET,
      },
      signal: AbortSignal.timeout(JINA_TIMEOUT_MS),
    })
    if (!res.ok) return null
    return res.text()
  } catch {
    return null
  }
}

/** Markdown format fetch — preserves ![alt](url) links needed for image harvesting. */
async function jinaFetchMarkdown(url: string): Promise<string | null> {
  const apiKey = process.env.JINA_API_KEY
  if (!apiKey) throw new Error('JINA_API_KEY is not set')
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

// ─── JSON-LD extraction ───────────────────────────────────────────────────

// Jina sometimes preserves <script type="application/ld+json"> in markdown mode.
const JSONLD_BLOCK_RE = /```json\s*([\s\S]*?)```|<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi

export function extractJsonLdFromMarkdown(text: string): Record<string, unknown>[] {
  const results: Record<string, unknown>[] = []
  JSONLD_BLOCK_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = JSONLD_BLOCK_RE.exec(text)) !== null) {
    const content = (m[1] ?? m[2] ?? '').trim()
    if (!content) continue
    try {
      const parsed = JSON.parse(content)
      if (typeof parsed === 'object' && parsed !== null)
        results.push(parsed as Record<string, unknown>)
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

    const brand = block['brand'] as Record<string, unknown> | undefined
    if (!out.manufacturer && brand) out.manufacturer = normStr(brand['name'])

    const offers = block['offers'] as Record<string, unknown> | undefined
    if (offers && !out.price) {
      out.price = normPrice(offers['price'])
      out.currency = normCurrency(offers['priceCurrency'])
    }

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

// ─── L2 extraction ────────────────────────────────────────────────────────

export async function jinaExtract(
  url: string,
  snippet: string,
): Promise<{ fields: ExtractedFields; content: string | null }> {
  const content = await jinaFetch(url)
  if (!content) return { fields: extractFromText(snippet), content: null }

  const regexFields = extractFromText(content)

  // JSON-LD best-effort — text mode may not preserve script tags
  const jsonLdFields = extractFromJsonLd(extractJsonLdFromMarkdown(content))
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

  return { fields: mergeFields(regexFields, mergedJsonLd), content }
}

const PRICE_RE_QUICK =
  /(?:AU\$|CA\$|\$|€|£|USD|AUD|EUR|GBP)\s*[\d,.]{1,10}|[\d,.]{1,10}\s*(?:USD|AUD|EUR|GBP)/i

// ─── Image extraction (uses markdown fetch to preserve image links) ────────

const MARKDOWN_IMAGE_RE = /!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g

export function extractImageUrlsFromMarkdown(markdown: string): string[] {
  const urls: string[] = []
  MARKDOWN_IMAGE_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = MARKDOWN_IMAGE_RE.exec(markdown)) !== null) urls.push(m[1])
  return urls
}

function collectJsonLdImage(value: unknown, out: string[]): void {
  if (!value) return
  if (typeof value === 'string') { if (value.startsWith('http')) out.push(value); return }
  if (Array.isArray(value)) { for (const v of value) collectJsonLdImage(v, out); return }
  if (typeof value === 'object') {
    const url = (value as Record<string, unknown>)['url']
    if (typeof url === 'string' && url.startsWith('http')) out.push(url)
  }
}

export function extractImagesFromJsonLd(blocks: Record<string, unknown>[]): string[] {
  const urls: string[] = []
  for (const block of blocks) {
    const type = String(block['@type'] ?? '').toLowerCase()
    if (!type.includes('product')) continue
    collectJsonLdImage(block['image'], urls)
  }
  return urls
}

export async function jinaExtractImages(url: string): Promise<string[]> {
  const markdown = await jinaFetchMarkdown(url)
  if (!markdown) return []
  const fromJsonLd = extractImagesFromJsonLd(extractJsonLdFromMarkdown(markdown))
  const fromMarkdown = extractImageUrlsFromMarkdown(markdown)
  return [...new Set([...fromJsonLd, ...fromMarkdown])]
}

// ─── URL classification ───────────────────────────────────────────────────

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

// ─── Extraction result type ───────────────────────────────────────────────

export interface ExtractionResult {
  prices: PriceSource[]
  discardReasons: string[]
}

// ─── L2.5 Variant price picker ────────────────────────────────────────────

function deduplicatePrices(
  prices: Array<{ price: number; currency: string; context: string }>,
): Array<{ price: number; currency: string; context: string }> {
  const out: typeof prices = []
  for (const p of prices) {
    const dup = out.find(
      x => x.currency === p.currency && Math.abs(x.price - p.price) / p.price < 0.15,
    )
    if (!dup) out.push(p)
  }
  return out
}

async function pickVariantPrice(
  candidates: Array<{ price: number; currency: string; context: string }>,
  vision: VisionResult,
): Promise<{ price: number; currency: string } | null> {
  const visionDesc = [
    vision.brand              && `Brand: ${vision.brand}`,
    vision.model_number       && `Model: ${vision.model_number}`,
    vision.dimensions_visible && `Dimensions: ${vision.dimensions_visible}`,
    `Category: ${vision.product_category}`,
    `Description: ${vision.visual_description}`,
  ].filter(Boolean).join(', ')

  const priceList = candidates
    .map((p, i) => `${i}: ${p.currency} ${p.price} — "${p.context.slice(0, 120)}"`)
    .join('\n')

  try {
    const raw = await callModel({
      model: 'Qwen/Qwen3.6-35B-A3B:featherless-ai',
      enable_thinking: false,
      temperature: 0,
      max_tokens: 128,
      messages: [
        {
          role: 'system',
          content:
            'You are a price selector. Given a scanned product description and prices found on a retailer page, return JSON: {"index": N} for the price that best matches the scanned item. If unsure, return {"index": 0}.',
        },
        {
          role: 'user',
          content: `Scanned item: ${visionDesc}\n\nPrices on page:\n${priceList}\n\nJSON only:`,
        },
      ],
    })
    const parsed = extractJson<{ index: number }>(raw)
    const idx = parsed?.index
    if (typeof idx === 'number' && idx >= 0 && idx < candidates.length) {
      return { price: candidates[idx].price, currency: candidates[idx].currency }
    }
  } catch { /* fallback: keep existing price */ }
  return null
}

// ─── L3 Qwen gap-fill ─────────────────────────────────────────────────────

const L3_SYSTEM_PROMPT =
  `You are a product data extractor. Given product page content, extract ONLY the listed fields. Output a single valid JSON object. Use null for fields not present. No explanation — JSON only.`

function buildL3UserMessage(missingFields: string[], url: string, content: string): string {
  const defs: Record<string, string> = {
    price:           'numeric selling price (e.g. 149.99)',
    currency:        'ISO 4217 code (USD, AUD, EUR, GBP, SGD, CAD, NZD)',
    unit:            'unit of sale (each, roll, pack of N, box of N)',
    manufacturer:    'brand or manufacturer name',
    itemDescription: 'one sentence describing what the product is',
    length:          'length with unit (e.g. "80 mm")',
    width:           'width with unit (e.g. "40 mm")',
    items_origin:    'country of manufacture (e.g. "Japan")',
  }
  const fieldLines = missingFields.map(f => `- ${f}: ${defs[f] ?? f}`).join('\n')
  return `Extract these fields:\n${fieldLines}\n\nURL: ${url}\n\nContent:\n${content.slice(0, JINA_MAX_CHARS)}\n\nJSON only:`
}

async function qwenGapFill(
  missingFields: string[],
  url: string,
  content: string,
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
        { role: 'user', content: buildL3UserMessage(missingFields, url, content) },
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

// ─── PriceSource builder ──────────────────────────────────────────────────

export function buildPriceSourceFromFields(
  fields: ExtractedFields,
  sourceName: string,
  url: string,
  manufacturerFlagged: boolean,
): PriceSource | null {
  if (!fields.price || !fields.currency) return null
  return {
    name:                 sourceName,
    url,
    price:                fields.price,
    currency:             fields.currency,
    unit:                 fields.unit ?? 'each',
    in_stock:             fields.in_stock ?? undefined,
    manufacturer:         fields.manufacturer ?? undefined,
    itemDescription:      fields.itemDescription ?? undefined,
    length:               fields.length ?? undefined,
    width:                fields.width ?? undefined,
    items_origin:         fields.items_origin ?? undefined,
    manufacturer_flagged: manufacturerFlagged,
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────

async function logEvent(runId: string | undefined, event: BusEvent): Promise<void> {
  if (!runId) return
  try { await publishEvent(runId, event) } catch { /* best-effort */ }
}

function fieldsSummary(f: ExtractedFields): string {
  return f.price != null ? `price ${f.price} ${f.currency ?? '?'}` : 'no price'
}

// ─── 4-layer extraction cascade ───────────────────────────────────────────
/**
 * L0  — URL pattern gate (free): skips L2+ for non-product pages
 * L1  — regex on snippet (free, always runs)
 * L2  — Jina text fetch + regex + JSON-LD best-effort
 * L2.5— Qwen variant picker (only when multiple prices AND vision available)
 * L3  — Qwen gap-fill (only when content returned from L2)
 * L4  — ScreenshotOne + Gemini Flash (only when price still null after L1-L3)
 */
async function extractFromUrl(
  url: string,
  snippet: string,
  vision?: VisionResult,
  discardReasons?: string[],
  runId?: string,
): Promise<PriceSource | null> {
  if (!isScrapeable(url)) return null

  const sourceName = (() => { try { return new URL(url).hostname } catch { return url } })()

  await logEvent(runId, { kind: 'extract_layer', url, layer: 'L1', detail: 'regex on snippet' })
  let fields = extractFromText(snippet)
  await logEvent(runId, { kind: 'extract_output', url, layer: 'L1', output: fieldsSummary(fields) })

  let content: string | null = null
  if (fields.price === null) {
    await logEvent(runId, { kind: 'extract_layer', url, layer: 'L0', detail: 'URL product-page gate' })
    if (!isProductPageUrl(url)) {
      await logEvent(runId, { kind: 'extract_output', url, layer: 'L0', output: 'not a product page — skipped' })
      return null
    }
    await logEvent(runId, { kind: 'extract_output', url, layer: 'L0', output: 'product page — proceeding' })

    await logEvent(runId, { kind: 'search_urls', engine: 'Jina', urls: [url] })
    await logEvent(runId, { kind: 'extract_layer', url, layer: 'L2', detail: 'Jina text fetch + JSON-LD' })
    const l2 = await jinaExtract(url, snippet)
    content = l2.content

    if (content && !PRICE_RE_QUICK.test(content)) {
      await logEvent(runId, { kind: 'extract_output', url, layer: 'L2', output: 'page has no price signal — skipped' })
      return null
    }

    fields = mergeFields(fields, l2.fields)
    await logEvent(runId, {
      kind: 'extract_output', url, layer: 'L2',
      output: content ? fieldsSummary(fields) : 'Jina fetch failed',
    })
  }

  if (vision && fields.all_prices && fields.all_prices.length > 1 && fields.price) {
    const distinct = deduplicatePrices(fields.all_prices)
    if (distinct.length > 1) {
      await logEvent(runId, { kind: 'extract_layer', url, layer: 'L2.5', detail: `${distinct.length} variant prices` })
      const picked = await pickVariantPrice(distinct, vision)
      if (picked) {
        fields = { ...fields, price: picked.price, currency: picked.currency }
        await logEvent(runId, { kind: 'extract_output', url, layer: 'L2.5', output: `picked ${picked.price} ${picked.currency}` })
      } else {
        await logEvent(runId, { kind: 'extract_output', url, layer: 'L2.5', output: 'kept original price' })
      }
    }
  }

  if (content) {
    const still = missingFieldNames(fields)
    if (still.length > 0) {
      await logEvent(runId, { kind: 'extract_layer', url, layer: 'L3', detail: `gap-fill ${still.join(', ')}` })
      const patch = await qwenGapFill(still, url, content)
      fields = applyPartial(fields, patch)
      await logEvent(runId, { kind: 'extract_output', url, layer: 'L3', output: fieldsSummary(fields) })
    }
  }

  if (fields.price === null && process.env.SCREENSHOTONE_ACCESS_KEY) {
    await logEvent(runId, { kind: 'extract_layer', url, layer: 'L4', detail: 'screenshot + Gemini' })
    const screenshot = await fetchPageScreenshot(url)
    if (screenshot) {
      const l4Missing = missingFieldNames(fields)
      const patch = await geminiExtractFromScreenshot(screenshot, l4Missing)
      fields = applyPartial(fields, patch)
    }
    await logEvent(runId, { kind: 'extract_output', url, layer: 'L4', output: fieldsSummary(fields) })
  }

  if (!fields.price || !fields.currency) return null

  let manufacturerFlagged = false
  if (vision) {
    const gate = applyVerifyGate(
      buildPriceSourceFromFields(fields, sourceName, url, false)!,
      vision,
    )
    if (gate.discard) {
      discardReasons?.push(
        `description mismatch at ${sourceName}: extracted "${(fields.itemDescription ?? '').slice(0, 80)}" vs vision category "${vision.product_category}"`,
      )
      return null
    }
    manufacturerFlagged = gate.manufacturerFlag === ManufacturerFlag.Mismatch
  }

  return buildPriceSourceFromFields(fields, sourceName, url, manufacturerFlagged)
}

/** Process multiple URLs in batches of 3. Returns prices + discard reasons for query re-planning. */
export async function jinaExtractAll(
  results: Array<{ url: string; snippet: string }>,
  vision?: VisionResult,
  runId?: string,
): Promise<ExtractionResult> {
  const scrapeable = results.filter(r => isScrapeable(r.url))
  const prices: PriceSource[] = []
  const discardReasons: string[] = []
  const BATCH = 3

  for (let i = 0; i < scrapeable.length; i += BATCH) {
    const batch = scrapeable.slice(i, i + BATCH)
    const settled = await Promise.allSettled(
      batch.map(r => extractFromUrl(r.url, r.snippet, vision, discardReasons, runId)),
    )
    for (const s of settled) {
      if (s.status === 'fulfilled' && s.value) prices.push(s.value)
    }
  }

  return { prices, discardReasons }
}
