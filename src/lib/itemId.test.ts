import { describe, it, expect, beforeEach } from 'vitest'
import { generateItemId, resetCounter } from './itemId'

describe('generateItemId', () => {
  beforeEach(() => resetCounter())

  it('generates correct format', () => {
    const id = generateItemId()
    expect(id).toMatch(/^INV-\d{8}-\d{4}$/)
  })

  it('increments counter on each call', () => {
    const id1 = generateItemId()
    const id2 = generateItemId()
    const seq1 = id1.split('-')[2]
    const seq2 = id2.split('-')[2]
    expect(Number(seq2)).toBe(Number(seq1) + 1)
  })

  it('starts counter at 0001', () => {
    const id = generateItemId()
    expect(id.split('-')[2]).toBe('0001')
  })
})
