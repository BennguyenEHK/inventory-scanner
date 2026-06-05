# STAGE 2 — BLACK BOX PRODUCT PREDICTION
> Model: `Qwen3.6-35B-A3B`
> Mode: thinking=ON (extended reasoning required)
> Trigger: visionRouter returns route "B" (confidence 0.4–0.8)

---

## MODEL SUITABILITY
Qwen3.6-35B-A3B is verified suitable for this task because:
- Trained on internet-scale product knowledge
- Thinking mode allows multi-step reasoning from partial clues
- Strong instruction following (score 0.752) for structured output
- Reasoning from manufacturer + physical descriptors is exactly
  the kind of clinical inference this model excels at
- MMMU score 82.9 confirms strong product/document understanding

For extreme edge cases (very obscure industrial products),
consider upgrading to Qwen3.6-27B (dense, stronger factual recall)
deployed separately on RunPod with larger GPU.

---

## PURPOSE
Given: manufacturer name + visual description + dimensions
Reason: what specific product line/model is this likely to be?
Verify: fire a quick Tavily search to confirm before proceeding
Output: confirmed product name for Stage 3 search loop

---

## SYSTEM PROMPT (send to model)

```
You are a product identification expert with deep knowledge of
industrial, commercial, and consumer products across all manufacturers.

Given partial product information (manufacturer name, visual description,
dimensions, packaging type), use your training knowledge to:
1. Identify the most likely product line and model
2. Explain your reasoning step by step
3. List 2-3 candidate products ranked by likelihood
4. Return your best prediction as structured JSON

Be clinical and precise. Use manufacturer product catalog knowledge.
Base reasoning on: brand conventions, typical product dimensions,
packaging styles, color coding standards, and product line naming.
Return JSON only after your reasoning. No preamble after JSON.
```

---

## INPUT PAYLOAD

```json
{
  "brand":              "from Stage 1 vision output",
  "model_number":       "from Stage 1 — may be null",
  "visual_description": "full paragraph from Stage 1",
  "dimensions_visible": "from Stage 1 — may be null",
  "product_category":   "from Stage 1",
  "packaging_type":     "from Stage 1",
  "color":              "from Stage 1",
  "barcode":            "from Stage 1 — priority if present"
}
```

---

## EXPECTED OUTPUT SCHEMA

```json
{
  "prediction": {
    "product_name":     "full predicted product name",
    "model_number":     "predicted model if known",
    "manufacturer":     "confirmed manufacturer",
    "product_line":     "e.g. Scotch 800 series, Bosch GBH series",
    "reasoning":        "brief explanation of how conclusion was reached",
    "prediction_confidence": 0.0
  },
  "candidates": [
    { "name": "...", "confidence": 0.0, "differentiator": "..." },
    { "name": "...", "confidence": 0.0, "differentiator": "..." }
  ],
  "verification_query": "exact search string to verify via Tavily",
  "requires_verification": true
}
```

---

## VERIFICATION STEP (after model returns prediction)

```
function verifyPrediction(prediction):

  // Fire Tavily with the model's suggested verification_query
  results = tavily.search(prediction.verification_query, max_results: 3)

  // Ask Qwen3.6 (thinking=OFF this time, just matching)
  verified = model.match(
    query:   prediction.product_name,
    results: results,
    task:    "Does any result confirm this product exists? true/false + reason"
  )

  if verified.confirmed == true:
    return {
      status:       "CONFIRMED",
      product_name: prediction.product_name,
      source_url:   verified.source_url,
      proceed_to:   "STAGE_3"
    }

  else if candidates.length > 1:
    return {
      status:       "AMBIGUOUS",
      candidates:   prediction.candidates,
      proceed_to:   "ASK_USER_TO_PICK"
    }

  else:
    return {
      status:       "UNVERIFIED",
      product_name: prediction.product_name,  // proceed anyway with flag
      flag:         "⚠️ Prediction unverified — recommend manual check",
      proceed_to:   "STAGE_3"
    }
```

---

## INFERENCE CALL SHAPE

```
endpoint:  /api/predict
method:    POST
input:     { visionOutput: VisionResult }

runpod_payload: {
  model:          "Qwen/Qwen3.6-35B-A3B",
  enable_thinking: true,
  budget_tokens:   3000,        // enough for product reasoning
  temperature:     0.2,
  messages:        [system_prompt + input_payload]
}

output:    PredictionResult JSON (schema above)
```

---

## NOTES FOR CODING AGENT
- This stage ONLY fires for route B — skip entirely for route A
- Thinking mode must be enabled — this is the core reasoning task
- budget_tokens: 3000 is intentional — product reasoning needs depth
- If barcode present in Stage 1 output, prepend barcode lookup
  to verification_query: "barcode [number] product"
- Always store prediction.reasoning in the Notes field later
- If prediction_confidence < 0.5, set flag in final Notes
