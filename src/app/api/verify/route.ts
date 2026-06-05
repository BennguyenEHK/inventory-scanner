import { callModel } from '@/lib/inference'
import type { VisionResult, SearchResult, InventoryItem, CheckpointResult } from '@/types'

// CP1 + CP2 run in parallel, each with thinking=ON and budget_tokens=6000 (~120s each).
// Without this, Vercel's default 60s function timeout kills the request before HF responds.
export const maxDuration = 300

const BASE_PARAMS = {
  model: 'Qwen/Qwen3.6-35B-A3B:featherless-ai' as const,
  enable_thinking: true as const,
  budget_tokens: 6000,
  temperature: 0.1,
  max_tokens: 2048,
}

function normalizeCheckpoint(raw: string, checkpoint: 1 | 2 | 3): CheckpointResult {
  let parsed: Partial<CheckpointResult>
  try {
    parsed = JSON.parse(raw) as Partial<CheckpointResult>
  } catch {
    // Model returned non-JSON (e.g. truncated output) — treat as failed check
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

async function checkpoint1(vision: VisionResult): Promise<CheckpointResult> {
  const raw = await callModel({
    ...BASE_PARAMS,
    messages: [
      {
        role: 'system',
        content: 'You are a product verification expert. Given extracted product information, verify logical consistency. Check: does manufacturer match product category? Does model number format match brand conventions? Are dimensions plausible? Return JSON only.',
      },
      { role: 'user', content: JSON.stringify(vision) },
    ],
  })
  return normalizeCheckpoint(raw, 1)
}

async function checkpoint2(productName: string, search: SearchResult): Promise<CheckpointResult> {
  const raw = await callModel({
    ...BASE_PARAMS,
    messages: [
      {
        role: 'system',
        content: 'You are a price verification auditor. Given a target product name and scraped prices, verify each result is for the EXACT same product. Watch for: similar model numbers, different sizes, accessories, bundles, multi-packs priced as singles. For each result: KEEP or REMOVE with reason. Return JSON only.',
      },
      { role: 'user', content: JSON.stringify({ productName, sources: search.sources }) },
    ],
  })
  return normalizeCheckpoint(raw, 2)
}

async function checkpoint3(item: InventoryItem): Promise<CheckpointResult> {
  const raw = await callModel({
    ...BASE_PARAMS,
    messages: [
      {
        role: 'system',
        content: 'You are a data quality auditor for an inventory system. Review this complete inventory record for logical consistency. Verify all fields populated, units include units string (e.g. "150 mm"), Ext_Price equals Market_Price × Qty, Notes contains "Prices:" prefix. Return JSON only.',
      },
      { role: 'user', content: JSON.stringify(item) },
    ],
  })
  return normalizeCheckpoint(raw, 3)
}

export async function POST(request: Request): Promise<Response> {
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
      result = await checkpoint1(body.vision)
    else if (body.checkpoint === 2 && body.productName && body.search)
      result = await checkpoint2(body.productName, body.search)
    else if (body.checkpoint === 3 && body.item)
      result = await checkpoint3(body.item)
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
