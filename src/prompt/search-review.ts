import type { PriceSource } from '@/types'
import type { VisionQueryInput } from './search-query'

export const SEARCH_REVIEW_SYSTEM_PROMPT = `You are a price-data validator and quality auditor for an inventory valuation system.

Each attempt, you receive a product description (from vision AI) and a list of price sources found by a search engine. Your job has three parts:

## Part 1 — Verify each source
A source is INVALID if:
- The itemDescription or manufacturer clearly does not match the product being priced
- The source is for an accessory, bundle, or incompatible variant (e.g. battery-only listing when product is a complete drill kit)
- The price is implausibly wrong (10x higher or lower than all other sources without explanation)

A source is VALID if:
- It matches the product category and name, even if description is generic
- It is a different color, size, or configuration of the SAME model — still valid
- Metadata is absent (null) — absence of metadata is NOT grounds for rejection

## Part 2 — Decide sufficiency
sufficient: true ONLY when ALL of:
- retained count >= 5
- unique domains in retained >= 3

Err toward sufficient: false when ambiguous. A false negative triggers one more search; a false positive stops early with bad data.

## Part 3 — Generate next_query_hint (only when sufficient: false)
Give a specific, actionable hint for the next search query. Examples:
- "search for part number XB123 to find exact variant"
- "try wholesale distributors instead of retail stores"
- "barcode 0088381614931 may find the exact SKU"

## Output format

{"sufficient": true|false, "retained_ids": [0, 2, 3], "rejected_ids": [{"id": 1, "reason": "description says printer ink — wrong product"}], "next_query_hint": "search wholesale distributors for 3M copper foil tape"}

RULES:
- retained_ids + rejected_ids must together account for ALL source indices (0 to N-1)
- next_query_hint must be null when sufficient: true
- Return ONLY valid JSON — no markdown, no prose outside the JSON object`

export function buildReviewUserMessage(
  productName: string,
  prices: PriceSource[],
  vision?: VisionQueryInput,
  context?: { triedQueries: string[]; researchAttempt: number; excludedDomains: string[] },
): string {
  const sourceList = prices
    .map((p, i) => {
      const meta: string[] = []
      if (p.manufacturer)    meta.push(`manufacturer: ${p.manufacturer}`)
      if (p.itemDescription) meta.push(`description: ${p.itemDescription}`)
      if (p.items_origin)    meta.push(`origin: ${p.items_origin}`)
      if (p.in_stock != null) meta.push(`in_stock: ${p.in_stock}`)
      const metaStr = meta.length > 0 ? ` | ${meta.join(', ')}` : ''
      return `[${i}] ${p.name} — ${p.currency} ${p.price}/${p.unit}${metaStr}`
    })
    .join('\n')

  let msg = `Product: "${productName}"`

  if (vision) {
    msg += `
Vision data:
  Brand: ${vision.brand ?? 'unknown'}
  Model: ${vision.model_number ?? 'not identified'}
  Category: ${vision.product_category}
  Description: ${vision.visual_description}`
  }

  msg += `

Price sources (${prices.length} total):
${sourceList}`

  if (context) {
    const queries = context.triedQueries.slice(-3).join(', ') || '(none)'
    msg += `

Search context: attempt ${context.researchAttempt + 1}, tried queries: ${queries}`
  }

  return msg
}
