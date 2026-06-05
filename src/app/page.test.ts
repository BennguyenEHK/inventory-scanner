import { describe, it, expect } from 'vitest'
import type { ChatEvent, StageStatus } from '@/types'

const STAGE_LABELS: Record<number, string> = {
  1: 'Vision Extraction',
  2: 'Prediction',
  3: 'Price Search',
  4: 'Verification',
  5: 'Report Assembly',
  6: 'Save to Notion',
}

// Pure stream manipulation functions extracted from the component
function appendEvent(stream: ChatEvent[], event: ChatEvent): ChatEvent[] {
  return [...stream, event]
}

function setStageInStream(
  stream: ChatEvent[],
  id: number,
  status: StageStatus,
  detail?: string,
  data?: Record<string, string>
): ChatEvent[] {
  const existing = stream.find(e => e.kind === 'stage' && e.stageId === id)
  if (existing) {
    return stream.map(e =>
      e.kind === 'stage' && e.stageId === id
        ? { ...e, status, detail: detail ?? e.detail, ...(data ? { data } : {}) }
        : e
    )
  }
  return [...stream, {
    id: `stage-${id}`,
    kind: 'stage' as const,
    stageId: id,
    label: STAGE_LABELS[id],
    status,
    detail: detail ?? null,
    ...(data ? { data } : {}),
  }]
}

function markRunningStagesAsError(stream: ChatEvent[], message: string): ChatEvent[] {
  return stream.map(e =>
    e.kind === 'stage' && e.status === 'running'
      ? { ...e, status: 'error' as StageStatus, detail: message }
      : e
  )
}

describe('page stream logic', () => {
  it('appendEvent grows stream by one', () => {
    const stream: ChatEvent[] = []
    const next = appendEvent(stream, { id: 'e1', kind: 'error', message: 'oops' })
    expect(next).toHaveLength(1)
    expect(next[0].kind).toBe('error')
  })

  it('appendEvent does not mutate original stream', () => {
    const stream: ChatEvent[] = []
    appendEvent(stream, { id: 'e1', kind: 'error', message: 'oops' })
    expect(stream).toHaveLength(0)
  })

  it('setStageInStream appends when stage not yet in stream', () => {
    const result = setStageInStream([], 1, 'running', 'Analyzing…')
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ kind: 'stage', stageId: 1, status: 'running', detail: 'Analyzing…' })
  })

  it('setStageInStream updates existing stage in place', () => {
    const stream = setStageInStream([], 1, 'running', 'Analyzing…')
    const updated = setStageInStream(stream, 1, 'done', 'Bosch drill · 91%')
    expect(updated).toHaveLength(1)
    expect(updated[0]).toMatchObject({ stageId: 1, status: 'done', detail: 'Bosch drill · 91%' })
  })

  it('setStageInStream preserves other events when updating', () => {
    let stream = setStageInStream([], 1, 'running')
    stream = setStageInStream(stream, 2, 'running')
    stream = setStageInStream(stream, 1, 'done', 'done detail')
    expect(stream).toHaveLength(2)
    expect(stream.find(e => e.kind === 'stage' && e.stageId === 1)).toMatchObject({ status: 'done' })
    expect(stream.find(e => e.kind === 'stage' && e.stageId === 2)).toMatchObject({ status: 'running' })
  })

  it('markRunningStagesAsError only affects running stages', () => {
    let stream: ChatEvent[] = []
    stream = setStageInStream(stream, 1, 'done', 'ok')
    stream = setStageInStream(stream, 2, 'running', 'in progress')
    const result = markRunningStagesAsError(stream, 'timeout')
    expect(result.find(e => e.kind === 'stage' && e.stageId === 1)).toMatchObject({ status: 'done' })
    expect(result.find(e => e.kind === 'stage' && e.stageId === 2)).toMatchObject({ status: 'error', detail: 'timeout' })
  })

  it('setStageInStream attaches data payload when provided', () => {
    const result = setStageInStream([], 1, 'done', 'Bosch · 91%', { route: 'A', confidence: '91%' })
    expect(result[0]).toMatchObject({ data: { route: 'A', confidence: '91%' } })
  })

  it('setStageInStream updates data on existing stage', () => {
    const stream = setStageInStream([], 1, 'running')
    const updated = setStageInStream(stream, 1, 'done', 'detail', { route: 'B' })
    expect(updated[0]).toMatchObject({ status: 'done', data: { route: 'B' } })
  })

  it('setStageInStream omits data key when no data provided', () => {
    const result = setStageInStream([], 1, 'running', 'Analyzing…')
    expect(result[0]).not.toHaveProperty('data')
  })

  it('STAGE_LABELS covers all 6 stages', () => {
    for (let i = 1; i <= 6; i++) {
      expect(STAGE_LABELS[i]).toBeTruthy()
    }
  })
})
