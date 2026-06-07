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
