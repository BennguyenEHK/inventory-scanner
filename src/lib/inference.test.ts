import { describe, it, expect } from 'vitest'
import { stripThinking } from './inference'

describe('stripThinking', () => {
  it('removes <think> blocks', () => {
    const raw = '<think>reasoning here</think>\n{"result":true}'
    expect(stripThinking(raw)).toBe('{"result":true}')
  })

  it('passes through text with no think blocks', () => {
    expect(stripThinking('{"ok":1}')).toBe('{"ok":1}')
  })

  it('handles multiline think blocks', () => {
    const raw = '<think>\nline 1\nline 2\n</think>\nresult'
    expect(stripThinking(raw)).toBe('result')
  })

  it('handles multiple think blocks', () => {
    const raw = '<think>first</think>\ndata\n<think>second</think>\nmore'
    // double newline between stripped blocks is fine — JSON.parse handles whitespace
    expect(stripThinking(raw)).toBe('data\n\nmore')
  })
})
