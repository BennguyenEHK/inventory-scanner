import { describe, it, expect } from 'vitest'
import { stripThinking, getEndpointId } from './inference'

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
})

describe('getEndpointId', () => {
  it('returns vision endpoint for VL model', () => {
    process.env.RUNPOD_VISION_ENDPOINT_ID = 'vision-ep-123'
    expect(getEndpointId('Qwen/Qwen2.5-VL-7B-Instruct')).toBe('vision-ep-123')
  })

  it('returns reasoning endpoint for Qwen3 model', () => {
    process.env.RUNPOD_REASONING_ENDPOINT_ID = 'reason-ep-456'
    expect(getEndpointId('Qwen/Qwen3.6-35B-A3B')).toBe('reason-ep-456')
  })

  it('throws for unknown model', () => {
    expect(() => getEndpointId('unknown/model')).toThrow('Unknown model')
  })
})
