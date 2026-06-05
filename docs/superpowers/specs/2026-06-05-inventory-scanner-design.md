# Inventory Scanner — Design Spec
**Date:** 2026-06-05  
**Status:** Approved  

---

## 1. Product Overview

A mobile-first AI-powered inventory scanner web app. User photographs a warehouse/office item on their phone, the app runs a 6-stage AI pipeline to identify the product and find market prices, then saves a structured record to a Notion database. Commands issued via text or voice in a persistent bottom bar.

**Target devices:** Samsung Android, iPhone (Safari/Chrome mobile)  
**Hosting:** Vercel (Next.js App Router)  
**Database:** Notion API  

---

## 2. Architecture

### Frontend (Next.js App Router)
```
src/
  app/
    page.tsx                  — main scan page (single-page vertical flow)
    inventory/page.tsx        — inventory list/search page
    layout.tsx                — root layout (dark theme, mobile viewport)
    globals.css               — design tokens, dark theme
  components/
    PhotoCapture.tsx          — multi-photo grid (up to 3), camera + gallery
    PipelineProgress.tsx      — animated stage cards (done/running/locked)
    ItemReport.tsx            — report card: images, pricing, fields
    CommandBar.tsx            — persistent bottom bar (text + mic)
    QtyControl.tsx            — ± stepper + save button
    InventoryTable.tsx        — paginated list of Notion records
  lib/
    inference.ts              — universal callModel() wrapper (RunPod → HF fallback)
    notion.ts                 — Notion CRUD helpers
    tavily.ts                 — search helper
    firecrawl.ts              — scrape helper
    itemId.ts                 — INV-YYYYMMDD-XXXX generator
  types/
    index.ts                  — all shared TypeScript interfaces
  app/api/
    vision/route.ts           — Stage 1: vision extraction
    predict/route.ts          — Stage 2: black box prediction
    search/route.ts           — Stage 3: agentic search loop
    verify/route.ts           — Stage 4: verification checkpoints
    report/route.ts           — Stage 5: report + JSON assembly
    notion/route.ts           — Stage 6: Notion CRUD
    command/route.ts          — NLP command parser (save/update/delete/query)
```

### Backend Pattern
All API routes are Next.js Route Handlers (POST). They call `lib/inference.ts` → RunPod primary → HF fallback. Streaming is **not** used — pipeline stages are sequential server-side calls, results sent as JSON.

---

## 3. UI Layout (3 States, Single Page)

### State 1 — Capture
- App header: "📦 InvScan" + History link  
- **Photo grid**: 3 slots (front / label / barcode). Each slot: tap → camera or gallery sheet. Filled slots show thumbnail + red ✕ remove. Empty slots show dashed + border.  
- **Camera / Gallery** buttons below grid  
- **Analyze Items** CTA button (gradient, disabled until ≥1 photo)  
- **Persistent command bar** at bottom (always visible across all states)  

### State 2 — Pipeline Running
- Header badge: "● ANALYZING"  
- **Stage list** (6 rows): icon + label + status  
  - ✓ green = done, ⟳ amber = running, • grey = pending, – grey+opacity = skipped  
- Substatus text per stage (e.g. "3/5 sources found…")  
- Analyze button replaced by "Cancel" text  
- Command bar remains active  

### State 3 — Report + Save
- Header badge: "✓ DONE"  
- **Item Report Card**:  
  - Item name + itemId + VERIFIED badge  
  - 3 verification image thumbnails (tap → full screen)  
  - Pricing breakdown: source list + avg (highlighted)  
  - Key fields compact grid: Manufacturer, Origin, Length, Width  
  - Notes/flags section (warning icons if any)  
- **Qty control**: − / number input / + stepper  
- **Save to Notion** button (gradient, disabled until qty > 0)  
- **Command bar**: pre-filled example "save qty 50" in placeholder  
- After save: success toast "✅ Saved — INV-20260605-0001"  
- "Scan Another" button resets to State 1  

### Inventory Page (`/inventory`)
- Search bar (filter by name/manufacturer)  
- Paginated card list: itemId · name · qty · market price · date  
- Tap card → expand: full fields + Notes  
- Swipe/long-press → Edit qty or Archive (delete)  

---

## 4. Data Flow

```
User uploads photos
      ↓
POST /api/vision       → VisionResult (confidence, brand, model_num, …)
      ↓
visionRouter()
  Route A (conf ≥ 0.8) → skip Stage 2
  Route B (conf 0.4–0.8) → POST /api/predict → PredictionResult
  Route C (conf < 0.4) → return clarification prompt to UI
      ↓
POST /api/search       → SearchResult (5+ price sources, avg, min, max)
      ↓
POST /api/verify       → VerificationResult (CP1 + CP2 + CP3)
      ↓
POST /api/report       → FinalReport { report_html, notion_json, images[] }
      ↓
UI renders State 3
      ↓
User inputs qty (stepper or command bar)
      ↓
POST /api/notion       → { action: "insert", item: { …notion_json, Qty, Ext_Price } }
      ↓
✅ Saved toast + reset
```

### Voice Input
Web Speech API (`SpeechRecognition`) runs client-side in `CommandBar.tsx`. Transcript text is submitted to `POST /api/command` exactly like typed input. Mic button toggles listening state; interim results shown greyed in the input. Falls back to text-only if browser doesn't support SpeechRecognition.

### Command Bar NLP (`POST /api/command`)
Parses user text/voice input:

| Input pattern | Action |
|---|---|
| "save qty 50" / "save 50" | sets qty=50, triggers notion insert |
| "update qty to 75" | triggers notion update for current item |
| "delete this" / "discard" | archives current item (with confirm) |
| "show inventory" | navigates to /inventory |
| "rescan" | resets to State 1 |
| anything else | echoed back as system message |

---

## 5. Key TypeScript Interfaces

```typescript
// Vision output from Stage 1
interface VisionResult {
  visible_text: string[]
  brand: string | null
  model_number: string | null
  product_category: string
  dimensions_visible: string | null
  barcode: string | null
  color: string
  shape: string
  material_hints: string
  label_language: string
  condition: 'new' | 'used' | 'damaged'
  packaging_type: 'box' | 'bag' | 'blister' | 'loose' | 'roll' | 'unknown'
  visual_description: string
  confidence: number
  missing_fields: string[]
  image_quality: 'clear' | 'partial' | 'obscured' | 'unreadable'
}

// Notion inventory record
interface InventoryItem {
  itemId: string           // INV-YYYYMMDD-XXXX
  ItemName: string
  itemDescription: string
  Qty: number | null
  Manufacturer: string
  Length: string
  Width: string
  Market_Price: number
  Currency: string
  Sales_Unit: string
  Item_Origin: string
  Ext_Price: number | null // Market_Price × Qty, computed in code
  Notes: string
}

// Pipeline state (client-side)
interface PipelineStage {
  id: number
  label: string
  status: 'pending' | 'running' | 'done' | 'skipped' | 'error'
  detail: string | null
}
```

---

## 6. Inference Config

All model calls via `lib/inference.ts → callModel()`:

```
RunPod primary  → RUNPOD_BASE_URL/{endpoint}/runsync   (timeout 90s)
HF fallback     → HF_BASE_URL/v1/chat/completions      (timeout 60s)
```

| Stage | Model | thinking | budget_tokens |
|---|---|---|---|
| 1 Vision | Qwen2.5-VL-7B-Instruct | false | — |
| 2 Predict | Qwen3.6-35B-A3B | true | 3000 |
| 3 Search decisions | Qwen3.6-35B-A3B | false | — |
| 4 CP1/CP2/CP3 | Qwen3.6-35B-A3B | true | 2048 |
| 5 Report | Qwen3.6-35B-A3B | false | — |

Fallback strips `<think>…</think>` blocks before JSON parsing.

---

## 7. Environment Variables

```
RUNPOD_API_KEY
RUNPOD_VISION_ENDPOINT_ID
RUNPOD_REASONING_ENDPOINT_ID
RUNPOD_BASE_URL=https://api.runpod.ai/v2
HF_API_KEY
HF_BASE_URL=https://router.huggingface.co/v1/chat/completions
RUNPOD_TIMEOUT_MS=90000
NOTION_API_KEY
NOTION_DATABASE_ID
TAVILY_API_KEY
FIRECRAWL_API_KEY
```

---

## 8. Error Handling

- **Route C** (low vision confidence): UI shows clarification message from model, "Retake Photo" button.  
- **Pipeline stage failure**: stage card turns red with error detail, "Retry Stage" button.  
- **Notion errors**: mapped to user-friendly messages (401 → "Check API key", 404 → "Database not found").  
- **< 5 price sources**: proceeds with ⚠️ flag in Notes field.  
- **HF fallback**: logged server-side, transparent to user.  

---

## 9. Not In Scope

- User authentication (single-user app)  
- Real-time collaboration  
- Offline mode  
- Push notifications  
- Barcode scanner hardware integration (handled via vision AI)  
