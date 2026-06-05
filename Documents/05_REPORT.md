# STAGE 5 — REPORT GENERATION + JSON OUTPUT
> Model: `Qwen3.6-35B-A3B` thinking=OFF
> Trigger: after Stage 4 all checkpoints passed
> Output: human-readable report + machine-readable JSON

---

## PURPOSE
Assemble all pipeline outputs into:
1. Human-readable report shown to user
2. Strict JSON matching Notion database schema exactly

---

## HUMAN-READABLE REPORT FORMAT

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📦 ITEM REPORT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Name         : {ItemName}
Description  : {itemDescription}
Manufacturer : {Manufacturer}
Length       : {Length}
Width        : {Width}
Currency     : {Currency}
Sales Unit   : {Sales_Unit}
Item Origin  : {Item_Origin}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💰 Pricing ({n} sources)
├─ {Source 1}   : ${price}
├─ {Source 2}   : ${price}
├─ {Source 3}   : ${price}
├─ {Source 4}   : ${price}
├─ {Source 5}   : ${price}
├─ Range        : ${min} – ${max}
└─ Average      : ${avg} ← Market_Price
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[3 verification images displayed]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

"Does this match your item? Qty?"
```

---

## NOTION JSON SCHEMA (strict — matches DB property types exactly)

```json
{
  "itemId":           "INV-YYYYMMDD-XXXX",   // Title (string)
  "ItemName":         "string",              // Text
  "itemDescription":  "string",              // Text
  "Qty":              0,                     // Number — from user input
  "Manufacturer":     "string",              // Text
  "Length":           "string with units",   // Text e.g. "150 mm"
  "Width":            "string with units",   // Text e.g. "50 mm"
  "Market_Price":     0.00,                  // Number — avg only
  "Currency":         "USD",                 // Text
  "Sales_Unit":       "Each",               // Text
  "Item_Origin":      "string",              // Text
  "Ext_Price":        0.00,                  // Number = Market_Price × Qty
  "Notes":            "string"               // Text — never null
}
```

---

## NOTES FIELD ASSEMBLY (always two parts)

```
PART 1 — PRICING BREAKDOWN (always first):
"Prices: {Source} ${price} | {Source} ${price} | ... | Range: ${min}–${max} | Avg: ${avg}"

PART 2 — FLAGS (newline after Part 1):
Append one or more flags from verification results:
  → "⚠️ Low confidence match — recommend recheck"
  → "⚠️ X sources only — price may be less reliable"
  → "Origin inferred from brand HQ — not confirmed on label"
  → "Photo quality limited — ID based on partial label"
  → "Selected best match from X candidates — verify item"
  → "Prediction used — black box image, verify product"
  → "Removed X contaminated price sources"
  → "All fields verified — no issues"

FINAL FORMAT:
"Prices: Amazon $12.50 | Grainger $14.00 | Home Depot $11.80 | RS Components $13.20 | Alibaba $9.90 | Range: $9.90–$14.00 | Avg: $12.28\nAll fields verified — no issues"
```

---

## ITEM ID GENERATION (pure code — no AI)

```
function generateItemId(sessionCounter):
  date    = today formatted as YYYYMMDD
  counter = sessionCounter.toString().padStart(4, '0')
  return  "INV-" + date + "-" + counter

// Counter starts at 0001 per session
// Increment after each successful Notion write
// Store counter in session state, not database
```

---

## VERIFICATION IMAGES
After assembling the report, fire Tavily image search:

```
query   = ItemName + " product image"
results = tavily.searchImages(query, max_results: 3)
embed 3 image URLs in report for user to visually confirm
```

---

## FINAL PIPELINE BEFORE USER SEES REPORT

```
function assembleFinalReport(allStageOutputs):

  item = {
    itemId:          generateItemId(session.counter),
    ItemName:        visionOutput.ItemName or predictionOutput.product_name,
    itemDescription: research result,
    Qty:             null,            // awaiting user input
    Manufacturer:    visionOutput.brand,
    Length:          visionOutput.dimensions.length,
    Width:           visionOutput.dimensions.width,
    Market_Price:    pricingResult.avg,
    Currency:        pricingResult.currency,
    Sales_Unit:      pricingResult.sources[0].unit,
    Item_Origin:     resolveOrigin(visionOutput, researchResult),
    Ext_Price:       null,            // computed after Qty received
    Notes:           assembleNotes(pricingResult, verificationFlags)
  }

  return {
    report_html:  formatHumanReport(item, pricingResult),
    notion_json:  item,               // ready for Stage 6 on Qty input
    images:       verificationImages
  }
```

---

## NOTES FOR CODING AGENT
- Market_Price stores ONLY the numeric average — never the breakdown
- Notes stores the FULL breakdown — these are two different fields
- Qty and Ext_Price must remain null until user provides quantity
- Ext_Price must be computed in code, never by AI
- itemId counter must persist across the session in memory
