import { selectProductImages } from '@/lib/image-pipeline'
import { generateItemId } from '@/lib/itemId'
import type { VisionResult, PredictionResult, SearchResult, InventoryItem, FinalReport, PriceSource } from '@/types'

function assembleNotes(search: SearchResult, flags: string[]): string {
  const breakdown = search.sources.map(s => `${s.name} $${s.price}`).join(' | ')
  const summary = `Prices: ${breakdown} | Range: $${search.min}–$${search.max} | Avg: $${search.avg}`
  const flagStr = flags.length > 0 ? '\n' + flags.join('\n') : '\nAll fields verified — no issues'
  return summary + flagStr
}

export async function POST(request: Request): Promise<Response> {
  try {
    const { vision, prediction, search } = await request.json() as {
      vision: VisionResult
      prediction?: PredictionResult
      search: SearchResult
    }

    const flags: string[] = []
    if (vision.confidence < 0.65) flags.push('⚠️ Low confidence match — recommend recheck')
    if (search.contaminated_removed && search.contaminated_removed.length > 0)
      flags.push(`Removed ${search.contaminated_removed.length} contaminated price sources`)
    if (search.flag) flags.push(search.flag)
    if (prediction) flags.push('Prediction used — black box image, verify product')

    const productName = prediction?.prediction.product_name ?? vision.brand ?? 'Unknown Product'
    const dims = vision.dimensions_visible?.split('x').map(d => d.trim()) ?? []

    // Find the first source with each optional field
    const firstWith = <K extends keyof PriceSource>(key: K) =>
      search.sources.find(s => s[key] != null)?.[key]

    const safeAvg = Number.isFinite(search.avg) ? search.avg : 0

    const item: InventoryItem = {
      itemId:          generateItemId(),
      ItemName:        productName,
      itemDescription: `${vision.product_category} — ${vision.color} ${vision.shape}`,
      Qty:             null,
      Manufacturer:    vision.brand
                       ?? prediction?.prediction.manufacturer
                       ?? firstWith('manufacturer') as string | undefined
                       ?? '',
      Length:          dims[0] ?? firstWith('length') as string | undefined ?? '',
      Width:           dims[1] ?? firstWith('width')  as string | undefined ?? '',
      Market_Price:    safeAvg,
      Currency:        search.currency,
      Sales_Unit:      search.sources[0]?.unit ?? 'Each',
      Item_Origin:     firstWith('items_origin') as string | undefined ?? '',
      Ext_Price:       null,
      Notes:           assembleNotes(search, flags),
    }

    const images = await selectProductImages(productName, search.sources, vision)
    const sourceCount = search.sources.length

    const report: FinalReport = {
      report_html: productName,
      notion_json:  item,
      images,
      flags,
      sourceCount,
    }

    return Response.json(report)
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Report assembly failed' },
      { status: 500 }
    )
  }
}
