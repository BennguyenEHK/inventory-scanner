export interface ModelMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | { type: string; [key: string]: unknown }[]
}

export interface CallModelParams {
  model: string
  messages: ModelMessage[]
  enable_thinking?: boolean
  budget_tokens?: number
  temperature?: number
  max_tokens?: number
}

// Exported for testing — strips Qwen3 <think>...</think> reasoning blocks
export function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
}

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai'
const HF_VISION_FALLBACK_MODEL = 'Qwen/Qwen2.5-VL-7B-Instruct:featherless-ai'

function isGeminiModel(model: string): boolean {
  return model.startsWith('gemini-')
}

// Vision models contain "VL" or are Gemini models
function isVisionModel(model: string): boolean {
  return model.includes('VL') || isGeminiModel(model)
}

async function tryGeminiVision(payload: Record<string, unknown>): Promise<string | null> {
  const apiKey = process.env.GEMINI_KEYS
  if (!apiKey) return null
  try {
    const res = await fetch(`${GEMINI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60_000),
    })
    if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${res.statusText}`)
    const data = await res.json() as { choices?: { message: { content: string } }[] }
    if (data.choices?.[0]) return data.choices[0].message.content
    throw new Error('Gemini returned no choices')
  } catch (err) {
    console.error('[inference] Gemini failed:', err instanceof Error ? err.message : String(err))
    return null
  }
}

async function tryRunPodFallback(
  payload: Record<string, unknown>,
  model: string
): Promise<string | null> {
  const isVision = isVisionModel(model)
  const url    = isVision ? process.env.RUNPOD_VISION_URL    : process.env.RUNPOD_REASONING_URL
  const rpModel = isVision ? process.env.RUNPOD_VISION_MODEL  : process.env.RUNPOD_REASONING_MODEL

  if (!url) return null // pod not configured — skip silently

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (process.env.RUNPOD_API_KEY) headers.Authorization = `Bearer ${process.env.RUNPOD_API_KEY}`

  const res = await fetch(`${url}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...payload, model: rpModel ?? model }),
    signal: AbortSignal.timeout(Number(process.env.RUNPOD_TIMEOUT_MS ?? 90_000)),
  })
  if (!res.ok) throw new Error(`RunPod fallback HTTP ${res.status}`)
  const data = await res.json() as { choices?: { message: { content: string } }[] }
  return data.choices?.[0]?.message.content ?? null
}

export async function callModel(params: CallModelParams): Promise<string> {
  const {
    model, messages,
    enable_thinking = false,
    budget_tokens = 2048,
    temperature = 0.1,
    max_tokens = 1024,
  } = params

  const payload: Record<string, unknown> = {
    model,
    messages,
    temperature,
    max_tokens: enable_thinking ? budget_tokens : max_tokens,
  }
  if (enable_thinking) {
    payload.chat_template_kwargs = { enable_thinking: true }
  }

  // VISION path: Gemini 2.5 Flash (primary) → HF Qwen VL (fallback) → RunPod vision pod
  if (isGeminiModel(model)) {
    const geminiResult = await tryGeminiVision(payload)
    if (geminiResult) return geminiResult
    console.error('[inference] Gemini failed → HF vision fallback')

    // HF fallback uses Qwen VL since HF does not serve Gemini models
    const hfPayload = { ...payload, model: HF_VISION_FALLBACK_MODEL }
    const hfUrl   = process.env.HF_BASE_URL ?? 'https://router.huggingface.co/v1/chat/completions'
    const hfToken = process.env.HF_TOKEN ?? process.env.HF_API_KEY
    try {
      const res = await fetch(hfUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${hfToken}` },
        body: JSON.stringify(hfPayload),
        signal: AbortSignal.timeout(60_000),
      })
      if (!res.ok) throw new Error(`HF HTTP ${res.status}: ${res.statusText}`)
      const data = await res.json() as { choices?: { message: { content: string } }[] }
      if (data.choices?.[0]) return stripThinking(data.choices[0].message.content)
      throw new Error('HF returned no choices')
    } catch (err) {
      console.error('[inference] HF vision fallback failed → RunPod:', err instanceof Error ? err.message : String(err))
    }

    const rpResult = await tryRunPodFallback(payload, HF_VISION_FALLBACK_MODEL)
    if (rpResult) return stripThinking(rpResult)

    throw new Error(`Vision inference failed for model ${model} — Gemini, HF, and RunPod all unavailable`)
  }

  // NON-VISION path: HF Inference Providers (primary) → RunPod fallback
  const hfUrl   = process.env.HF_BASE_URL ?? 'https://router.huggingface.co/v1/chat/completions'
  const hfToken = process.env.HF_TOKEN ?? process.env.HF_API_KEY
  try {
    const res = await fetch(hfUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${hfToken}` },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60_000),
    })
    if (!res.ok) throw new Error(`HF HTTP ${res.status}: ${res.statusText}`)
    const data = await res.json() as { choices?: { message: { content: string } }[] }
    if (data.choices?.[0]) return stripThinking(data.choices[0].message.content)
    throw new Error('HF returned no choices')
  } catch (err) {
    console.error('[inference] HF failed → RunPod fallback:', err instanceof Error ? err.message : String(err))
  }

  // FALLBACK: RunPod — vision pod or reasoning pod depending on model type
  const rpResult = await tryRunPodFallback(payload, model)
  if (rpResult) return stripThinking(rpResult)

  throw new Error(`Inference failed for model ${model} — both HF and RunPod unavailable`)
}
