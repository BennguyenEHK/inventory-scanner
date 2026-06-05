import { callModel } from '@/lib/inference'
import type { VisionResult, SearchResult, InventoryItem, CheckpointResult } from '@/types'

const BASE_PARAMS = {
  model: 'Qwen/Qwen3.6-35B-A3B' as const,
  enable_thinking: true as const,
  budget_tokens: 2048,
  temperature: 0.1,
  max_tokens: 1024,
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
  return JSON.parse(raw) as CheckpointResult
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
  return JSON.parse(raw) as CheckpointResult
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
  return JSON.parse(raw) as CheckpointResult
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
