import { parseCommand } from './parse'

export async function POST(request: Request): Promise<Response> {
  try {
    const { text } = await request.json() as { text: string }
    if (!text?.trim())
      return Response.json({ error: 'text required' }, { status: 400 })
    return Response.json(parseCommand(text))
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Command parse failed' },
      { status: 500 }
    )
  }
}
