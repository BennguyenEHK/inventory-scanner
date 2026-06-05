# STAGE 1 — VISION EXTRACTION
> Model: `Qwen2.5-VL-7B-Instruct`
> Mode: Standard (no thinking required)
> Trigger: Photo received from user

---

## PURPOSE
Extract every possible visible signal from the photo.
Even for unclear/black box images, the output must be
as descriptive as possible — the richer the description,
the better Stage 2 can predict the product.

---

## SYSTEM PROMPT (send to model)

```
You are a product identification specialist.
Analyze this image and extract ALL visible information.
Be maximally descriptive — even for unclear images.
Never guess field values. If not visible, set null.
Always describe visual appearance even when text is unreadable.
Return valid JSON only. No preamble.
```

---

## EXPECTED OUTPUT SCHEMA

```json
{
  "visible_text":       ["all", "readable", "text", "strings"],
  "brand":              "string or null",
  "model_number":       "string or null",
  "product_category":   "string — visual guess e.g. power tool, adhesive tape",
  "dimensions_visible": "string or null — e.g. '3/4 inch x 1000 in'",
  "barcode":            "string or null",
  "color":              "string — e.g. yellow and black",
  "shape":              "string — e.g. cylindrical spool, rectangular box",
  "material_hints":     "string — e.g. plastic housing, metal casing",
  "label_language":     "string — e.g. English, Chinese, mixed",
  "condition":          "new / used / damaged",
  "packaging_type":     "box / bag / blister / loose / roll / unknown",
  "visual_description": "string — full paragraph describing everything visible,
                          especially for unclear images. Include manufacturer
                          branding colors, logo style, text fragments,
                          physical form factor, size relative to surroundings.
                          This field is CRITICAL for black box cases.",
  "confidence":         0.0,
  "missing_fields":     ["list", "of", "what", "could", "not", "be", "read"],
  "image_quality":      "clear / partial / obscured / unreadable"
}
```

---

## ROUTING LOGIC (pure code — no AI needed)

```
function visionRouter(visionOutput):

  confidence = visionOutput.confidence
  brand      = visionOutput.brand
  model_num  = visionOutput.model_number

  // ROUTE A — full information
  if confidence >= 0.8 AND brand != null:
    return { route: "A", strategy: "direct_search" }

  // ROUTE B — partial information, needs prediction
  if confidence >= 0.4 AND (brand != null OR model_num != null):
    return { route: "B", strategy: "predict_then_search" }

  // ROUTE C — too little to work with
  if confidence < 0.4 AND brand == null:
    return {
      route: "C",
      strategy: "ask_user",
      message: "Image unclear. Please retake showing the label,
                or confirm: is this a [product_category]?"
    }
```

---

## INFERENCE CALL SHAPE

```
endpoint:  /api/vision
method:    POST
input:     { image: base64_string }

runpod_payload: {
  model:      "Qwen/Qwen2.5-VL-7B-Instruct",
  messages:   [system_prompt + image + extraction_request],
  max_tokens: 1024,
  temperature: 0.1    // low — we want facts not creativity
}

output:    VisionResult JSON (schema above)
```

---

## NOTES FOR CODING AGENT
- Always pass `temperature: 0.1` for vision calls
- If barcode is detected, pass it to Stage 2 as priority input
- `visual_description` is mandatory — never allow null
- Log `image_quality` to help debug low-confidence cases
