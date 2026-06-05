import { callModelWithThinking } from '@/lib/inference'
import { publishEvent } from '@/lib/pipeline-bus'
import { tavilySearch } from '@/lib/tavily'
import type { VisionResult, PredictionResult } from '@/types'

export const maxDuration = 300

const SYSTEM_PROMPT = `You are a product identification expert with deep knowledge of industrial, commercial, and consumer products.

Given partial product information (manufacturer name, visual description, dimensions, packaging type), use your training knowledge to:
1. Identify the most likely product line and model
2. Explain your reasoning step by step
3. List 2-3 candidate products ranked by likelihood
4. Return your best prediction as structured JSON

Be clinical and precise. Return JSON only after your reasoning.`

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
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify(inputPayload) },
      ],
      enable_thinking: true,
      budget_tokens: 8000,
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
