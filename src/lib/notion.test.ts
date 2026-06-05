import { describe, it, expect } from 'vitest'
import { buildNotionProperties, parseNotionPage } from './notion'
import type { InventoryItem } from '@/types'

const item: InventoryItem = {
  itemId: 'INV-20260605-0001',
  ItemName: '3M Scotch 810',
  itemDescription: 'Magic tape 3/4in x 1000in',
  Qty: 50,
  Manufacturer: '3M',
  Length: '1000 in',
  Width: '3/4 in',
  Market_Price: 12.28,
  Currency: 'USD',
  Sales_Unit: 'Each',
  Item_Origin: 'USA',
  Ext_Price: 614.00,
  Notes: 'All verified',
}

describe('buildNotionProperties', () => {
  it('sets itemId as title type', () => {
    const props = buildNotionProperties(item)
    expect(props.itemId).toEqual({ title: [{ text: { content: 'INV-20260605-0001' } }] })
  })

  it('sets Qty as number type', () => {
    const props = buildNotionProperties(item)
    expect(props.Qty).toEqual({ number: 50 })
  })

  it('sets Market_Price as number type', () => {
    const props = buildNotionProperties(item)
    expect(props.Market_Price).toEqual({ number: 12.28 })
  })

  it('sets ItemName as rich_text type', () => {
    const props = buildNotionProperties(item)
    expect(props.ItemName).toEqual({ rich_text: [{ text: { content: '3M Scotch 810' } }] })
  })
})

describe('parseNotionPage', () => {
  it('round-trips itemId from title property', () => {
    const page = {
      properties: {
        itemId: { title: [{ plain_text: 'INV-20260605-0001' }] },
        ItemName: { rich_text: [{ plain_text: '3M Scotch 810' }] },
        itemDescription: { rich_text: [{ plain_text: 'desc' }] },
        Qty: { number: 50 },
        Manufacturer: { rich_text: [{ plain_text: '3M' }] },
        Length: { rich_text: [{ plain_text: '1000 in' }] },
        Width: { rich_text: [{ plain_text: '3/4 in' }] },
        Market_Price: { number: 12.28 },
        Currency: { rich_text: [{ plain_text: 'USD' }] },
        Sales_Unit: { rich_text: [{ plain_text: 'Each' }] },
        Item_Origin: { rich_text: [{ plain_text: 'USA' }] },
        Ext_Price: { number: 614 },
        Notes: { rich_text: [{ plain_text: 'All verified' }] },
      },
    }
    const parsed = parseNotionPage(page)
    expect(parsed.itemId).toBe('INV-20260605-0001')
    expect(parsed.Market_Price).toBe(12.28)
    expect(parsed.Qty).toBe(50)
  })
})
