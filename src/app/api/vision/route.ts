import { callModel } from '@/lib/inference'
import type { VisionResult, RouteDecision } from '@/types'

const SYSTEM_PROMPT = `You are a product identification specialist analyzing warehouse and office inventory items.

Return ONLY a JSON object with exactly these fields:
{
  "visible_text": ["every word/number readable in the image"],
  "brand": "manufacturer or brand name — use inference if logo/style is recognizable even if not perfectly sharp (string or null only if truly unidentifiable)",
  "model_number": "model, part, or SKU number (string or null if not visible)",
  "product_category": "specific category e.g. 'thermal label printer', 'power drill', 'toner cartridge'",
  "dimensions_visible": "e.g. '150 x 80 mm' or null",
  "barcode": "barcode or QR value if readable (string or null)",
  "color": "primary color(s) of the product",
  "shape": "physical form e.g. 'rectangular box', 'cylindrical roll'",
  "material_hints": "visible material clues e.g. 'metal housing, plastic buttons'",
  "label_language": "language of the product label e.g. 'English', 'Japanese'",
  "condition": "new" | "used" | "damaged",
  "packaging_type": "box" | "bag" | "blister" | "loose" | "roll" | "unknown",
  "visual_description": "2–3 sentence description of what you see",
  "confidence": <number 0.0–1.0, see scale below>,
  "missing_fields": ["fields you could not determine"],
  "image_quality": "clear" | "partial" | "obscured" | "unreadable"
}

CONFIDENCE SCALE — score accurately, do NOT default to low values for caution:
  0.85–1.0  brand AND model number both clearly readable
  0.65–0.84 brand clearly visible, model partially readable or strongly inferable
  0.40–0.64 brand visible OR product clearly identifiable by shape/packaging, model uncertain
  0.20–0.39 product category identifiable but brand and model both unclear
  0.00–0.19 image is genuinely unreadable or product is unidentifiable

INFERENCE RULES:
- A recognizable logo, color scheme, or packaging style IS enough to set brand — do not wait for perfect text legibility
- Set brand/model_number to null ONLY when you have no visual evidence, not merely because you are uncertain
- If multiple images are provided, combine all information across angles before scoring confidence`

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
          { type: 'text', text: SYSTEM_PROMPT },
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
