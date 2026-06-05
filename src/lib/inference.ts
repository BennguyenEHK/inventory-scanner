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

  // PRIMARY: HF Inference Providers — GPU-backed, pay-per-token, no pod management
  // Routes by model name (Qwen/Qwen2.5-VL-7B-Instruct, Qwen/Qwen3.6-35B-A3B)
  const hfUrl = process.env.HF_BASE_URL ?? 'https://router.huggingface.co/v1/chat/completions'
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

  // FALLBACK: RunPod persistent pod (optional — skipped if RUNPOD_BASE_URL not set)
  if (!process.env.RUNPOD_BASE_URL) {
    throw new Error('Inference failed: HF unavailable and RUNPOD_BASE_URL not configured')
  }

  const rpHeaders: Record<string, string> = { 'Content-Type': 'application/json' }
  if (process.env.RUNPOD_API_KEY) rpHeaders.Authorization = `Bearer ${process.env.RUNPOD_API_KEY}`

  const rpRes = await fetch(`${process.env.RUNPOD_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: rpHeaders,
    body: JSON.stringify({ ...payload, model: process.env.RUNPOD_MODEL ?? model }),
    signal: AbortSignal.timeout(Number(process.env.RUNPOD_TIMEOUT_MS ?? 90_000)),
  })
  if (!rpRes.ok) throw new Error(`RunPod fallback HTTP ${rpRes.status}`)
  const rpData = await rpRes.json() as { choices?: { message: { content: string } }[] }
  if (rpData.choices?.[0]) return stripThinking(rpData.choices[0].message.content)
  throw new Error('Both HF and RunPod failed to return a response')
}
