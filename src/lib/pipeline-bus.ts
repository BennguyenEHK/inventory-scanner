import { redis } from './redis'

// Each pipeline run gets a Redis list keyed by runId.
// API routes RPUSH events; the SSE endpoint LRANGEs with a cursor.
const KEY = (runId: string) => `pipeline:${runId}`
const TTL = 3600 // 1 hour

export type BusEvent =
  | { kind: 'thinking';         stageId: number; cp?: 1 | 2; text: string }
  | { kind: 'search_query';     attempt: number; query: string }
  | { kind: 'search_tavily';    count: number; urls: string[] }
  | { kind: 'search_firecrawl'; urlCount: number }
  | { kind: 'search_prices';    newCount: number; totalCount: number }
  | { kind: 'search_sufficient'; sufficient: boolean; reason?: string }
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
    case 'search_tavily':
      return { stageId: 3, line: `📡 Tavily → ${event.count} URL${event.count !== 1 ? 's' : ''} found` }
    case 'search_firecrawl':
      return { stageId: 3, line: `🔧 Firecrawl → scraping ${event.urlCount} page${event.urlCount !== 1 ? 's' : ''}` }
    case 'search_prices':
      return { stageId: 3, line: `💰 +${event.newCount} prices (${event.totalCount} total)` }
    case 'search_sufficient':
      return {
        stageId: 3,
        line: event.sufficient
          ? '✓ Sufficient sources — stopping loop'
          : `↩ Not sufficient${event.reason ? ': ' + event.reason : ''} — retrying…`,
      }
    default:
      return null
  }
}
