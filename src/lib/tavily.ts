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

export async function tavilySearch(query: string, maxResults = 8): Promise<TavilyResult[]> {
  const results = await serperOrganicSearch(query)
  // score=1 placeholder — callers use url/content, not score
  return results
    .slice(0, maxResults)
    .map(r => ({ url: r.url, title: r.title, content: r.snippet, score: 1 }))
}

// Serper.dev has no dedicated image search — returns empty (graceful no-op).
// Params kept for caller compatibility (image-pipeline fallback path); unused.
export async function tavilyImageSearch(_query?: string, _maxResults?: number): Promise<TavilyImageResult[]> {
  return []
}
