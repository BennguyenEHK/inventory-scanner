import { callModel } from '@/lib/inference'
import type { VisionResult, RouteDecision } from '@/types'

const SYSTEM_PROMPT = `You are a product identification specialist.
Analyze this image and extract ALL visible information.
Be maximally descriptive — even for unclear images.
Never guess field values. If not visible, set null.
Always describe visual appearance even when text is unreadable.
Return valid JSON only. No preamble.`

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

export async function POST(request: Request): Promise<Response> {
  try {
    const { images } = await request.json() as { images: string[] }

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
          { type: 'text', text: `${SYSTEM_PROMPT}\n\nExtract all product information from these images. If multiple images show the same product from different angles, combine the information. Return JSON matching the required schema exactly.` },
        ],
      }],
      temperature: 0.1,
      max_tokens: 2048,
    })

    const vision: VisionResult = JSON.parse(raw)
    if (!vision.visual_description) vision.visual_description = 'No description available'
    const route = visionRouter(vision)

    return Response.json({ vision, route })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Vision extraction failed' },
      { status: 500 }
    )
  }
}
