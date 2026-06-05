import { notionInsert, notionQuery, notionUpdate, notionArchive } from '@/lib/notion'
import type { InventoryItem } from '@/types'

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      action: 'insert' | 'query' | 'update' | 'archive'
      item?: InventoryItem
      qty?: number
      itemId?: string
      filter?: Record<string, unknown>
    }

    switch (body.action) {
      case 'insert': {
        if (!body.item || body.qty === undefined)
          return Response.json({ error: 'item and qty required' }, { status: 400 })
        // Always compute Ext_Price server-side — never trust client value
        const item: InventoryItem = {
          ...body.item,
          Qty: body.qty,
          Ext_Price: Math.round(body.item.Market_Price * body.qty * 100) / 100,
        }
        const page = await notionInsert(item)
        return Response.json({
          success: true,
          message: `✅ Saved — ${item.itemId} | ${item.ItemName} | Qty: ${item.Qty} | Ext: $${item.Ext_Price}`,
          pageId: page.id,
        })
      }

      case 'query': {
        const items = await notionQuery(body.filter)
        return Response.json({ items })
      }

      case 'update': {
        if (!body.itemId || body.qty === undefined)
          return Response.json({ error: 'itemId and qty required' }, { status: 400 })
        const [current] = await notionQuery({
          property: 'itemId',
          title: { equals: body.itemId },
        })
        if (!current) return Response.json({ error: 'Item not found' }, { status: 404 })
        const newExtPrice = Math.round(current.Market_Price * body.qty * 100) / 100
        const updatedNotes = `${current.Notes}\nUpdated: Qty ${current.Qty} → ${body.qty} | Ext $${current.Ext_Price} → $${newExtPrice}`
        await notionUpdate(body.itemId, { Qty: body.qty, Ext_Price: newExtPrice, Notes: updatedNotes })
        return Response.json({
          success: true,
          message: `✅ Updated — ${body.itemId} | Qty: ${body.qty} | Ext: $${newExtPrice}`,
        })
      }

      case 'archive': {
        if (!body.itemId)
          return Response.json({ error: 'itemId required' }, { status: 400 })
        await notionArchive(body.itemId)
        return Response.json({ success: true, message: `🗑️ Archived — ${body.itemId}` })
      }

      default:
        return Response.json({ error: 'Unknown action' }, { status: 400 })
    }
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Notion operation failed' },
      { status: 500 }
    )
  }
}
