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
    imageUrl: item.imageUrl ?? undefined,
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
