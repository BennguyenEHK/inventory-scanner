'use server'

import { parseCommand } from '@/app/api/command/parse'
import type { ParsedCommand } from '@/types'

export async function parseVoiceCommand(input: string): Promise<ParsedCommand> {
  return parseCommand(input)
}
