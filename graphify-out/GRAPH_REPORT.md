# Graph Report - .  (2026-06-07)

## Corpus Check
- 95 files · ~61,409 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 490 nodes · 970 edges · 30 communities (24 shown, 6 thin omitted)
- Extraction: 92% EXTRACTED · 8% INFERRED · 0% AMBIGUOUS · INFERRED: 81 edges (avg confidence: 0.84)
- Token cost: 415,863 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Domain Types & Report Output|Domain Types & Report Output]]
- [[_COMMUNITY_URL Field Extraction (L1-L4)|URL Field Extraction (L1-L4)]]
- [[_COMMUNITY_Inference Wrapper & Design Specs|Inference Wrapper & Design Specs]]
- [[_COMMUNITY_Notion API & Pipeline Orchestration|Notion API & Pipeline Orchestration]]
- [[_COMMUNITY_SSE Pipeline Event Bus|SSE Pipeline Event Bus]]
- [[_COMMUNITY_Package Dependencies|Package Dependencies]]
- [[_COMMUNITY_Pipeline Stages 1-4 (Vision to Verify)|Pipeline Stages 1-4 (Vision to Verify)]]
- [[_COMMUNITY_Report & Notion Stages (5-6)|Report & Notion Stages (5-6)]]
- [[_COMMUNITY_Search Stack & Cost Architecture|Search Stack & Cost Architecture]]
- [[_COMMUNITY_Inference Router & Fallbacks|Inference Router & Fallbacks]]
- [[_COMMUNITY_Search Backends (SerperSerpAPITavily)|Search Backends (Serper/SerpAPI/Tavily)]]
- [[_COMMUNITY_Verification Gate & Prompts|Verification Gate & Prompts]]
- [[_COMMUNITY_TypeScript Config|TypeScript Config]]
- [[_COMMUNITY_VoiceCommand Parsing|Voice/Command Parsing]]
- [[_COMMUNITY_Verification Checkpoints (CP1-CP3)|Verification Checkpoints (CP1-CP3)]]
- [[_COMMUNITY_Camera Capture Overlay|Camera Capture Overlay]]
- [[_COMMUNITY_Root Layout & Fonts|Root Layout & Fonts]]
- [[_COMMUNITY_Chat Bubble Status UI|Chat Bubble Status UI]]
- [[_COMMUNITY_Report Card UI Logic|Report Card UI Logic]]
- [[_COMMUNITY_Static SVG Icons|Static SVG Icons]]
- [[_COMMUNITY_Inventory Check Prompts|Inventory Check Prompts]]
- [[_COMMUNITY_Project Instructions (AGENTS.md)|Project Instructions (AGENTS.md)]]
- [[_COMMUNITY_ESLint Config|ESLint Config]]
- [[_COMMUNITY_PostCSS Config|PostCSS Config]]
- [[_COMMUNITY_Web Search Rule|Web Search Rule]]
- [[_COMMUNITY_Package Manifest|Package Manifest]]

## God Nodes (most connected - your core abstractions)
1. `VisionResult` - 21 edges
2. `publishEvent()` - 20 edges
3. `POST()` - 19 edges
4. `extractFromUrl()` - 18 edges
5. `callModel()` - 18 edges
6. `InventoryItem` - 18 edges
7. `PriceSource` - 17 edges
8. `compilerOptions` - 16 edges
9. `POST()` - 13 edges
10. `assembleReport()` - 12 edges

## Surprising Connections (you probably didn't know these)
- `removeOutliers Price Contamination Filter` --semantically_similar_to--> `Vision-Based Verify Gate`  [INFERRED] [semantically similar]
  docs/superpowers/plans/2026-06-05-inventory-scanner.md → Documents/search_upgrade.md
- `nextConfig` --conceptually_related_to--> `ReportCard()`  [INFERRED]
  next.config.ts → src/components/ReportCard.tsx
- `POST()` --semantically_similar_to--> `detectInventoryCheckIntent`  [INFERRED] [semantically similar]
  src/app/api/command/route.ts → src/app/api/vision/route.ts
- `POST()` --semantically_similar_to--> `POST()`  [INFERRED] [semantically similar]
  src/app/api/inventory-check/route.ts → src/app/api/search/route.ts
- `validateProductImages()` --semantically_similar_to--> `pickVariantPrice()`  [INFERRED] [semantically similar]
  src/lib/gemini-images.ts → src/lib/firecrawl.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Six-Stage Inventory Scanner Pipeline Flow** — documents_01_vision_vision_stage, documents_02_prediction_blackbox_prediction, documents_03_search_loop_agentic_search_loop, documents_04_verification_critic_layer, documents_00_overview_notion_api [EXTRACTED 1.00]
- **Three-Checkpoint Critic Layer** — documents_04_verification_cp1_vision_sanity, documents_04_verification_cp2_price_contamination, documents_04_verification_cp3_presave_coherence [EXTRACTED 1.00]
- **RunPod Primary / HF Fallback Inference Pattern** — documents_00_overview_inference_priority_rule, documents_00_overview_runpod_serverless, documents_00_overview_hf_inference_providers [EXTRACTED 1.00]
- **4-Layer Extraction Cascade Flow** — documents_search_upgrade_l1_snippet_regex, documents_search_upgrade_l2_jina_extraction, documents_search_upgrade_l3_qwen_gapfill, documents_search_upgrade_l4_screenshot_gemini [EXTRACTED 1.00]
- **6-Stage AI Pipeline Route Handlers** — plans_2026_06_05_inventory_scanner_vision_route, plans_2026_06_05_inventory_scanner_predict_route, plans_2026_06_05_inventory_scanner_search_route, plans_2026_06_05_inventory_scanner_verify_route, plans_2026_06_05_inventory_scanner_report_route, plans_2026_06_05_inventory_scanner_notion_route [EXTRACTED 1.00]
- **Price-Source-First Image Selection Pipeline** — plans_2026_06_05_image_pipeline_firecrawl_extract_images, plans_2026_06_05_image_pipeline_is_product_image, plans_2026_06_05_image_pipeline_validate_product_images, plans_2026_06_05_image_pipeline_tavily_fallback [EXTRACTED 1.00]
- **L1-L4 price extraction cascade** — lib_firecrawl_extractfromurl, lib_extract_regex_extractfromtext, lib_jina_jinaextract, lib_firecrawl_pickvariantprice, lib_firecrawl_qwengapfill [EXTRACTED 1.00]
- **Product-image selection pipeline** — lib_image_pipeline_selectproductimages, lib_jina_jinaextractimages, lib_firecrawl_isproductimage, lib_gemini_images_validateproductimages [EXTRACTED 1.00]
- **Inference provider fallback chain (Gemini/HF/RunPod)** — lib_inference_getmodelcontent, lib_inference_trygeminivision, lib_inference_tryrunpodfallback, lib_inference_buildrawcontent [EXTRACTED 1.00]
- **Verification Gate Checkpoints (CP1/CP2/CP3)** — prompt_verify_cp1_system_prompt, prompt_verify_cp2_system_prompt, prompt_verify_cp3_system_prompt [INFERRED 0.85]
- **Interchangeable search backends delegating to Serper** — lib_serper_serperorganicsearch, lib_serpapi_serpapisearch, lib_tavily_tavilysearch [INFERRED 0.80]
- **Redis-backed pipeline event bus flow** — lib_pipeline_bus_publishevent, lib_pipeline_bus_pollevents, lib_pipeline_bus_busevent, lib_redis_redis [INFERRED 0.80]
- **6-Stage AI Inventory Pipeline (vision to notion save)** — vision_route_post, predict_route_post, search_route_post, verify_route_post, report_route_post, notion_route_post, app_page_run_pipeline [INFERRED 0.85]
- **Pipeline stages publishing progress to the SSE event bus** — vision_route_post, predict_route_post, search_route_post, verify_route_post, inventory_check_route_post, events_route_get [INFERRED 0.80]
- **CP2 contamination detection drives search re-search loop** — verify_route_checkpoint2, search_route_post, app_page_run_pipeline [INFERRED 0.80]
- **Chat/scan mobile interface components** — components_cameraoverlay_cameraoverlay, components_chatbubble_chatbubble, components_commandbar_commandbar, components_reportcard_reportcard [INFERRED 0.85]
- **Report assembly consumes pipeline stage outputs** — actions_report_assemblereport, types_index_visionresult, types_index_searchresult, types_index_checkpointresult, types_index_finalreport [EXTRACTED 1.00]

## Communities (30 total, 6 thin omitted)

### Community 0 - "Domain Types & Report Output"
Cohesion: 0.06
Nodes (46): assembleNotes(), assembleReport(), STAGE_LABELS, STAGE_LABELS, ChatBubble(), isDimmed(), NonReportEvent, Props (+38 more)

### Community 1 - "URL Field Extraction (L1-L4)"
Cohesion: 0.11
Nodes (41): ExtractedFields, extractFromText(), FILLABLE_FIELDS, mergeFields(), missingFieldNames(), parseNumeric(), parsePriceRaw(), SYMBOL_MAP (+33 more)

### Community 2 - "Inference Wrapper & Design Specs"
Cohesion: 0.08
Nodes (32): Inference Cost Reference, Endpoint Router (getEndpointId), HuggingFace Inference Providers (Fallback), Qwen3.6-35B-A3B (Reasoning Model), Qwen2.5-VL-7B-Instruct (Vision Model), RunPod Serverless (Primary), Stage 7 — Inference Provider Configuration, Thinking Mode Parameter by Stage (+24 more)

### Community 3 - "Notion API & Pipeline Orchestration"
Cohesion: 0.16
Nodes (24): archiveItem(), queryItems(), saveItem(), updateItem(), RootLayout, runPipeline (client orchestrator), ScanPage, CP2 Contamination Re-Search Loop (+16 more)

### Community 4 - "SSE Pipeline Event Bus"
Cohesion: 0.13
Nodes (22): SSE Pipeline Event Bus, GET(), BusEvent, busEventToLine(), hostOf(), KEY(), pollEvents(), publishEvent() (+14 more)

### Community 5 - "Package Dependencies"
Cohesion: 0.07
Nodes (28): dependencies, firecrawl, @google/genai, next, react, react-dom, @upstash/redis, devDependencies (+20 more)

### Community 6 - "Pipeline Stages 1-4 (Vision to Verify)"
Cohesion: 0.12
Nodes (25): Firecrawl Scraping API, HF Inference Providers (Fallback), Inference Priority Rule (RunPod primary, HF fallback), Notion API (Database Operations), Inventory Scanner Pipeline Overview, Qwen2.5-VL-7B-Instruct (Vision Model), Qwen3.6-35B-A3B (Reasoning Model), RunPod Serverless (Primary Inference) (+17 more)

### Community 7 - "Report & Notion Stages (5-6)"
Cohesion: 0.10
Nodes (25): Ext_Price Computed-in-Code Rule, Human-Readable Item Report, Item ID Generation (INV-YYYYMMDD-XXXX), Market_Price vs Notes Field Separation, Notes Field Assembly (two-part), Notion JSON Schema (strict), Stage 5 — Report Generation + JSON Output, Verification Images (Tavily) (+17 more)

### Community 8 - "Search Stack & Cost Architecture"
Cohesion: 0.11
Nodes (25): Brave Search API, Search Pipeline Cost Analysis & Architecture Update, Current Search Stack (Firecrawl + SerpAPI + Tavily), Gemini 2.5 Flash (Vision + Extraction), Jina AI Reader, Price Regex Pre-Filter on Jina Markdown (NOTE 3), Upstash Redis Result Caching, Serper.dev (+17 more)

### Community 9 - "Inference Router & Fallbacks"
Cohesion: 0.14
Nodes (17): Vision Confidence Routing (A/B/C/D), buildRawContent(), CallModelParams, extractThinking(), GeminiPart, getModelContent(), isGeminiModel(), isVisionModel() (+9 more)

### Community 10 - "Search Backends (Serper/SerpAPI/Tavily)"
Cohesion: 0.16
Nodes (17): serpApiSearch(), serpApiShoppingSearch(), getKey(), parseOrganicItem(), parseShoppingItem(), parseShoppingPrice(), SerperOrganicItem, serperOrganicSearch() (+9 more)

### Community 11 - "Verification Gate & Prompts"
Cohesion: 0.14
Nodes (16): Pipeline Stage: Product Prediction, Pipeline Stage: Price Search, Pipeline Stage: Verification Gate (CP1/CP2/CP3), Pipeline Stage: Vision Extraction, applyVerifyGate(), ManufacturerFlag, normalize(), significantWords() (+8 more)

### Community 12 - "TypeScript Config"
Cohesion: 0.10
Nodes (19): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+11 more)

### Community 13 - "Voice/Command Parsing"
Cohesion: 0.16
Nodes (13): parseVoiceCommand(), parseCommand, parseCommand(), POST(), CommandBar(), Props, SREvent, SRInstance (+5 more)

### Community 14 - "Verification Checkpoints (CP1-CP3)"
Cohesion: 0.31
Nodes (10): callModelWithThinking(), buildCp1UserMessage(), buildCp2UserMessage(), buildCp3UserMessage(), BASE_PARAMS, checkpoint1(), checkpoint2(), checkpoint3() (+2 more)

### Community 15 - "Camera Capture Overlay"
Cohesion: 0.32
Nodes (6): CameraOverlay(), computeResizeDimensions(), fileToEntry(), PhotoEntry, Props, resizeDataUrl()

### Community 17 - "Root Layout & Fonts"
Cohesion: 0.40
Nodes (3): metadata, spaceGrotesk, viewport

### Community 18 - "Chat Bubble Status UI"
Cohesion: 0.40
Nodes (3): StageStatus, STATUS_COLOR, STATUS_ICON

### Community 20 - "Static SVG Icons"
Cohesion: 0.40
Nodes (5): File Icon (SVG), Globe Icon (SVG), Next.js Wordmark (SVG), Vercel Logo (SVG), Window Icon (SVG)

### Community 23 - "Inventory Check Prompts"
Cohesion: 1.00
Nodes (3): Pipeline Stage: Inventory Check (Notion), INVENTORY_CHECK_CONCLUSION_PROMPT, INVENTORY_CHECK_QUERY_PROMPT

## Knowledge Gaps
- **120 isolated node(s):** `eslintConfig`, `name`, `version`, `private`, `dev` (+115 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **6 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `VisionResult` connect `Domain Types & Report Output` to `URL Field Extraction (L1-L4)`, `Notion API & Pipeline Orchestration`, `SSE Pipeline Event Bus`, `Inference Router & Fallbacks`, `Verification Gate & Prompts`, `Verification Checkpoints (CP1-CP3)`, `HuggingFace Test Script`?**
  _High betweenness centrality (0.030) - this node is a cross-community bridge._
- **Why does `applyVerifyGate()` connect `Verification Gate & Prompts` to `URL Field Extraction (L1-L4)`?**
  _High betweenness centrality (0.027) - this node is a cross-community bridge._
- **Are the 6 inferred relationships involving `POST()` (e.g. with `POST()` and `POST()`) actually correct?**
  _`POST()` has 6 INFERRED edges - model-reasoned connections that need verification._
- **What connects `eslintConfig`, `name`, `version` to the rest of the system?**
  _130 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Domain Types & Report Output` be split into smaller, more focused modules?**
  _Cohesion score 0.06330988522769344 - nodes in this community are weakly interconnected._
- **Should `URL Field Extraction (L1-L4)` be split into smaller, more focused modules?**
  _Cohesion score 0.1054421768707483 - nodes in this community are weakly interconnected._
- **Should `Inference Wrapper & Design Specs` be split into smaller, more focused modules?**
  _Cohesion score 0.0846774193548387 - nodes in this community are weakly interconnected._