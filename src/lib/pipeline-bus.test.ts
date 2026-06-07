import { describe, it, expect } from 'vitest'
import { busEventToLine } from './pipeline-bus'

describe('busEventToLine — search engine logging', () => {
  it('labels Serper Shopping results distinctly with a count', () => {
    const line = busEventToLine({
      kind: 'search_urls',
      engine: 'Serper Shopping',
      urls: ['https://a.com/p', 'https://b.com/p'],
    })
    expect(line?.stageId).toBe(3)
    expect(line?.line).toContain('Serper Shopping')
    expect(line?.line).toContain('2 URLs')
  })

  it('labels Serper Organic results distinctly (singular URL)', () => {
    const line = busEventToLine({ kind: 'search_urls', engine: 'Serper Organic', urls: ['https://a.com/p'] })
    expect(line?.line).toContain('Serper Organic')
    expect(line?.line).toContain('1 URL')
  })

  // Regression: a skipped engine must NOT render as "0 URLs" (the bug the user hit).
  it('renders a skipped engine clearly instead of a misleading empty-URL line', () => {
    const line = busEventToLine({ kind: 'search_skip', engine: 'Serper Organic', reason: 'shopping-first' })
    expect(line?.stageId).toBe(3)
    expect(line?.line).toContain('skipped')
    expect(line?.line).toContain('Serper Organic')
    expect(line?.line).not.toContain('0 URL')
  })
})

describe('busEventToLine — extraction layer logging', () => {
  it('formats extract_layer with hostname + layer tag + detail', () => {
    const line = busEventToLine({ kind: 'extract_layer', url: 'https://shop.example.com/p/1', layer: 'L2', detail: 'Jina fetch' })
    expect(line?.line).toContain('[L2]')
    expect(line?.line).toContain('shop.example.com')
    expect(line?.line).toContain('Jina fetch')
  })

  it('formats extract_output with the layer output summary', () => {
    const line = busEventToLine({ kind: 'extract_output', url: 'https://shop.example.com/p/1', layer: 'L1', output: 'price 12.5 USD' })
    expect(line?.line).toContain('[L1]')
    expect(line?.line).toContain('price 12.5 USD')
  })
})
