import { callModel, extractJson } from '@/lib/inference'
import { extractFromText, mergeFields, missingFieldNames, type ExtractedFields } from './extract-regex'
import { jinaExtract, JINA_MAX_CHARS } from './jina'
import { fetchPageScreenshot, geminiExtractFromScreenshot } from './screenshot'
import { applyVerifyGate, ManufacturerFlag } from './verify-gate'
import type { PriceSource, VisionResult } from '@/types'

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

    // Skip if Jina markdown has no price signal at all
    if (markdown && !PRICE_RE_QUICK.test(markdown)) {
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
