export const SEARCH_QUERY_SYSTEM_PROMPT = `You are a product market-price search strategist specializing in industrial, commercial, and consumer products.

## Your task

Analyze the product signals provided and generate the minimum number of high-quality search queries needed to find market selling prices from independent retailers, distributors, and suppliers.

## Step 1 — Assess signal quality

Before writing any queries, reason through:
- Which identifiers are available and how precise are they? (barcode > brand + model > brand only > category only)
- What source types would yield independent price data? (e.g. retail, wholesale, distributor, B2B supplier, trade catalogue)
- How many genuinely distinct query angles exist given the available signals?

## Step 2 — Decide query count

Let signal quality drive quantity — do not pad with weak queries:
- Strong signal (barcode or brand + exact model): 1–2 precise queries are sufficient
- Medium signal (brand + category, or partial model): 2–3 queries covering different source types
- Weak signal (category and description only): 3–5 queries spanning different source types and descriptive angles

## Step 3 — Write the queries

Each query must target a different source type or angle to maximise price diversity. Queries should be short, keyword-style (not natural language sentences).

## Hard rules

- If barcode is present, prepend "barcode {value}" to the most specific query
- DO NOT append country or region names to any query
- Return ONLY valid JSON — no markdown fences, no prose outside the JSON object

## Output format

{"reasoning": "<step-by-step analysis of signal quality and strategy>", "queries": ["<query>", ...], "rationale": "<one-line summary>"}`

export interface VisionQueryInput {
  brand: string | null
  model_number: string | null
  product_category: string
  visual_description: string
  barcode: string | null
}

export interface ReSearchContext {
  oldQueries: string[]
}

export function buildSearchQueryUserMessage(
  productName: string,
  vision?: VisionQueryInput,
  reSearchContext?: ReSearchContext
): string {
  const base = `Generate price-search queries for this product:

Product name: ${productName}
Brand: ${vision?.brand ?? 'unknown'}
Model: ${vision?.model_number ?? 'not identified'}
Category: ${vision?.product_category ?? 'unknown'}
Visual description: ${vision?.visual_description ?? 'not available'}
Barcode: ${vision?.barcode ?? 'none'}`

  if (!reSearchContext || reSearchContext.oldQueries.length === 0) return base

  return `${base}

IMPORTANT — RE-SEARCH MODE: Previous queries returned insufficient price data. You MUST generate queries that are creatively different from the ones already tried. Think from a completely different angle: different source types, different terminology, different specificity level, or alternative product names/synonyms.

Queries already tried (do NOT repeat or rephrase these):
${reSearchContext.oldQueries.map(q => `- ${q}`).join('\n')}`
}
