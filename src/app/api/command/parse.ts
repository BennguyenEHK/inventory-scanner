import type { ParsedCommand } from '@/types'

export function parseCommand(input: string): ParsedCommand {
  const s = input.trim().toLowerCase()
  const raw = input.trim()

  // "save qty 50" / "save 50" / "save 50 units"
  const saveMatch = s.match(/^save(?:\s+qty)?\s+(\d+)/)
  if (saveMatch) return { action: 'save', qty: parseInt(saveMatch[1], 10), raw }

  // "update qty to 75" / "update to 75" / "update 75"
  const updateMatch = s.match(/^update(?:\s+(?:qty\s+)?to)?\s+(\d+)/)
  if (updateMatch) return { action: 'update', qty: parseInt(updateMatch[1], 10), raw }

  // "delete" / "archive" / "discard" / "remove"
  if (/^(delete|archive|discard|remove)\b/.test(s))
    return { action: 'rescan', raw }

  // "show inventory" / "inventory" / "go to inventory"
  if (/inventory/.test(s))
    return { action: 'navigate', destination: '/inventory', raw }

  // "rescan" / "scan again" / "new scan" / "restart"
  if (/^(rescan|scan again|new scan|restart)\b/.test(s))
    return { action: 'rescan', raw }

  return { action: 'unknown', raw }
}
