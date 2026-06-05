# STAGE 4 — VERIFICATION (CRITIC LAYER)
> Model: `Qwen3.6-35B-A3B`
> Mode: thinking=ON for all three checkpoints
> Trigger: runs after Stage 1, Stage 3, and before Stage 6

---

## PURPOSE
Qwen3.6-35B-A3B acts as critic — not generator.
Three checkpoints. Each returns pass/fail + issues[].
Thinking mode ON so the model reasons carefully before judging.

---

## CHECKPOINT 1 — POST VISION SANITY CHECK
Runs after: Stage 1
Input: visionOutput

```
SYSTEM PROMPT:
"You are a product verification expert.
 Given extracted product information, verify it is logically consistent.
 Check: does the manufacturer match the product category?
 Does the model number format match this brand's conventions?
 Are the dimensions plausible for this product type?
 Return JSON only."

VERIFY:
  manufacturer ↔ product_category match
  model_number format ↔ brand naming conventions
  dimensions ↔ product type plausibility
  Item_Origin ↔ manufacturer headquarters

OUTPUT SCHEMA:
{
  "checkpoint": 1,
  "passed":     true/false,
  "confidence": 0.0–1.0,
  "issues":     ["specific issue descriptions"],
  "action":     "proceed / re-route / ask_user"
}
```

---

## CHECKPOINT 2 — PRICE CONTAMINATION CHECK
Runs after: Stage 3
Input: productName + all scraped price results
This is the most important checkpoint.

```
SYSTEM PROMPT:
"You are a price verification auditor.
 Given a target product name and a list of scraped prices,
 verify each result is for the EXACT same product.
 Watch for: similar model numbers, different sizes, accessories,
 compatible alternatives, bundles, multi-packs priced as singles.
 For each result: KEEP or REMOVE with reason.
 Return JSON only."

FOR EACH PRICE SOURCE VERIFY:
  scraped product title contains target product name?
  model number matches exactly (not just similar)?
  unit matches expected sales unit?
  price is not for a bundle/multi-pack when single expected?

OUTPUT SCHEMA:
{
  "checkpoint": 2,
  "passed":     true/false,
  "clean_sources": [
    { "name": "...", "price": 0.0, "status": "KEEP" }
  ],
  "removed_sources": [
    { "name": "...", "price": 0.0, "status": "REMOVE", "reason": "..." }
  ],
  "clean_count":  0,
  "action": "proceed / re_search / proceed_with_flag"
}
```

If clean_count < 5 after removals:
  → trigger Stage 3 loop again with more specific query
  → max 1 re-trigger to prevent infinite loop

---

## CHECKPOINT 3 — PRE-SAVE COHERENCE CHECK
Runs before: Stage 6 Notion write
Input: complete assembled InventoryItem record

```
SYSTEM PROMPT:
"You are a data quality auditor for an inventory system.
 Review this complete inventory record for logical consistency.
 Verify all fields are populated, units are correct,
 Ext_Price equals Market_Price × Qty,
 and Notes contains the pricing breakdown.
 Return JSON only."

VERIFY:
  all required fields populated (not null, not empty)
  Length and Width include units (e.g. "150 mm" not "150")
  Market_Price is numeric and reasonable for product category
  Ext_Price == Market_Price × Qty (exact math check)
  Currency is valid (USD, EUR, etc.)
  Notes contains "Prices:" prefix (pricing breakdown present)
  itemId matches format INV-YYYYMMDD-XXXX

OUTPUT SCHEMA:
{
  "checkpoint": 3,
  "passed":     true/false,
  "issues":     ["field X is null", "Ext_Price mismatch", ...],
  "corrections": {
    "Ext_Price": "corrected value if wrong",
    "Notes":     "corrected value if missing breakdown"
  },
  "action": "save / save_with_corrections / save_with_flag"
}
```

---

## INFERENCE CALL SHAPE (all checkpoints)

```
runpod_payload: {
  model:           "Qwen/Qwen3.6-35B-A3B",
  enable_thinking: true,
  budget_tokens:   2048,
  temperature:     0.1,
  max_tokens:      1024
}
```

---

## NOTES FIELD FLAGS FROM VERIFICATION
Append to Notes based on checkpoint results:

```
CP1 fail                → "⚠️ Low confidence match — recommend recheck"
CP2 sources removed     → "Removed X contaminated sources: [names]"
CP2 < 5 clean sources   → "⚠️ X sources only after cleanup — verify price"
CP3 fields estimated    → "Length/Width not found — estimated from similar models"
All checkpoints pass    → "All fields verified — no issues"
```

---

## NOTES FOR CODING AGENT
- Never skip checkpoints — they are required gates not optional
- CP2 is the highest value checkpoint — budget_tokens: 2048 is minimum
- If CP3 corrections object is non-empty, apply corrections before saving
- Log all removed_sources for audit trail
