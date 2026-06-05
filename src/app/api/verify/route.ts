import { callModelWithThinking } from '@/lib/inference'
import { publishEvent } from '@/lib/pipeline-bus'
import type { VisionResult, SearchResult, InventoryItem, CheckpointResult } from '@/types'

export const maxDuration = 300

const BASE_PARAMS = {
  model: 'Qwen/Qwen3.6-35B-A3B:featherless-ai' as const,
  enable_thinking: true as const,
  budget_tokens: 6000,
  temperature: 0.1,
  max_tokens: 2048,
}

function normalizeCheckpoint(text: string, checkpoint: 1 | 2 | 3): CheckpointResult {
  let parsed: Partial<CheckpointResult>
  try {
    parsed = JSON.parse(text) as Partial<CheckpointResult>
  } catch {
    parsed = {}
  }
  return {
    checkpoint:      parsed.checkpoint      ?? checkpoint,
    passed:          parsed.passed          ?? false,
    issues:          Array.isArray(parsed.issues) ? parsed.issues : [],
    action:          parsed.action          ?? 'review',
    confidence:      parsed.confidence,
    corrections:     parsed.corrections,
    clean_sources:   Array.isArray(parsed.clean_sources)   ? parsed.clean_sources   : undefined,
    removed_sources: Array.isArray(parsed.removed_sources) ? parsed.removed_sources : undefined,
    clean_count:     parsed.clean_count,
  }
}

async function checkpoint1(vision: VisionResult, runId: string | null): Promise<CheckpointResult> {
  const { text, thinking } = await callModelWithThinking({
    ...BASE_PARAMS,
    messages: [
      {
        role: 'system',
        content: 'You are a product verification expert. Given extracted product information, verify logical consistency. Check: does manufacturer match product category? Does model number format match brand conventions? Are dimensions plausible? Return JSON only.',
      },
      { role: 'user', content: JSON.stringify(vision) },
    ],
  })
  if (runId && thinking) {
    await publishEvent(runId, { kind: 'thinking', stageId: 4, cp: 1, text: thinking })
  }
  return normalizeCheckpoint(text, 1)
}

async function checkpoint2(productName: string, search: SearchResult, runId: string | null): Promise<CheckpointResult> {
  const { text, thinking } = await callModelWithThinking({
    ...BASE_PARAMS,
    messages: [
      {
        role: 'system',
        content: 'You are a price verification auditor. Given a target product name and scraped prices, verify each result is for the EXACT same product. Watch for: similar model numbers, different sizes, accessories, bundles, multi-packs priced as singles. For each result: KEEP or REMOVE with reason. Return JSON only.',
      },
      { role: 'user', content: JSON.stringify({ productName, sources: search.sources }) },
    ],
  })
  if (runId && thinking) {
    await publishEvent(runId, { kind: 'thinking', stageId: 4, cp: 2, text: thinking })
  }
  return normalizeCheckpoint(text, 2)
}

async function checkpoint3(item: InventoryItem, runId: string | null): Promise<CheckpointResult> {
  const { text, thinking } = await callModelWithThinking({
    ...BASE_PARAMS,
    messages: [
      {
        role: 'system',
        content: 'You are a data quality auditor for an inventory system. Review this complete inventory record for logical consistency. Verify all fields populated, units include units string (e.g. "150 mm"), Ext_Price equals Market_Price × Qty, Notes contains "Prices:" prefix. Return JSON only.',
      },
      { role: 'user', content: JSON.stringify(item) },
    ],
  })
  if (runId && thinking) {
    await publishEvent(runId, { kind: 'thinking', stageId: 4, cp: undefined, text: thinking })
  }
  return normalizeCheckpoint(text, 3)
}

export async function POST(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const runId = url.searchParams.get('runId')

  try {
    const body = await request.json() as {
      checkpoint: 1 | 2 | 3
      vision?: VisionResult
      productName?: string
      search?: SearchResult
      item?: InventoryItem
    }

    let result: CheckpointResult
    if (body.checkpoint === 1 && body.vision)
      result = await checkpoint1(body.vision, runId)
    else if (body.checkpoint === 2 && body.productName && body.search)
      result = await checkpoint2(body.productName, body.search, runId)
    else if (body.checkpoint === 3 && body.item)
      result = await checkpoint3(body.item, runId)
    else
      return Response.json({ error: 'Invalid checkpoint request' }, { status: 400 })

    return Response.json(result)
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Verification failed' },
      { status: 500 }
    )
  }
}
