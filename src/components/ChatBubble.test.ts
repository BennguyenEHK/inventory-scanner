import { describe, it, expect } from 'vitest'

// Pure logic extracted from ChatBubble — test these before writing the component

type StageStatus = 'pending' | 'running' | 'done' | 'skipped' | 'error'

const STATUS_COLOR: Record<StageStatus, string> = {
  done:    'text-[#34d399]',
  running: 'text-[#fb923c]',
  error:   'text-red-400',
  skipped: 'text-[#4c3a6e]',
  pending: 'text-[#4c3a6e]',
}

const STATUS_ICON: Record<StageStatus, string> = {
  done:    '✓',
  running: '⟳',
  error:   '✕',
  skipped: '–',
  pending: '·',
}

function isDimmed(status: StageStatus): boolean {
  return status === 'pending' || status === 'skipped'
}

describe('ChatBubble logic', () => {
  it('maps every StageStatus to a color class', () => {
    const statuses: StageStatus[] = ['done', 'running', 'error', 'skipped', 'pending']
    for (const s of statuses) {
      expect(STATUS_COLOR[s]).toBeTruthy()
    }
  })

  it('maps every StageStatus to an icon', () => {
    const statuses: StageStatus[] = ['done', 'running', 'error', 'skipped', 'pending']
    for (const s of statuses) {
      expect(STATUS_ICON[s]).toBeTruthy()
    }
  })

  it('done stage uses confirmed color', () => {
    expect(STATUS_COLOR['done']).toBe('text-[#34d399]')
  })

  it('running stage uses orange color', () => {
    expect(STATUS_COLOR['running']).toBe('text-[#fb923c]')
  })

  it('error stage uses red color', () => {
    expect(STATUS_COLOR['error']).toBe('text-red-400')
  })

  it('pending and skipped are dimmed', () => {
    expect(isDimmed('pending')).toBe(true)
    expect(isDimmed('skipped')).toBe(true)
    expect(isDimmed('done')).toBe(false)
    expect(isDimmed('running')).toBe(false)
    expect(isDimmed('error')).toBe(false)
  })

  it('photos bubble: count label is singular for 1 photo', () => {
    const count = 1
    const label = `${count} photo${count !== 1 ? 's' : ''} captured`
    expect(label).toBe('1 photo captured')
  })

  it('photos bubble: count label is plural for multiple photos', () => {
    const count: number = 3
    const label = `${count} photo${count !== 1 ? 's' : ''} captured`
    expect(label).toBe('3 photos captured')
  })
})
