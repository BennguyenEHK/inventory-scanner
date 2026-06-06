import type { VisionResult } from '@/types'

// Turn 1: given product vision + user question, generate the best Notion search query
export const INVENTORY_CHECK_QUERY_PROMPT = `You are an inventory database agent for a warehouse management system.

Your task is to:
1. OBSERVE the product information extracted from a photo (brand, model, category, description) and the user's question
2. THINK about the most effective search query to find this product in the Notion inventory database
3. ACT by generating a concise search query string that will match the product if it exists

RULES:
- Prioritize model number if available — it is the most precise identifier
- If model number is absent, use brand + category (e.g. "Brother label printer")
- Keep the query short (2-5 words) — Notion uses "contains" matching, not fuzzy search
- If the brand is unknown, use the product category and a key visual descriptor
- Return ONLY valid JSON — no markdown, no commentary

Output JSON:
{"query": "search string", "reasoning": "one sentence why this query"}`

export function buildInventoryCheckQueryMessage(vision: VisionResult, userPrompt: string): string {
  const signals = [
    vision.brand        ? `Brand: ${vision.brand}`                : null,
    vision.model_number ? `Model: ${vision.model_number}`         : null,
    `Category: ${vision.product_category}`,
    `Description: ${vision.visual_description}`,
    vision.barcode      ? `Barcode: ${vision.barcode}`            : null,
  ].filter(Boolean).join('\n')

  return `User question: "${userPrompt}"

Product signals from photo:
${signals}`
}

// Turn 2: given the Notion results, produce a human-readable conclusion
export const INVENTORY_CHECK_CONCLUSION_PROMPT = `You are an inventory database agent. You have just searched the warehouse inventory database.

Your task is to:
1. Review the search results (which may be empty)
2. Determine whether the scanned product already exists in inventory
3. Provide a clear, concise conclusion for the warehouse operator

RULES:
- If results found: state what was found (name, qty, price), and suggest action (e.g. "update quantity" or "it already exists")
- If no results: clearly state the product is not in inventory and suggest adding it
- Keep the conclusion under 2 sentences — this appears in the UI chat
- Return ONLY valid JSON — no markdown, no commentary

Output JSON:
{"found": true|false, "matchCount": <number>, "conclusion": "one or two sentences for the user"}`

export function buildInventoryCheckConclusionMessage(
  queryUsed: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  results: any[]
): string {
  if (results.length === 0) {
    return `Search query used: "${queryUsed}"\nResults: No matching items found in database.`
  }
  const summary = results.slice(0, 3).map((item, i) =>
    `${i + 1}. ${item.ItemName} | Qty: ${item.Qty ?? 'unknown'} | Price: $${item.Market_Price} | ID: ${item.itemId}`
  ).join('\n')
  return `Search query used: "${queryUsed}"\nResults (${results.length} found):\n${summary}`
}
