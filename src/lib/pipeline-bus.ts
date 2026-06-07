import { redis } from './redis'

// Each pipeline run gets a Redis list keyed by runId.
// API routes RPUSH events; the SSE endpoint LRANGEs with a cursor.
const KEY = (runId: string) => `pipeline:${runId}`
const TTL = 3600 // 1 hour

export type BusEvent =
  | { kind: 'thinking';          stageId: number; cp?: 1 | 2; text: string }
  | { kind: 'search_query';      attempt: number; query: string }
  | { kind: 'search_cache_hit';      cacheKey: string }
  | { kind: 'search_queries_planned'; queries: string[]; count: number }
  | { kind: 'search_tavily';          count: number; urls: string[] }
  | { kind: 'search_organic';    urlCount: number }
  | { kind: 'search_firecrawl';  urlCount: number }
  | { kind: 'search_prices';     newCount: number; totalCount: number }
  | { kind: 'search_sufficient'; sufficient: boolean; reason?: string }
  | { kind: 'search_urls';    engine: string; urls: string[] }
  | { kind: 'extract_layer';  url: string; layer: string; detail?: string }
  | { kind: 'extract_output'; url: string; layer: string; output: string }
  | { kind: 'done' }

export async function publishEvent(runId: string, event: BusEvent): Promise<void> {
  await redis.rpush(KEY(runId), JSON.stringify(event))
  await redis.expire(KEY(runId), TTL)
}

export async function pollEvents(
  runId: string,
  cursor: number
): Promise<{ events: BusEvent[]; newCursor: number }> {
  const raw = await redis.lrange(KEY(runId), cursor, -1)
  const events = (raw as unknown[])
    .map(r => {
      try { return JSON.parse(typeof r === 'string' ? r : JSON.stringify(r)) as BusEvent }
      catch { return null }
    })
    .filter(Boolean) as BusEvent[]
  return { events, newCursor: cursor + events.length }
}

// Hostname for compact log lines; falls back to the raw string on parse failure.
function hostOf(url: string): string { try { return new URL(url).hostname } catch { return url } }

// Human-readable line + which stage it belongs to
export function busEventToLine(event: BusEvent): { stageId: number; line: string } | null {
  switch (event.kind) {
    case 'thinking': {
      const prefix = event.cp ? `CP${event.cp} reasoning` : 'Reasoning'
      const snippet = event.text.length > 600
        ? event.text.slice(0, 600) + '…'
        : event.text
      return { stageId: event.stageId, line: `💭 ${prefix}:\n${snippet}` }
    }
    case 'search_query':
      return { stageId: 3, line: `🔍 Attempt ${event.attempt}: "${event.query}"` }
    case 'search_cache_hit':
      return { stageId: 3, line: `⚡ Cache hit — skipping search pipeline` }
    case 'search_queries_planned':
      return { stageId: 3, line: `📋 ${event.count} quer${event.count !== 1 ? 'ies' : 'y'} planned: ${event.queries.map((q, i) => `${i + 1}. "${q}"`).join(' │ ')}` }
    case 'search_tavily':
      return { stageId: 3, line: `📡 Serper organic → ${event.count} URL${event.count !== 1 ? 's' : ''} found` }
    case 'search_organic':
      return { stageId: 3, line: `🌐 Organic → scraping ${event.urlCount} page${event.urlCount !== 1 ? 's' : ''}` }
    case 'search_firecrawl':
      return { stageId: 3, line: `🔧 Extraction → scraping ${event.urlCount} page${event.urlCount !== 1 ? 's' : ''}` }
    case 'search_prices':
      return { stageId: 3, line: `💰 +${event.newCount} prices (${event.totalCount} total)` }
    case 'search_sufficient':
      return {
        stageId: 3,
        line: event.sufficient
          ? '✓ Sufficient sources — stopping loop'
          : `↩ Not sufficient${event.reason ? ': ' + event.reason : ''} — retrying…`,
      }
    case 'search_urls': {
      const trunc = (u: string) => (u.length > 80 ? u.slice(0, 80) + '…' : u)
      const shown = event.urls.slice(0, 5).map(trunc).join('\n   • ')
      const more = event.urls.length > 5 ? `\n   (+${event.urls.length - 5} more)` : ''
      return {
        stageId: 3,
        line: `🔗 ${event.engine} → ${event.urls.length} URL${event.urls.length !== 1 ? 's' : ''}:\n   • ${shown}${more}`,
      }
    }
    case 'extract_layer':
      return { stageId: 3, line: `⚙️ [${event.layer}] activated → ${hostOf(event.url)}${event.detail ? ` (${event.detail})` : ''}` }
    case 'extract_output':
      return { stageId: 3, line: `📤 [${event.layer}] ${hostOf(event.url)} → ${event.output}` }
    default:
      return null
  }
}
