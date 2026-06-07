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
  // All price candidates found on page — used by L2.5 variant picker
  all_prices?: Array<{ price: number; currency: string; context: string }> | null
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

  // --- Price: collect ALL candidates; labeled patterns take priority for result.price ---
  const allPricesRaw: Array<{ price: number; currency: string; context: string }> = []
  let m: RegExpExecArray | null

  LABELED_PRICE_RE.lastIndex = 0
  while ((m = LABELED_PRICE_RE.exec(text)) !== null) {
    const price = parseNumeric(m[1])
    if (!isFinite(price) || price <= 0) continue
    const nearby = text.slice(Math.max(0, m.index - 15), m.index + m[0].length + 15)
    const sym = SYMBOL_MAP.find(([s]) => nearby.toUpperCase().includes(s.toUpperCase()))
    const code = nearby.match(CODE_RE)
    const currency = code ? code[0].toUpperCase() : (sym ? sym[1] : 'USD')
    const ctx = text.slice(Math.max(0, m.index - 60), m.index + m[0].length + 60).replace(/\s+/g, ' ').trim()
    allPricesRaw.push({ price, currency, context: ctx })
  }

  if (allPricesRaw.length > 0) {
    result.price = allPricesRaw[0].price
    result.currency = allPricesRaw[0].currency
  } else {
    PRICE_RE.lastIndex = 0
    while ((m = PRICE_RE.exec(text)) !== null) {
      const parsed = parsePriceRaw(m[0])
      if (!parsed) continue
      const ctx = text.slice(Math.max(0, m.index - 60), m.index + m[0].length + 60).replace(/\s+/g, ' ').trim()
      allPricesRaw.push({ price: parsed.price, currency: parsed.currency, context: ctx })
      if (!result.price) { result.price = parsed.price; result.currency = parsed.currency }
    }
  }

  result.all_prices = allPricesRaw.length > 0 ? allPricesRaw : null

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
    all_prices:      overlay.all_prices      ?? base.all_prices,
  }
}

// Fields eligible for L3 gap-fill — excludes all_prices (informational only)
const FILLABLE_FIELDS: ReadonlyArray<keyof ExtractedFields> = [
  'price', 'currency', 'unit', 'in_stock', 'manufacturer', 'itemDescription', 'length', 'width', 'items_origin',
]

/** List field names that are still null and eligible for L3 gap-fill. */
export function missingFieldNames(fields: ExtractedFields): Array<keyof ExtractedFields> {
  return FILLABLE_FIELDS.filter(k => fields[k] === null)
}
