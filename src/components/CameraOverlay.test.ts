import { describe, it, expect } from 'vitest'

const MAX_PHOTOS = 3

function canAddMore(count: number, max = MAX_PHOTOS): boolean {
  return count < max
}

function remainingSlots(count: number, max = MAX_PHOTOS): number {
  return Math.max(0, max - count)
}

function sliceToRemaining(files: File[], current: number, max = MAX_PHOTOS): File[] {
  return files.slice(0, Math.max(0, max - current))
}

function analyzeButtonLabel(count: number): string {
  return `⚡ Analyze ${count} Photo${count !== 1 ? 's' : ''} →`
}

// resizeImage logic (dimension math only — no DOM needed)
function computeResizeDimensions(
  width: number,
  height: number,
  maxPx = 1024
): { width: number; height: number } {
  if (width <= maxPx && height <= maxPx) return { width, height }
  if (width > height) {
    return { width: maxPx, height: Math.round(height * maxPx / width) }
  }
  return { width: Math.round(width * maxPx / height), height: maxPx }
}

describe('CameraOverlay logic', () => {
  it('allows adding when count < MAX_PHOTOS', () => {
    expect(canAddMore(0)).toBe(true)
    expect(canAddMore(1)).toBe(true)
    expect(canAddMore(2)).toBe(true)
  })

  it('blocks adding when count >= MAX_PHOTOS', () => {
    expect(canAddMore(3)).toBe(false)
    expect(canAddMore(4)).toBe(false)
  })

  it('calculates remaining slots correctly', () => {
    expect(remainingSlots(0)).toBe(3)
    expect(remainingSlots(1)).toBe(2)
    expect(remainingSlots(2)).toBe(1)
    expect(remainingSlots(3)).toBe(0)
  })

  it('slices files to fit remaining capacity', () => {
    const files = [new File([], 'a'), new File([], 'b'), new File([], 'c'), new File([], 'd')]
    expect(sliceToRemaining(files, 2).length).toBe(1)
    expect(sliceToRemaining(files, 0).length).toBe(3)
    expect(sliceToRemaining(files, 3).length).toBe(0)
  })

  it('shows singular label for 1 photo', () => {
    expect(analyzeButtonLabel(1)).toBe('⚡ Analyze 1 Photo →')
  })

  it('shows plural label for multiple photos', () => {
    expect(analyzeButtonLabel(2)).toBe('⚡ Analyze 2 Photos →')
    expect(analyzeButtonLabel(3)).toBe('⚡ Analyze 3 Photos →')
  })

  describe('computeResizeDimensions', () => {
    it('does not resize images within maxPx', () => {
      const result = computeResizeDimensions(800, 600, 1024)
      expect(result).toEqual({ width: 800, height: 600 })
    })

    it('scales down wide images preserving aspect ratio', () => {
      const result = computeResizeDimensions(2048, 1024, 1024)
      expect(result.width).toBe(1024)
      expect(result.height).toBe(512)
    })

    it('scales down tall images preserving aspect ratio', () => {
      const result = computeResizeDimensions(1024, 2048, 1024)
      expect(result.width).toBe(512)
      expect(result.height).toBe(1024)
    })

    it('handles square images', () => {
      const result = computeResizeDimensions(2000, 2000, 1024)
      expect(result.width).toBe(1024)
      expect(result.height).toBe(1024)
    })
  })
})
