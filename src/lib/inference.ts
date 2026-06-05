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

// Exported for testing
export function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
}

// Exported for testing
export function getEndpointId(model: string): string {
  if (model.includes('VL')) return process.env.RUNPOD_VISION_ENDPOINT_ID!
  if (model.includes('Qwen3')) return process.env.RUNPOD_REASONING_ENDPOINT_ID!
  throw new Error(`Unknown model: ${model}`)
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
    model, messages, temperature,
    max_tokens: enable_thinking ? budget_tokens : max_tokens,
  }
  if (enable_thinking) {
    payload.chat_template_kwargs = { enable_thinking: true }
  }

  // RunPod primary
  try {
    const endpointId = getEndpointId(model)
    const res = await fetch(
      `${process.env.RUNPOD_BASE_URL}/${endpointId}/runsync`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.RUNPOD_API_KEY}` },
        body: JSON.stringify({ input: payload }),
        signal: AbortSignal.timeout(Number(process.env.RUNPOD_TIMEOUT_MS ?? 90_000)),
      }
    )
    const data = await res.json() as { status: string; output?: { choices?: { message: { content: string } }[] } }
    if (data.status === 'COMPLETED' && data.output?.choices?.[0]) {
      return stripThinking(data.output.choices[0].message.content)
    }
    throw new Error(`RunPod status: ${data.status}`)
  } catch (err) {
    console.error('[inference] RunPod failed → HF fallback:', err instanceof Error ? err.message : String(err))
  }

  // HuggingFace fallback
  const hfRes = await fetch(process.env.HF_BASE_URL!, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.HF_API_KEY}` },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(60_000),
  })
  if (!hfRes.ok) throw new Error(`HF fallback failed: ${hfRes.status}`)
  const hfData = await hfRes.json() as { choices: { message: { content: string } }[] }
  return stripThinking(hfData.choices[0].message.content)
}
