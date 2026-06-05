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

export async function tavilySearch(
  query: string,
  maxResults = 8
): Promise<TavilyResult[]> {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: process.env.TAVILY_API_KEY,
      query,
      max_results: maxResults,
      search_depth: 'basic',
    }),
  })
  if (!res.ok) throw new Error(`Tavily search failed: ${res.status}`)
  const data = await res.json() as { results: TavilyResult[] }
  return data.results
}

export async function tavilyImageSearch(
  query: string,
  maxResults = 3
): Promise<TavilyImageResult[]> {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: process.env.TAVILY_API_KEY,
      query,
      max_results: maxResults,
      include_images: true,
      search_depth: 'basic',
    }),
  })
  if (!res.ok) throw new Error(`Tavily image search failed: ${res.status}`)
  const data = await res.json() as { images?: TavilyImageResult[] }
  return data.images ?? []
}
