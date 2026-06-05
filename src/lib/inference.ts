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

  // RUNPOD_MODEL env var overrides the model string (e.g. "inventScan")
  const resolvedModel = process.env.RUNPOD_MODEL ?? model

  const payload: Record<string, unknown> = {
    model: resolvedModel,
    messages,
    temperature,
    max_tokens: enable_thinking ? budget_tokens : max_tokens,
  }
  // Qwen3 extended thinking — only sent when explicitly requested
  if (enable_thinking) {
    payload.chat_template_kwargs = { enable_thinking: true }
  }

  // RunPod persistent pod — standard OpenAI-compatible vLLM server
  // URL format: https://<pod-id>-<port>.proxy.runpod.net/v1
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (process.env.RUNPOD_API_KEY) headers.Authorization = `Bearer ${process.env.RUNPOD_API_KEY}`

    const res = await fetch(`${process.env.RUNPOD_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(Number(process.env.RUNPOD_TIMEOUT_MS ?? 90_000)),
    })
    if (!res.ok) throw new Error(`RunPod HTTP ${res.status}: ${res.statusText}`)
    const data = await res.json() as { choices?: { message: { content: string } }[] }
    if (data.choices?.[0]) return stripThinking(data.choices[0].message.content)
    throw new Error('RunPod returned no choices')
  } catch (err) {
    console.error('[inference] RunPod failed → HF fallback:', err instanceof Error ? err.message : String(err))
  }

  // HuggingFace Inference Providers fallback — same OpenAI-compatible format
  // Accepts both HF_TOKEN and HF_API_KEY env var names
  const hfToken = process.env.HF_TOKEN ?? process.env.HF_API_KEY
  const hfRes = await fetch(process.env.HF_BASE_URL!, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${hfToken}` },
    body: JSON.stringify({ ...payload, model }), // use original model name for HF routing
    signal: AbortSignal.timeout(60_000),
  })
  if (!hfRes.ok) throw new Error(`HF fallback failed: ${hfRes.status}`)
  const hfData = await hfRes.json() as { choices: { message: { content: string } }[] }
  return stripThinking(hfData.choices[0].message.content)
}
