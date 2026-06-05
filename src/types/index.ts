// Vision extraction output — Stage 1
export interface VisionResult {
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

// Vision routing decision
export type VisionRoute = 'A' | 'B' | 'C'
export interface RouteDecision {
  route: VisionRoute
  strategy: 'direct_search' | 'predict_then_search' | 'ask_user'
  message?: string
}

// Stage 2 — Prediction
export interface PredictionCandidate {
  name: string
  confidence: number
  differentiator: string
}
export interface PredictionResult {
  prediction: {
    product_name: string
    model_number: string | null
    manufacturer: string
    product_line: string
    reasoning: string
    prediction_confidence: number
  }
  candidates: PredictionCandidate[]
  verification_query: string
  requires_verification: boolean
}

// Stage 3 — Search
export interface PriceSource {
  name: string
  url: string
  price: number
  currency: string
  unit: string
  in_stock?: boolean
}
export interface SearchResult {
  sources: PriceSource[]
  avg: number
  min: number
  max: number
  currency: string
  confidence: 'high' | 'medium' | 'low'
  flag: string | null
  attempts: number
  contaminated_removed: PriceSource[]
}

// Stage 4 — Verification
export interface CheckpointResult {
  checkpoint: 1 | 2 | 3
  passed: boolean
  confidence?: number
  issues: string[]
  action: string
  corrections?: Record<string, string>
  clean_sources?: PriceSource[]
  removed_sources?: (PriceSource & { reason: string })[]
  clean_count?: number
}

// Stage 5 — Final Report
export interface InventoryItem {
  itemId: string
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
  Ext_Price: number | null
  Notes: string
}
export interface FinalReport {
  report_html: string
  notion_json: InventoryItem
  images: string[]
  flags: string[]
  sourceCount: number
}

// Client-side pipeline state
export type StageStatus = 'pending' | 'running' | 'done' | 'skipped' | 'error'
export interface PipelineStage {
  id: number
  label: string
  status: StageStatus
  detail: string | null
}

// App state machine
export type AppState = 'capture' | 'running' | 'report' | 'saved'

// Command parser result
export interface ParsedCommand {
  action: 'save' | 'update' | 'delete' | 'navigate' | 'rescan' | 'unknown'
  qty?: number
  itemId?: string
  destination?: string
  raw: string
}
