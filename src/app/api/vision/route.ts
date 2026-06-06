import { callModel } from '@/lib/inference'
import { publishEvent } from '@/lib/pipeline-bus'
import type { VisionResult, RouteDecision } from '@/types'
import { VISION_SYSTEM_PROMPT } from '@/prompt/vision'

function visionRouter(v: VisionResult): RouteDecision {
  if (v.confidence >= 0.8 && v.brand !== null)
    return { route: 'A', strategy: 'direct_search' }
  if (v.confidence >= 0.4 && (v.brand !== null || v.model_number !== null))
    return { route: 'B', strategy: 'predict_then_search' }
  return {
    route: 'C',
    strategy: 'ask_user',
    message: `Image unclear. Please retake showing the label, or confirm: is this a ${v.product_category}?`,
  }
}

// Keyword-based intent detector — avoids an extra AI call for a simple classification
function detectInventoryCheckIntent(prompt: string): boolean {
  return /\b(check|have|already|exist|inventory|database|stock|do we|we have|already have|in our|got)\b/i.test(prompt)
}

export async function POST(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const runId = url.searchParams.get('runId')

  try {
    const { images, userPrompt } = await request.json() as { images: string[]; userPrompt?: string }

    // Guard: max 5 images, each capped at ~5 MB base64 (~6.7M chars)
    if (!Array.isArray(images) || images.length === 0 || images.length > 5)
      return Response.json({ error: 'Provide 1–5 images' }, { status: 400 })
    if (images.some(b => typeof b !== 'string' || b.length > 7_000_000))
      return Response.json({ error: 'One or more images exceed the 5 MB limit' }, { status: 400 })

    if (runId) {
      await publishEvent(runId, {
        kind: 'thinking',
        stageId: 1,
        text: `Gemini 2.5 Flash analyzing ${images.length} image${images.length !== 1 ? 's' : ''}…`,
      })
    }

    const imageContent = images.map((b64: string) => ({
      type: 'image_url',
      image_url: { url: `data:image/jpeg;base64,${b64}` },
    }))

    const raw = await callModel({
      model: 'gemini-2.5-flash',
      messages: [{
        role: 'user',
        content: [
          ...imageContent,
          { type: 'text', text: VISION_SYSTEM_PROMPT },
        ],
      }],
      temperature: 0.1,
      max_tokens: 2048,
    })

    let vision: VisionResult
    try {
      vision = JSON.parse(raw) as VisionResult
    } catch {
      // Model returned non-JSON — treat as a processing failure (consistent with /api/predict)
      return Response.json({ error: 'Vision model returned unparseable output' }, { status: 500 })
    }
    if (!vision.visual_description) vision.visual_description = 'No description available'
    const route = visionRouter(vision)

    // Override to Route D if user asked about inventory
    const finalRoute: RouteDecision = userPrompt && detectInventoryCheckIntent(userPrompt)
      ? { route: 'D', strategy: 'check_database', message: 'Checking inventory database…' }
      : route

    if (runId) {
      const routeLabel = finalRoute.route === 'A' ? 'Route A — high confidence, direct search'
        : finalRoute.route === 'B' ? 'Route B — moderate confidence, predict first'
        : finalRoute.route === 'D' ? 'Route D — inventory database check'
        : 'Route C — unclear image, asking user'

      const lines = [
        `Route: ${routeLabel}`,
        `Confidence: ${(vision.confidence * 100).toFixed(0)}%`,
        vision.brand       ? `Brand: ${vision.brand}` : 'Brand: unidentified',
        vision.model_number ? `Model: ${vision.model_number}` : 'Model: not visible',
        `Category: ${vision.product_category}`,
        `Description: ${vision.visual_description}`,
        vision.visible_text.length > 0
          ? `Visible text: ${vision.visible_text.join(', ')}`
          : 'Visible text: none detected',
      ].join('\n')

      await publishEvent(runId, { kind: 'thinking', stageId: 1, text: lines })
    }

    return Response.json({ vision, route: finalRoute, userPrompt })
  } catch (err) {
    console.error('[vision] Unexpected error:', err)
    return Response.json({ error: 'Vision extraction failed' }, { status: 500 })
  }
}
