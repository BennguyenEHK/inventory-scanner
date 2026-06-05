import { selectProductImages } from '@/lib/image-pipeline'
import { generateItemId } from '@/lib/itemId'
import type { VisionResult, PredictionResult, SearchResult, CheckpointResult, InventoryItem, FinalReport } from '@/types'

function assembleNotes(search: SearchResult, flags: string[]): string {
  const breakdown = search.sources.map(s => `${s.name} $${s.price}`).join(' | ')
  const summary = `Prices: ${breakdown} | Range: $${search.min}–$${search.max} | Avg: $${search.avg}`
  const flagStr = flags.length > 0 ? '\n' + flags.join('\n') : '\nAll fields verified — no issues'
  return summary + flagStr
}

export async function POST(request: Request): Promise<Response> {
  try {
    const { vision, prediction, search, cp1, cp2 } = await request.json() as {
      vision: VisionResult
      prediction?: PredictionResult
      search: SearchResult
      cp1: CheckpointResult
      cp2: CheckpointResult
    }

    const flags: string[] = []
    if (!cp1.passed) flags.push('⚠️ Low confidence match — recommend recheck')
    if (cp2.removed_sources && cp2.removed_sources.length > 0)
      flags.push(`Removed ${cp2.removed_sources.length} contaminated price sources`)
    if (search.flag) flags.push(search.flag)
    if (prediction) flags.push('Prediction used — black box image, verify product')

    const productName = prediction?.prediction.product_name ?? vision.brand ?? 'Unknown Product'
    const dims = vision.dimensions_visible?.split('x').map(d => d.trim()) ?? []

    const item: InventoryItem = {
      itemId:          generateItemId(),
      ItemName:        productName,
      itemDescription: `${vision.product_category} — ${vision.color} ${vision.shape}`,
      Qty:             null,
      Manufacturer:    vision.brand ?? prediction?.prediction.manufacturer ?? '',
      Length:          dims[0] ?? '',
      Width:           dims[1] ?? '',
      Market_Price:    search.avg,
      Currency:        search.currency,
      Sales_Unit:      search.sources[0]?.unit ?? 'Each',
      Item_Origin:     '',
      Ext_Price:       null,
      Notes:           assembleNotes(search, flags),
    }

    const images = await selectProductImages(productName, search.sources, vision)
    const sourceCount = cp2.clean_sources?.length ?? search.sources.length

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
