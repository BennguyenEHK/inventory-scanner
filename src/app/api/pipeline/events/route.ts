export const runtime = 'edge'

import { redis } from '@/lib/redis'

const KEY = (runId: string) => `pipeline:${runId}`

// Polls Redis list every 100ms and streams new events as SSE.
// Closes when a {"kind":"done"} event is received or after 5 min idle.
export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url)
  const runId = searchParams.get('runId')
  if (!runId) return new Response('runId required', { status: 400 })

  const encoder = new TextEncoder()
  let cursor = 0
  let idleMs = 0
  const MAX_IDLE_MS = 5 * 60 * 1000 // 5 min

  const stream = new ReadableStream({
    async start(controller) {
      try {
        while (idleMs < MAX_IDLE_MS) {
          const raw = await redis.lrange(KEY(runId), cursor, -1) as unknown[]

          if (raw.length > 0) {
            idleMs = 0
            for (const item of raw) {
              const text = typeof item === 'string' ? item : JSON.stringify(item)
              controller.enqueue(encoder.encode(`data: ${text}\n\n`))
              cursor++
              try {
                const parsed = JSON.parse(text) as { kind: string }
                if (parsed.kind === 'done') { controller.close(); return }
              } catch { /* malformed event — skip */ }
            }
          } else {
            idleMs += 100
          }

          await new Promise(r => setTimeout(r, 100))
        }
        // Timeout — close gracefully
        controller.enqueue(encoder.encode(`data: {"kind":"done"}\n\n`))
        controller.close()
      } catch {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      'Connection':    'keep-alive',
    },
  })
}
