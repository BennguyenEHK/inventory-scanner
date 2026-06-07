import { callModel } from '@/lib/inference'
import type { ExtractedFields } from './extract-regex'

const SCREENSHOT_TIMEOUT_MS = 25_000

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
  if (missingFields.length === 0) return {}

  // base64 data URL → extract mime type and data
  const match = imageDataUrl.match(/^data:(image\/[a-z]+);base64,(.+)$/)
  if (!match) return {}
  const mimeType = match[1]
  const base64Data = match[2]

  try {
    const raw = await callModel({
      model: 'gemini-2.5-flash-latest',
      temperature: 0.1,
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'text',
            text: `${L4_SYSTEM_PROMPT}\n\n${buildL4UserPrompt(missingFields)}`,
          },
          {
            type: 'image_url',
            image_url: { url: imageDataUrl },
          },
        ],
      }],
    })

    return parseGeminiResponse(raw)
  } catch {
    return {}
  }
}
