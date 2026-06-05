import { describe, it, expect } from 'vitest'

function canSubmit(text: string): boolean {
  return text.trim().length > 0
}

function inputBorderClass(listening: boolean, hasText: boolean): string {
  if (listening) return 'border-[#c084fc]/50'
  if (hasText) return 'border-[#4c3a6e]'
  return 'border-[#1a1630]'
}

function sendButtonClass(hasText: boolean): string {
  return hasText
    ? 'bg-gradient-to-br from-[#7c3aed] to-[#2563eb]'
    : 'bg-[#0f0d1e] border border-[#1a1630] opacity-40'
}

describe('CommandBar logic', () => {
  it('cannot submit empty string', () => {
    expect(canSubmit('')).toBe(false)
    expect(canSubmit('   ')).toBe(false)
  })

  it('can submit non-empty text', () => {
    expect(canSubmit('save qty 50')).toBe(true)
    expect(canSubmit(' save ')).toBe(true)
  })

  it('input border is purple when listening', () => {
    expect(inputBorderClass(true, false)).toBe('border-[#c084fc]/50')
    expect(inputBorderClass(true, true)).toBe('border-[#c084fc]/50')
  })

  it('input border dims when has text but not listening', () => {
    expect(inputBorderClass(false, true)).toBe('border-[#4c3a6e]')
  })

  it('input border is default when idle', () => {
    expect(inputBorderClass(false, false)).toBe('border-[#1a1630]')
  })

  it('send button is gradient when has text', () => {
    expect(sendButtonClass(true)).toContain('from-[#7c3aed]')
  })

  it('send button is dimmed when no text', () => {
    expect(sendButtonClass(false)).toContain('opacity-40')
  })
})
