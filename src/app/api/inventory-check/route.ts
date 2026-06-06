import { callModel, callModelWithThinking, extractJson } from '@/lib/inference'
import { publishEvent } from '@/lib/pipeline-bus'
import { notionSearchByProduct } from '@/lib/notion'
import {
  INVENTORY_CHECK_QUERY_PROMPT, buildInventoryCheckQueryMessage,
  INVENTORY_CHECK_CONCLUSION_PROMPT, buildInventoryCheckConclusionMessage,
} from '@/prompt/inventory-check'
import type { VisionResult, InventoryCheckResult } from '@/types'

export const maxDuration = 300

export async function POST(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const runId = url.searchParams.get('runId')

  try {
    const body = await request.json() as { vision?: VisionResult; userPrompt?: string }

    if (!body.vision || typeof body.vision !== 'object')
      return Response.json({ error: 'vision is required' }, { status: 400 })

    const vision = body.vision
    const userPrompt = typeof body.userPrompt === 'string' ? body.userPrompt.slice(0, 500) : ''

    // Turn 1: reasoning model generates the optimal Notion search query
    if (runId) await publishEvent(runId, { kind: 'thinking', stageId: 3, text: 'Generating database search query…' })

    const { text: turn1Text, thinking } = await callModelWithThinking({
      model: 'Qwen/Qwen3.6-35B-A3B:featherless-ai',
      enable_thinking: true,
      budget_tokens: 20_480,   // smaller budget — query generation is not deeply complex
      temperature: 0.1,
      messages: [
        { role: 'system', content: INVENTORY_CHECK_QUERY_PROMPT },
        { role: 'user', content: buildInventoryCheckQueryMessage(vision, userPrompt) },
      ],
    })

    if (runId && thinking) await publishEvent(runId, { kind: 'thinking', stageId: 3, text: thinking })

    let queryUsed = `${vision.brand ?? ''} ${vision.model_number ?? vision.product_category}`.trim()
    const turn1 = extractJson<{ query: string }>(turn1Text)
    if (turn1?.query) queryUsed = turn1.query

    // Execute Notion search with the generated query
    if (runId) await publishEvent(runId, { kind: 'thinking', stageId: 3, text: `Searching database: "${queryUsed}"…` })
    const items = await notionSearchByProduct(queryUsed)

    // Turn 2: model interprets the results (no thinking needed — interpretation is fast)
    const conclusionRaw = await callModel({
      model: 'Qwen/Qwen3.6-35B-A3B:featherless-ai',
      enable_thinking: false,
      temperature: 0.1,
      max_tokens: 4096,
      messages: [
        { role: 'system', content: INVENTORY_CHECK_CONCLUSION_PROMPT },
        { role: 'user', content: buildInventoryCheckConclusionMessage(queryUsed, items) },
      ],
    })

    let conclusion = items.length > 0
      ? `Found ${items.length} matching item(s) in inventory.`
      : 'This product is not currently in inventory.'
    let found = items.length > 0
    const turn2 = extractJson<{ found: boolean; conclusion: string }>(conclusionRaw)
    if (turn2) {
      found = turn2.found ?? found
      if (turn2.conclusion) conclusion = turn2.conclusion
    }

    const result: InventoryCheckResult = {
      found,
      matchCount: items.length,
      items,
      conclusion,
      queryUsed,
    }

    if (runId) await publishEvent(runId, { kind: 'thinking', stageId: 3, text: conclusion })

    return Response.json(result)
  } catch (err) {
    console.error('[inventory-check] Unexpected error:', err)
    return Response.json({ error: 'Inventory check failed' }, { status: 500 })
  }
}
