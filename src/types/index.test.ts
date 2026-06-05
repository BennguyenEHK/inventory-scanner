import { describe, it, expect } from 'vitest'
import type { InventoryItem, PipelineStage } from './index'

describe('types', () => {
  it('InventoryItem shape is correct', () => {
    const item: InventoryItem = {
      itemId: 'INV-20260605-0001',
      ItemName: '3M Scotch 810',
      itemDescription: 'Magic tape',
      Qty: null,
      Manufacturer: '3M',
      Length: '1000 in',
      Width: '3/4 in',
      Market_Price: 12.28,
      Currency: 'USD',
      Sales_Unit: 'Each',
      Item_Origin: 'USA',
      Ext_Price: null,
      Notes: 'All verified',
    }
    expect(item.itemId).toBe('INV-20260605-0001')
    expect(item.Qty).toBeNull()
  })

  it('PipelineStage statuses are valid', () => {
    const stage: PipelineStage = { id: 1, label: 'Vision', status: 'done', detail: null }
    expect(['pending','running','done','skipped','error']).toContain(stage.status)
  })
})
