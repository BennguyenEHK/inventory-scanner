import { describe, it, expect } from 'vitest'
import { parseCommand } from './parse'

describe('parseCommand', () => {
  it('parses "save qty 50"', () => {
    const r = parseCommand('save qty 50')
    expect(r.action).toBe('save')
    expect(r.qty).toBe(50)
  })

  it('parses "save 100 units"', () => {
    const r = parseCommand('save 100 units')
    expect(r.action).toBe('save')
    expect(r.qty).toBe(100)
  })

  it('parses "update qty to 75"', () => {
    const r = parseCommand('update qty to 75')
    expect(r.action).toBe('update')
    expect(r.qty).toBe(75)
  })

  it('parses "discard"', () => {
    expect(parseCommand('discard').action).toBe('rescan')
  })

  it('parses "show inventory"', () => {
    const r = parseCommand('show inventory')
    expect(r.action).toBe('navigate')
    expect(r.destination).toBe('/inventory')
  })

  it('returns unknown for unrecognised input', () => {
    expect(parseCommand('what is the weather').action).toBe('unknown')
  })
})
