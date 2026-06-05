# INVENTORY SCANNER — IMPLEMENTATION OVERVIEW
> AI Coding Agent Reference | Pseudo-code only | No full implementation

---

## STACK SUMMARY

| Layer | Primary | Fallback |
|---|---|---|
| Vision Extraction | `Qwen2.5-VL-7B-Instruct` via RunPod | HF Inference Providers |
| Black Box Prediction | `Qwen3.6-35B-A3B` thinking=ON via RunPod | HF Inference Providers |
| Search Orchestration | `Qwen3.6-35B-A3B` thinking=OFF via RunPod | HF Inference Providers |
| Verification / Critic | `Qwen3.6-35B-A3B` thinking=ON via RunPod | HF Inference Providers |
| Report + JSON Output | `Qwen3.6-35B-A3B` thinking=OFF via RunPod | HF Inference Providers |
| Database Operations | Notion API (direct) | — |
| Search | Tavily API | — |
| Scraping | Firecrawl API | — |
| Hosting | Vercel (Next.js) | — |

---

## PIPELINE FLOW

```
📷 PHOTO INPUT
      │
      ▼
[STAGE 1] VISION EXTRACTION
  Qwen2.5-VL-7B → raw descriptors + confidence
      │
      ├─ confidence ≥ 0.8 ──────────────────────────────┐
      │                                                   │
      └─ confidence < 0.8 → [STAGE 2] BLACK BOX          │
                             PREDICTION                   │
                             Qwen3.6-35B-A3B             │
                             thinking=ON                  │
                             → verify via Tavily          │
                             → confirmed product name ────┤
                                                          ▼
                                              [STAGE 3] AGENTIC SEARCH LOOP
                                               Qwen3.6-35B-A3B thinking=OFF
                                               Tavily → Firecrawl (parallel)
                                               ReAct sufficiency check
                                                          │
                                                          ▼
                                              [STAGE 4] VERIFICATION
                                               Qwen3.6-35B-A3B thinking=ON
                                               CP1: vision sanity
                                               CP2: price contamination
                                               CP3: pre-save coherence
                                                          │
                                                          ▼
                                              [STAGE 5] REPORT + JSON
                                               Qwen3.6-35B-A3B thinking=OFF
                                               → structured JSON output
                                               → human-readable report
                                                          │
                                                          ▼
                                              [STAGE 6] NOTION OPERATIONS
                                               Direct Notion API
                                               INSERT / FETCH / UPDATE / DELETE
```

---

## STAGE FILES

| File | Covers |
|---|---|
| `01_VISION.md` | Image extraction + vision router |
| `02_PREDICTION.md` | Black box product prediction |
| `03_SEARCH_LOOP.md` | ReAct agentic search loop |
| `04_VERIFICATION.md` | Three-checkpoint critic layer |
| `05_REPORT.md` | Report format + Notion JSON schema |
| `06_NOTION.md` | All database CRUD operations |
| `07_INFERENCE.md` | RunPod primary + HF fallback config |

---

## INFERENCE PRIORITY RULE (applies to ALL stages)

```
function callModel(payload):
  try:
    response = runpod.serverless(payload)        // PRIMARY
    if response.status == "FAILED":
      throw error
    return response
  catch:
    response = hf.inferenceProvider(payload)     // FALLBACK
    return response
```

Every model call in every stage MUST follow this pattern.
Never call HF directly unless RunPod fails.
