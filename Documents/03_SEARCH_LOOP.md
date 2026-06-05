# STAGE 3 — AGENTIC SEARCH LOOP
> Orchestration Model: `Qwen3.6-35B-A3B` thinking=OFF
> Search Tool: Tavily API
> Scrape Tool: Firecrawl API
> Trigger: confirmed product_name from Stage 1 or Stage 2

---

## PURPOSE
Find prices from 5+ diverse retailer sources.
Uses a ReAct loop — the model decides when enough data is collected,
not a fixed iteration count.

---

## LOOP CONSTANTS

```
TARGET_SOURCES  = 5
MAX_ATTEMPTS    = 3
MIN_PRICE_RATIO = 0.1    // flag if any price is < 10% of median (likely wrong unit)
MAX_PRICE_RATIO = 10.0   // flag if any price is > 10x median (likely wrong product)
```

---

## QUERY GENERATOR (no AI needed — pure logic)

```
function generateQuery(productName, attempt, existingSources):

  foundSourceTypes = existingSources.map(s => s.type)
  // types: "marketplace", "distributor", "manufacturer", "retailer"

  if attempt == 0:
    return productName + " price buy"

  if attempt == 1:
    missing = getMissingSourceType(foundSourceTypes)
    return productName + " " + missing + " cost"

  if attempt == 2:
    return productName + " supplier price USD"
```

---

## REACT LOOP PSEUDOCODE

```
function agenticSearchLoop(productName):

  prices   = []
  attempt  = 0

  while prices.length < TARGET_SOURCES AND attempt < MAX_ATTEMPTS:

    // THINK — generate query
    query = generateQuery(productName, attempt, prices)

    // ACT — parallel search
    urls = tavily.search(query, max_results=8)

    // ACT — parallel scrape (all at once, not sequential)
    scraped = Promise.all(
      urls.map(url => firecrawl.extract(url, PRICE_SCHEMA))
    )

    // OBSERVE — filter valid results
    valid   = scraped.filter(r => r.price > 0 AND r.currency != null)
    prices  = deduplicate([...prices, ...valid])

    // THINK — sufficiency check (Qwen3.6 thinking=OFF)
    check = model.evaluate({
      task:     "Are these 5+ prices for the correct product?",
      product:  productName,
      results:  prices,
      thinking: false           // fast mode for loop decisions
    })

    if check.sufficient == true:
      break                     // agentic stop condition

    attempt++

  return prices
```

---

## FIRECRAWL PRICE SCHEMA
Pass this schema to every Firecrawl extract call:

```json
{
  "price":    "number — the product selling price",
  "currency": "string — USD, EUR, etc.",
  "unit":     "string — each, pack, box, roll",
  "source":   "string — retailer/supplier name",
  "url":      "string — page URL",
  "in_stock": "boolean"
}
```

---

## SUFFICIENCY CRITERIA
All three must be true to stop the loop:

```
1. prices.length >= TARGET_SOURCES (5)

2. SOURCE DIVERSITY — not all from same domain
   uniqueDomains(prices) >= 3

3. NO EXTREME OUTLIERS
   for each price:
     ratio = price / median(allPrices)
     if ratio < MIN_PRICE_RATIO OR ratio > MAX_PRICE_RATIO:
       remove from set, flag as contaminated
```

---

## INFERENCE CALL SHAPE (sufficiency check only)

```
runpod_payload: {
  model:           "Qwen/Qwen3.6-35B-A3B",
  enable_thinking: false,       // fast mode — loop decisions don't need depth
  temperature:     0.1,
  max_tokens:      256,         // short answer only
  messages:        [sufficiency_check_prompt + current_prices]
}
```

---

## OUTPUT SCHEMA

```json
{
  "sources": [
    {
      "name":     "Amazon",
      "url":      "https://...",
      "price":    12.50,
      "currency": "USD",
      "unit":     "each"
    }
  ],
  "avg":        12.28,
  "min":        9.90,
  "max":        14.00,
  "currency":   "USD",
  "confidence": "high",
  "flag":       null,
  "attempts":   1,
  "contaminated_removed": []
}
```

---

## NOTES FOR CODING AGENT
- Promise.all for Firecrawl is mandatory — never scrape sequentially
- Deduplication: if same domain appears twice, keep lower price
- If < 5 sources after MAX_ATTEMPTS: set flag "⚠️ X sources only"
- Store contaminated_removed[] for Notes field in Stage 5
- Pass unit from Firecrawl into price — $5.99/roll ≠ $5.99/each
