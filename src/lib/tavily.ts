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

export async function tavilySearch(query: string): Promise<TavilyResult[]> {
  const results = await serperOrganicSearch(query)
  // score=1 placeholder — route.ts uses url/content, not score
  return results.map(r => ({ url: r.url, title: r.title, content: r.snippet, score: 1 }))
}

// Serper.dev has no dedicated image search — return empty to avoid breaking callers.
export async function tavilyImageSearch(): Promise<TavilyImageResult[]> {
  return []
}
