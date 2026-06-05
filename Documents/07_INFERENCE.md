# STAGE 7 — INFERENCE PROVIDER CONFIGURATION
> Primary: RunPod Serverless
> Fallback: HuggingFace Inference Providers
> Pattern: applies to ALL model calls across ALL stages

---

## MODEL ENDPOINTS

### RunPod (Primary)
```
Base URL  : https://api.runpod.ai/v2
Auth      : Authorization: Bearer {RUNPOD_API_KEY}
Format    : OpenAI-compatible via vLLM

Vision endpoint    : {RUNPOD_VISION_ENDPOINT_ID}/runsync
Reasoning endpoint : {RUNPOD_REASONING_ENDPOINT_ID}/runsync

Timeout   : 90 seconds (vision calls can be slow on cold start)
```

### HuggingFace Inference Providers (Fallback)
```
Base URL  : https://router.huggingface.co/v1/chat/completions
Auth      : Authorization: Bearer {HF_API_KEY}
Format    : OpenAI-compatible

Vision model    : Qwen/Qwen2.5-VL-7B-Instruct
Reasoning model : Qwen/Qwen3.6-35B-A3B
```

---

## UNIVERSAL INFERENCE WRAPPER
Every model call in every stage must use this wrapper:

```
async function callModel(params):
  {
    model,            // model string
    messages,         // message array
    enable_thinking,  // boolean (Qwen3.6 only)
    budget_tokens,    // integer (when thinking=ON)
    temperature,
    max_tokens
  } = params

  // BUILD PAYLOAD (OpenAI-compatible)
  payload = {
    model:       model,
    messages:    messages,
    temperature: temperature ?? 0.1,
    max_tokens:  max_tokens ?? 1024
  }

  // ADD THINKING PARAMS IF NEEDED (Qwen3.6 only)
  if enable_thinking == true:
    payload.chat_template_kwargs = { enable_thinking: true }
    payload.max_tokens           = budget_tokens ?? 2048

  // TRY RUNPOD FIRST
  try:
    response = await POST(
      url:     RUNPOD_BASE_URL + "/" + getEndpointId(model) + "/runsync",
      headers: { Authorization: "Bearer " + RUNPOD_API_KEY },
      body:    payload,
      timeout: 90_000
    )

    if response.status == "COMPLETED":
      return response.output.choices[0].message.content

    throw new Error("RunPod returned: " + response.status)

  // FALLBACK TO HF
  catch error:
    log("RunPod failed: " + error.message + " — falling back to HF")

    response = await POST(
      url:     HF_BASE_URL,
      headers: { Authorization: "Bearer " + HF_API_KEY },
      body:    payload,
      timeout: 60_000
    )

    return response.choices[0].message.content
```

---

## ENDPOINT ROUTER

```
function getEndpointId(model):
  if model.includes("VL"):       return RUNPOD_VISION_ENDPOINT_ID
  if model.includes("Qwen3.6"):  return RUNPOD_REASONING_ENDPOINT_ID
  throw "Unknown model: " + model
```

---

## RUNPOD SERVERLESS ENDPOINT SETUP

### Vision Model
```
Model:          Qwen/Qwen2.5-VL-7B-Instruct
Template:       vLLM Worker
GPU:            RTX 4090 (Community Cloud — cheapest)
Max Workers:    3
Idle Timeout:   5 seconds (scale to zero fast)
Volume:         None needed (model loads from HF cache)
```

### Reasoning Model
```
Model:          Qwen/Qwen3.6-35B-A3B
Template:       vLLM Worker
GPU:            RTX 4090 (fits — only 3B active params in MoE)
Max Workers:    2
Idle Timeout:   5 seconds
Volume:         None needed
```

---

## THINKING MODE PARAMETER BY STAGE

```
Stage 1 — Vision Extraction        : enable_thinking=false
Stage 2 — Black Box Prediction     : enable_thinking=true,  budget=3000
Stage 3 — Search Loop Decisions    : enable_thinking=false
Stage 4 — CP1 Vision Sanity        : enable_thinking=true,  budget=2048
Stage 4 — CP2 Price Contamination  : enable_thinking=true,  budget=2048
Stage 4 — CP3 Pre-Save Coherence   : enable_thinking=true,  budget=2048
Stage 5 — Report Assembly          : enable_thinking=false
```

---

## COST REFERENCE

```
RunPod RTX 4090: ~$0.34/hr Community Cloud
Per vision call (5 sec GPU)   : ~$0.00047
Per reasoning call (3 sec GPU): ~$0.00028
50 items/session total GPU    : ~$0.04

HF Inference Providers (fallback only):
Qwen3.6-35B-A3B input: $0.14/M tokens
Qwen3.6-35B-A3B output: $1.00/M tokens
Expected fallback usage: < 5% of calls
```

---

## ENVIRONMENT VARIABLES NEEDED

```
RUNPOD_API_KEY
RUNPOD_VISION_ENDPOINT_ID
RUNPOD_REASONING_ENDPOINT_ID
RUNPOD_BASE_URL=https://api.runpod.ai/v2
HF_API_KEY
HF_BASE_URL=https://router.huggingface.co/v1/chat/completions
RUNPOD_TIMEOUT_MS=90000
```

---

## NOTES FOR CODING AGENT
- Never call HF directly for primary requests — RunPod first always
- Log every fallback event with timestamp and reason
- Cold start on RunPod: first call after idle takes 10–30 sec — this is normal
- HF fallback does not support thinking mode reliably — if CP2/CP4 fail on HF, flag and proceed
- Thinking mode output contains <think>...</think> blocks — strip before parsing JSON
- Both endpoints accept OpenAI-compatible format via vLLM — same payload works for both
