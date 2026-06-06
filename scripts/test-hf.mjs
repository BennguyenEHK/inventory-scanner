/**
 * Quick connectivity test for HF Inference Providers.
 * Run: node --env-file=.env.local scripts/test-hf.mjs
 */

const HF_URL   = process.env.HF_BASE_URL ?? 'https://router.huggingface.co/v1/chat/completions'
const HF_TOKEN = process.env.HF_TOKEN ?? process.env.HF_API_KEY

const VL_MODEL        = 'Qwen/Qwen2.5-VL-7B-Instruct:fastest'
const REASONING_MODEL = 'Qwen/Qwen3.6-35B-A3B:featherless-ai'

// Fetch a small image and convert to base64 — matches exactly what the app sends
async function fetchAsBase64(url) {
  const res = await fetch(url)
  const buf = await res.arrayBuffer()
  return Buffer.from(buf).toString('base64')
}

const TEST_IMAGE_URL = 'https://qianwen-res.oss-cn-beijing.aliyuncs.com/Qwen-VL/assets/demo.jpeg'

function banner(title) {
  console.log('\n' + '─'.repeat(60))
  console.log(`  ${title}`)
  console.log('─'.repeat(60))
}

async function callHF(model, messages, options = {}) {
  const body = { model, messages, max_tokens: 4096, temperature: 0.1, ...options }
  const res = await fetch(HF_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${HF_TOKEN}` },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  return { status: res.status, ok: res.ok, body: text }
}

// ── Preflight ────────────────────────────────────────────────────────────────
banner('PREFLIGHT')
console.log('HF_URL  :', HF_URL)
console.log('HF_TOKEN:', HF_TOKEN ? `${HF_TOKEN.slice(0, 8)}…${HF_TOKEN.slice(-4)} (${HF_TOKEN.length} chars)` : '⚠️  NOT SET')
if (!HF_TOKEN) {
  console.error('\n❌  HF_TOKEN is not set — check .env.local has HF_TOKEN=hf_...')
  process.exit(1)
}

// ── Test 1: VL model (vision) ────────────────────────────────────────────────
banner('TEST 1 — Vision model: ' + VL_MODEL)
console.log('Test 1a — exact HF sample format: text first + public URL')
try {
  const { status, ok, body } = await callHF(VL_MODEL, [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Describe this image in one sentence.' },
        { type: 'image_url', image_url: { url: TEST_IMAGE_URL } },
      ],
    },
  ])
  console.log('HTTP status:', status)
  if (ok) {
    const data = JSON.parse(body)
    console.log('✅  PASS (URL format) —', data.choices?.[0]?.message?.content ?? body)
  } else {
    console.log('❌  FAIL (URL format) — raw body:', body.slice(0, 300))
  }
} catch (err) {
  console.log('❌  ERROR:', err.message)
}

console.log('\nTest 1b — our app format: base64 data URI + text after')
const base64 = await fetchAsBase64(TEST_IMAGE_URL)
console.log(`Image: ${base64.length} base64 chars`)
try {
  const { status, ok, body } = await callHF(VL_MODEL, [
    {
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}` } },
        { type: 'text', text: 'Describe this image in one sentence.' },
      ],
    },
  ])
  console.log('HTTP status:', status)
  if (ok) {
    const data = JSON.parse(body)
    console.log('✅  PASS — response:', data.choices?.[0]?.message?.content ?? body)
  } else {
    console.log('❌  FAIL — raw body:', body)
  }
} catch (err) {
  console.log('❌  ERROR:', err.message)
}

// ── Test 2: Reasoning model ──────────────────────────────────────────────────
banner('TEST 2 — Reasoning model: ' + REASONING_MODEL)
console.log('Sending: simple product identification JSON prompt')
try {
  const { status, ok, body } = await callHF(REASONING_MODEL, [
    {
      role: 'user',
      content: 'Reply with JSON only: {"status":"ok","model":"working"}',
    },
  ])
  console.log('HTTP status:', status)
  if (ok) {
    const data = JSON.parse(body)
    const content = data.choices?.[0]?.message?.content ?? ''
    console.log('✅  PASS — response:', content.slice(0, 200))
  } else {
    console.log('❌  FAIL — raw body:', body)
  }
} catch (err) {
  console.log('❌  ERROR:', err.message)
}

banner('DONE')
