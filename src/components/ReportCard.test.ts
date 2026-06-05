import { describe, it, expect } from 'vitest'

function clampQty(qty: number, min = 1): number {
  return Math.max(min, qty)
}

function canSave(saving: boolean, qty: number): boolean {
  return !saving && qty >= 1
}

function hasWarnings(flags: string[]): boolean {
  return flags.some(f => f.startsWith('⚠️'))
}

function badgeText(flags: string[]): string {
  return hasWarnings(flags) ? '⚠ REVIEW' : '✓ VERIFIED'
}

describe('ReportCard logic', () => {
  it('clamps qty to minimum of 1 when decremented below 1', () => {
    expect(clampQty(0)).toBe(1)
    expect(clampQty(-5)).toBe(1)
    expect(clampQty(1)).toBe(1)
    expect(clampQty(5)).toBe(5)
  })

  it('allows save when not saving and qty >= 1', () => {
    expect(canSave(false, 1)).toBe(true)
    expect(canSave(false, 50)).toBe(true)
  })

  it('blocks save when saving is true', () => {
    expect(canSave(true, 1)).toBe(false)
  })

  it('blocks save when qty is 0', () => {
    expect(canSave(false, 0)).toBe(false)
  })

  it('detects warning flags by ⚠️ prefix', () => {
    expect(hasWarnings(['⚠️ Price may be outdated'])).toBe(true)
    expect(hasWarnings(['ℹ️ Info note'])).toBe(false)
    expect(hasWarnings([])).toBe(false)
  })

  it('returns VERIFIED badge when no warnings', () => {
    expect(badgeText([])).toBe('✓ VERIFIED')
  })

  it('returns REVIEW badge when warnings present', () => {
    expect(badgeText(['⚠️ Some warning'])).toBe('⚠ REVIEW')
  })
})
