'use server'

import { notionInsert, notionQuery, notionUpdate, notionArchive } from '@/lib/notion'
import type { InventoryItem } from '@/types'

export async function saveItem(item: InventoryItem, qty: number): Promise<{
  success: boolean; message: string; pageId?: string
}> {
  if (!Number.isFinite(qty) || qty < 0 || qty > 1_000_000)
    throw new Error('qty must be a finite number between 0 and 1,000,000')
  const record: InventoryItem = {
    ...item,
    Qty:       qty,
    Ext_Price: Math.round(item.Market_Price * qty * 100) / 100,
  }
  const page = await notionInsert(record)
  return {
    success: true,
    message: `✅ Saved — ${record.itemId} | ${record.ItemName} | Qty: ${qty} | Ext: $${record.Ext_Price}`,
    pageId:  page.id,
  }
}

export async function queryItems(
  filter?: Record<string, unknown>
): Promise<InventoryItem[]> {
  return notionQuery(filter)
}

export async function updateItem(
  itemId: string,
  qty: number
): Promise<{ success: boolean; message: string }> {
  if (!Number.isFinite(qty) || qty < 0 || qty > 1_000_000)
    throw new Error('qty must be a finite number between 0 and 1,000,000')
  const [current] = await notionQuery({ property: 'itemId', title: { equals: itemId } })
  if (!current) throw new Error(`Item not found: ${itemId}`)
  const newExtPrice = Math.round(current.Market_Price * qty * 100) / 100
  const updatedNotes = `${current.Notes}\nUpdated: Qty ${current.Qty} → ${qty} | Ext $${current.Ext_Price} → $${newExtPrice}`
  await notionUpdate(itemId, { Qty: qty, Ext_Price: newExtPrice, Notes: updatedNotes })
  return {
    success: true,
    message: `✅ Updated — ${itemId} | Qty: ${qty} | Ext: $${newExtPrice}`,
  }
}

export async function archiveItem(itemId: string): Promise<{ success: boolean; message: string }> {
  await notionArchive(itemId)
  return { success: true, message: `🗑️ Archived — ${itemId}` }
}
