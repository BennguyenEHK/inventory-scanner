import { callModelWithThinking } from '@/lib/inference'
import { publishEvent } from '@/lib/pipeline-bus'
import { tavilySearch } from '@/lib/tavily'
import type { VisionResult, PredictionResult } from '@/types'
import { PREDICT_SYSTEM_PROMPT, buildPredictUserMessage } from '@/prompt/predict'

export const maxDuration = 300

export async function POST(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const runId = url.searchParams.get('runId')

  try {
    const vision: VisionResult = await request.json()

    const inputPayload = {
      brand: vision.brand,
      model_number: vision.model_number,
      visual_description: vision.visual_description,
      dimensions_visible: vision.dimensions_visible,
      product_category: vision.product_category,
      packaging_type: vision.packaging_type,
      color: vision.color,
      barcode: vision.barcode,
    }

    const { text, thinking } = await callModelWithThinking({
      model: 'Qwen/Qwen3.6-35B-A3B:featherless-ai',
      messages: [
        { role: 'system', content: PREDICT_SYSTEM_PROMPT },
        { role: 'user', content: buildPredictUserMessage(inputPayload) },
      ],
      enable_thinking: true,
      budget_tokens: 81_920,
      temperature: 0.2,
    })

    if (runId && thinking) {
      await publishEvent(runId, { kind: 'thinking', stageId: 2, text: thinking })
    }

    const prediction: PredictionResult = JSON.parse(text)

    const query = vision.barcode
      ? `barcode ${vision.barcode} product`
      : prediction.verification_query
    const results = await tavilySearch(query, 3)
    const confirmed = results.some(r =>
      r.content.toLowerCase().includes(
        prediction.prediction.product_name.toLowerCase().split(' ')[0]
      )
    )

    return Response.json({
      prediction,
      verification: {
        confirmed,
        sources: results.slice(0, 2).map(r => ({ url: r.url, title: r.title })),
      },
    })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Prediction failed' },
      { status: 500 }
    )
  }
}
