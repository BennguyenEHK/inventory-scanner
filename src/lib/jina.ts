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

// --- Image extraction (restores the product-image pipeline) ---

// Jina embeds page images as markdown ![alt](url) — capture the URL.
const MARKDOWN_IMAGE_RE = /!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g

/** Pull every image URL written as markdown image syntax from Jina markdown. */
export function extractImageUrlsFromMarkdown(markdown: string): string[] {
  const urls: string[] = []
  MARKDOWN_IMAGE_RE.lastIndex = 0 // /g regex — reset before reuse
  let m: RegExpExecArray | null
  while ((m = MARKDOWN_IMAGE_RE.exec(markdown)) !== null) urls.push(m[1])
  return urls
}

// JSON-LD Product.image can be: string | string[] | {url} | {url}[] — collect recursively.
function collectJsonLdImage(value: unknown, out: string[]): void {
  if (!value) return
  if (typeof value === 'string') { if (value.startsWith('http')) out.push(value); return }
  if (Array.isArray(value)) { for (const v of value) collectJsonLdImage(v, out); return }
  if (typeof value === 'object') {
    const url = (value as Record<string, unknown>)['url']
    if (typeof url === 'string' && url.startsWith('http')) out.push(url)
  }
}

/** Pull product image URLs from Product-typed JSON-LD blocks (the real product photos). */
export function extractImagesFromJsonLd(blocks: Record<string, unknown>[]): string[] {
  const urls: string[] = []
  for (const block of blocks) {
    const type = String(block['@type'] ?? '').toLowerCase()
    if (!type.includes('product')) continue
    collectJsonLdImage(block['image'], urls)
  }
  return urls
}

/**
 * Fetch a price-source page via Jina and harvest its product image URLs.
 * Reuses the same Jina markdown we already pay for during search extraction.
 * JSON-LD images (highest quality) are returned first, then inline markdown
 * images. Deduped; NOT filtered here (caller applies isProductImage()).
 */
export async function jinaExtractImages(url: string): Promise<string[]> {
  const markdown = await jinaFetch(url)
  if (!markdown) return []
  const fromJsonLd = extractImagesFromJsonLd(extractJsonLdFromMarkdown(markdown))
  const fromMarkdown = extractImageUrlsFromMarkdown(markdown)
  return [...new Set([...fromJsonLd, ...fromMarkdown])] // JSON-LD first = higher quality
}
