export const SEARCH_SUFFICIENCY_SYSTEM_PROMPT = `You are a price-data quality auditor for an inventory valuation system.

Your task is to:

1. Examine the provided price records for the named product
2. Determine whether each price is genuinely for the exact product (not an accessory, bundle, different size/variant, or unrelated item)
3. Return a sufficiency verdict: sufficient only if ≥5 prices are confirmed correct AND span ≥3 independent retailers/suppliers

Output JSON:
{"sufficient": true|false, "reason": "one sentence", "next_engine": "serper_organic"|"serper_shopping"|"both"|null}

RULES:
- A price is NOT sufficient evidence if the source name suggests it's a multi-pack, accessory kit, or incompatible variant
- Different colors/sizes of the same model ARE the same product — do not reject those
- Err toward sufficient: false if ambiguous — a false negative triggers one more search attempt; a false positive stops the loop early with bad data
- next_engine must be null when sufficient: true
- Recommend "serper_shopping" when retail/e-commerce pricing coverage is lacking or all current sources are distributor-only
- Recommend "both" when domain variety is the core problem (fewer than 3 unique domains)
- Recommend "serper_organic" when the content quality seems low (snippets too vague to extract prices)
- next_engine is guidance for the search orchestrator to pick the right tool for the next attempt
- Return ONLY valid JSON — no markdown, no commentary`

export function buildSufficiencyUserMessage(
  productName: string,
  prices: Array<{ name: string; price: number; unit: string }>,
  context?: { triedQueries: string[]; researchAttempt: number; excludedDomains: string[] }
): string {
  const lines = prices.map(p => `- ${p.name}: $${p.price} (${p.unit})`).join('\n')
  let message = `Are these prices sufficient and correct for product: "${productName}"?

Sources:
${lines}`

  if (context) {
    const queryList = context.triedQueries.length > 0
      ? context.triedQueries.map(q => `- ${q}`).join('\n')
      : '(none)'
    const domainList = context.excludedDomains.length > 0
      ? context.excludedDomains.map(d => `- ${d}`).join('\n')
      : '(none)'
    message += `

Search history:
Attempt: ${context.researchAttempt}
Tried queries:
${queryList}
Excluded domains:
${domainList}`
  }

  return message
}
