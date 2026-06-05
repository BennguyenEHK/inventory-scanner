import type { InventoryItem } from '@/types'

const NOTION_BASE = 'https://api.notion.com/v1'
const NOTION_VERSION = '2022-06-28'

function headers() {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${process.env.NOTION_API_KEY}`,
    'Notion-Version': NOTION_VERSION,
  }
}

// Exported for testing
export function buildNotionProperties(item: InventoryItem): Record<string, unknown> {
  const rt = (s: string) => ({ rich_text: [{ text: { content: s } }] })
  return {
    itemId:          { title: [{ text: { content: item.itemId } }] },
    ItemName:        rt(item.ItemName),
    itemDescription: rt(item.itemDescription),
    Qty:             { number: item.Qty },
    Manufacturer:    rt(item.Manufacturer),
    Length:          rt(item.Length),
    Width:           rt(item.Width),
    Market_Price:    { number: item.Market_Price },
    Currency:        rt(item.Currency),
    Sales_Unit:      rt(item.Sales_Unit),
    Item_Origin:     rt(item.Item_Origin),
    Ext_Price:       { number: item.Ext_Price },
    Notes:           rt(item.Notes),
  }
}

// Exported for testing
export function parseNotionPage(page: Record<string, unknown>): InventoryItem {
  const p = page.properties as Record<string, {
    title?: { plain_text: string }[]
    rich_text?: { plain_text: string }[]
    number?: number
  }>
  const txt = (key: string) => p[key]?.rich_text?.[0]?.plain_text ?? ''
  const num = (key: string) => p[key]?.number ?? 0
  return {
    itemId:          p.itemId?.title?.[0]?.plain_text ?? '',
    ItemName:        txt('ItemName'),
    itemDescription: txt('itemDescription'),
    Qty:             p.Qty?.number ?? null,
    Manufacturer:    txt('Manufacturer'),
    Length:          txt('Length'),
    Width:           txt('Width'),
    Market_Price:    num('Market_Price'),
    Currency:        txt('Currency'),
    Sales_Unit:      txt('Sales_Unit'),
    Item_Origin:     txt('Item_Origin'),
    Ext_Price:       p.Ext_Price?.number ?? null,
    Notes:           txt('Notes'),
  }
}

export async function notionInsert(item: InventoryItem): Promise<{ id: string }> {
  const res = await fetch(`${NOTION_BASE}/pages`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      parent: { database_id: process.env.NOTION_DATABASE_ID },
      properties: buildNotionProperties(item),
    }),
  })
  if (!res.ok) throw new Error(`Notion insert failed: ${res.status} ${await res.text()}`)
  return res.json() as Promise<{ id: string }>
}

export async function notionQuery(filter?: Record<string, unknown>): Promise<InventoryItem[]> {
  const body: Record<string, unknown> = {
    sorts: [{ timestamp: 'created_time', direction: 'descending' }],
    page_size: 50,
  }
  if (filter) body.filter = filter
  const res = await fetch(`${NOTION_BASE}/databases/${process.env.NOTION_DATABASE_ID}/query`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Notion query failed: ${res.status}`)
  const data = await res.json() as { results: Record<string, unknown>[] }
  return data.results.map(parseNotionPage)
}

export async function notionGetPageId(itemId: string): Promise<string> {
  const res = await fetch(`${NOTION_BASE}/databases/${process.env.NOTION_DATABASE_ID}/query`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ filter: { property: 'itemId', title: { equals: itemId } } }),
  })
  const data = await res.json() as { results: { id: string }[] }
  if (!data.results[0]) throw new Error(`Item not found: ${itemId}`)
  return data.results[0].id
}

export async function notionUpdate(itemId: string, patch: Partial<InventoryItem>): Promise<void> {
  const pageId = await notionGetPageId(itemId)
  const props: Record<string, unknown> = {}
  if (patch.Qty !== undefined)       props.Qty       = { number: patch.Qty }
  if (patch.Ext_Price !== undefined) props.Ext_Price = { number: patch.Ext_Price }
  if (patch.Notes !== undefined)     props.Notes     = { rich_text: [{ text: { content: patch.Notes } }] }
  const res = await fetch(`${NOTION_BASE}/pages/${pageId}`, {
    method: 'PATCH',
    headers: headers(),
    body: JSON.stringify({ properties: props }),
  })
  if (!res.ok) throw new Error(`Notion update failed: ${res.status}`)
}

export async function notionArchive(itemId: string): Promise<void> {
  const pageId = await notionGetPageId(itemId)
  const res = await fetch(`${NOTION_BASE}/pages/${pageId}`, {
    method: 'PATCH',
    headers: headers(),
    body: JSON.stringify({ archived: true }),
  })
  if (!res.ok) throw new Error(`Notion archive failed: ${res.status}`)
}
