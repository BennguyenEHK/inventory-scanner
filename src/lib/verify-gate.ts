import type { PriceSource, VisionResult } from '@/types'

export enum ManufacturerFlag {
  None = 'none',
  Mismatch = 'mismatch',
}

export interface VerifyResult {
  discard: boolean
  manufacturerFlag: ManufacturerFlag
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function significantWords(s: string): string[] {
  return s.toLowerCase().split(/\s+/).filter(w => w.length > 3)
}

export function applyVerifyGate(source: PriceSource, vision: VisionResult): VerifyResult {
  const result: VerifyResult = { discard: false, manufacturerFlag: ManufacturerFlag.None }

  // Manufacturer — soft flag only
  if (source.manufacturer && vision.brand) {
    const a = normalize(source.manufacturer)
    const b = normalize(vision.brand)
    if (a && b && !a.includes(b) && !b.includes(a)) {
      result.manufacturerFlag = ManufacturerFlag.Mismatch
    }
  }

  // Description — hard discard only when zero meaningful-word overlap
  if (source.itemDescription && vision.product_category) {
    const descWords = new Set(significantWords(source.itemDescription))
    const catWords = significantWords(vision.product_category)
    if (catWords.length > 0 && catWords.every(w => !descWords.has(w))) {
      result.discard = true
    }
  }

  return result
}
