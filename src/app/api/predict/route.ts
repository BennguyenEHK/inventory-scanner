import { NextRequest, NextResponse } from 'next/server'
import { VisionResult, PredictionResult } from '@/types'
import { callModel } from '@/lib/inference'
import { tavilySearch } from '@/lib/tavily'

export async function POST(req: NextRequest): Promise<NextResponse<PredictionResult | { error: string }>> {
  try {
    const vision: VisionResult = await req.json()

    // Build prompt for Qwen3.6 with reasoning
    const systemPrompt = `You are an expert product identification specialist. Analyze visual evidence to predict the exact product name, manufacturer, and model.

Focus on:
1. Brand indicators (logos, text, packaging design)
2. Model numbers (alphanumeric sequences)
3. Product category hints (shape, function, materials)
4. Visible text clues

Respond with JSON: { "product_name": "...", "model_number": "...|null", "manufacturer": "...", "product_line": "...", "reasoning": "...", "confidence": 0.0-1.0, "candidates": [{ "name": "...", "confidence": 0.0-1.0, "differentiator": "..." }] }`

    const userPrompt = `Analyze this product:
Brand: ${vision.brand || 'unknown'}
Model Number: ${vision.model_number || 'not visible'}
Category: ${vision.product_category}
Visible Text: ${vision.visible_text.join(', ') || 'none'}
Color: ${vision.color}
Shape: ${vision.shape}
Material Hints: ${vision.material_hints}
Packaging: ${vision.packaging_type}
Condition: ${vision.condition}
Confidence in Visual Data: ${(vision.confidence * 100).toFixed(0)}%
Image Quality: ${vision.image_quality}

Provide your best prediction with reasoning.`

    // Call Qwen3.6 with thinking enabled
    const predictionJson = await callModel({
      model: 'Qwen3.6',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      enable_thinking: true,
      budget_tokens: 4096,
      temperature: 0.1,
      max_tokens: 1024,
    })

    // Parse prediction response
    let prediction
    try {
      const jsonMatch = predictionJson.match(/\{[\s\S]*\}/)
      if (!jsonMatch) throw new Error('No JSON in response')
      prediction = JSON.parse(jsonMatch[0])
    } catch {
      throw new Error(`Failed to parse prediction: ${predictionJson}`)
    }

    // Generate verification query
    const verificationQuery = prediction.model_number
      ? `${prediction.manufacturer} ${prediction.model_number}`
      : `${prediction.manufacturer} ${prediction.product_name}`

    // Quick verification via Tavily
    let verificationPassed = false
    let verificationDetails = ''

    try {
      const results = await tavilySearch(verificationQuery, 3)
      if (results.length > 0) {
        verificationPassed = true
        verificationDetails = `Found ${results.length} sources matching "${verificationQuery}"`
      } else {
        verificationDetails = `No sources found for "${verificationQuery}"`
      }
    } catch (err) {
      verificationDetails = `Verification search failed: ${err instanceof Error ? err.message : 'unknown error'}`
    }

    const result: PredictionResult = {
      prediction: {
        product_name: prediction.product_name || 'Unknown',
        model_number: prediction.model_number || null,
        manufacturer: prediction.manufacturer || 'Unknown',
        product_line: prediction.product_line || '',
        reasoning: prediction.reasoning || '',
        prediction_confidence: prediction.confidence ?? 0.5,
      },
      candidates: prediction.candidates || [],
      verification_query: verificationQuery,
      requires_verification: prediction.confidence < 0.8,
    }

    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[predict]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
