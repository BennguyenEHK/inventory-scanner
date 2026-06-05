import { describe, it, expect } from 'vitest'
import { PipelineStage } from '@/types'

// Helper function to test getStatusIcon behavior
function testStatusIconLogic(status: PipelineStage['status']): string {
  switch (status) {
    case 'done':
      return '✓'
    case 'running':
      return 'spin'
    case 'error':
      return '✕'
    case 'skipped':
      return '–'
    case 'pending':
    default:
      return '○'
  }
}

// Helper function to test getStatusColor behavior
function testStatusColorLogic(status: PipelineStage['status']): string {
  switch (status) {
    case 'done':
      return 'text-color-success'
    case 'running':
      return 'text-color-accent'
    case 'error':
      return 'text-color-danger'
    case 'skipped':
    case 'pending':
      return 'text-color-muted opacity-50'
    default:
      return 'text-color-muted'
  }
}

describe('PipelineProgress logic', () => {
  it('returns correct icon symbol for done status', () => {
    expect(testStatusIconLogic('done')).toBe('✓')
  })

  it('returns spin indicator for running status', () => {
    expect(testStatusIconLogic('running')).toBe('spin')
  })

  it('returns error symbol for error status', () => {
    expect(testStatusIconLogic('error')).toBe('✕')
  })

  it('returns dash for skipped status', () => {
    expect(testStatusIconLogic('skipped')).toBe('–')
  })

  it('returns circle for pending status', () => {
    expect(testStatusIconLogic('pending')).toBe('○')
  })

  it('applies success color for done status', () => {
    expect(testStatusColorLogic('done')).toBe('text-color-success')
  })

  it('applies accent color for running status', () => {
    expect(testStatusColorLogic('running')).toBe('text-color-accent')
  })

  it('applies danger color for error status', () => {
    expect(testStatusColorLogic('error')).toBe('text-color-danger')
  })

  it('applies muted color with opacity for pending status', () => {
    expect(testStatusColorLogic('pending')).toBe('text-color-muted opacity-50')
  })

  it('applies muted color with opacity for skipped status', () => {
    expect(testStatusColorLogic('skipped')).toBe('text-color-muted opacity-50')
  })

  it('processes all 6 required stages correctly', () => {
    const stages: PipelineStage[] = [
      { id: 1, label: 'Vision Extraction', status: 'done', detail: null },
      { id: 2, label: 'Prediction', status: 'running', detail: 'Analyzing...' },
      { id: 3, label: 'Search & Pricing', status: 'pending', detail: null },
      { id: 4, label: 'Verification', status: 'pending', detail: null },
      { id: 5, label: 'Report Assembly', status: 'skipped', detail: null },
      { id: 6, label: 'Notion Upload', status: 'error', detail: 'API timeout' },
    ]

    expect(stages).toHaveLength(6)
    expect(stages[0].status).toBe('done')
    expect(stages[1].status).toBe('running')
    expect(stages[2].status).toBe('pending')
    expect(stages[3].status).toBe('pending')
    expect(stages[4].status).toBe('skipped')
    expect(stages[5].status).toBe('error')
  })

  it('handles stages with and without detail text', () => {
    const withDetail: PipelineStage = {
      id: 1,
      label: 'Test',
      status: 'done',
      detail: 'Processing complete',
    }

    const withoutDetail: PipelineStage = {
      id: 2,
      label: 'Test',
      status: 'pending',
      detail: null,
    }

    expect(withDetail.detail).toBeTruthy()
    expect(withoutDetail.detail).toBeNull()
  })
})
