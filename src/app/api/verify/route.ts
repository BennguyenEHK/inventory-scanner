import { callModelWithThinking } from '@/lib/inference'
import { publishEvent } from '@/lib/pipeline-bus'
import type { VisionResult, SearchResult, InventoryItem, CheckpointResult, SearchContext } from '@/types'
import { VERIFY_CP1_SYSTEM_PROMPT, buildCp1UserMessage } from '@/prompt/verify-cp1'
import { VERIFY_CP2_SYSTEM_PROMPT, buildCp2UserMessage } from '@/prompt/verify-cp2'
import { VERIFY_CP3_SYSTEM_PROMPT, buildCp3UserMessage } from '@/prompt/verify-cp3'

export const maxDuration = 300

const BASE_PARAMS = {
  model: 'Qwen/Qwen3.6-35B-A3B:featherless-ai' as const,
  enable_thinking: true as const,
  budget_tokens: 81_920,
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
      { role: 'system', content: VERIFY_CP1_SYSTEM_PROMPT },
      { role: 'user', content: buildCp1UserMessage(vision) },
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
      { role: 'system', content: VERIFY_CP2_SYSTEM_PROMPT },
      { role: 'user', content: buildCp2UserMessage(productName, search.sources) },
    ],
  })
  if (runId && thinking) {
    await publishEvent(runId, { kind: 'thinking', stageId: 4, cp: 2, text: thinking })
  }

  const result = normalizeCheckpoint(text, 2)

  // Signal re-search when CP2 audit finds too few clean sources
  if (!result.passed || (result.clean_count ?? result.clean_sources?.length ?? 0) < 3) {
    result.re_search_needed = true
    const exclusionContext: SearchContext = {
      triedQueries: [],
      excludedDomains: (result.removed_sources ?? [])
        .map(s => { try { return new URL(s.url).hostname } catch { return '' } })
        .filter(Boolean),
      contaminationReasons: (result.removed_sources ?? []).map(s => s.reason),
      confirmedSources: result.clean_sources ?? [],
      researchAttempt: 0,  // client will set from search.context_for_retry.researchAttempt
    }
    result.exclusion_context = exclusionContext
  }

  return result
}

async function checkpoint3(item: InventoryItem, runId: string | null): Promise<CheckpointResult> {
  const { text, thinking } = await callModelWithThinking({
    ...BASE_PARAMS,
    messages: [
      { role: 'system', content: VERIFY_CP3_SYSTEM_PROMPT },
      { role: 'user', content: buildCp3UserMessage(item) },
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
    console.error('[verify] Unexpected error:', err)
    return Response.json({ error: 'Verification failed' }, { status: 500 })
  }
}
