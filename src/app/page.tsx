'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import CameraOverlay from '@/components/CameraOverlay'
import CommandBar from '@/components/CommandBar'
import ChatBubble from '@/components/ChatBubble'
import ReportCard from '@/components/ReportCard'
import type { BusEvent } from '@/lib/pipeline-bus'
import { busEventToLine } from '@/lib/pipeline-bus'
import type {
  AppState, ChatEvent, FinalReport, StageStatus,
  VisionResult, RouteDecision, PredictionResult,
  SearchResult, InventoryCheckResult,
} from '@/types'

const STAGE_LABELS: Record<number, string> = {
  1: 'Vision Extraction',
  2: 'Prediction',
  3: 'Search & Verify',
  5: 'Report Assembly',
  6: 'Save to Notion',
}

function apiUrl(path: string, runId: string): string {
  return `${path}?runId=${encodeURIComponent(runId)}`
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText })) as { error?: string }
    throw new Error(err.error ?? `${path} failed: ${res.status}`)
  }
  return res.json() as Promise<T>
}

export default function ScanPage() {
  const [appState, setAppState] = useState<AppState>('capture')
  const [cameraOpen, setCameraOpen] = useState(false)
  const [stream, setStream] = useState<ChatEvent[]>([])
  const [report, setReport] = useState<FinalReport | null>(null)
  const [saving, setSaving] = useState(false)
  const [pendingPrompt, setPendingPrompt] = useState<string>('')
  // True while the pipeline is paused waiting for the user to confirm a low-confidence prediction.
  // Must enable the command bar (otherwise the user can't type yes/no and the pipeline hangs).
  const [awaitingConfirm, setAwaitingConfirm] = useState(false)
  const streamEndRef = useRef<HTMLDivElement>(null)
  const runIdRef = useRef<string>('')
  const esRef = useRef<EventSource | null>(null)
  // When non-null, pipeline is paused waiting for user confirmation of a low-confidence prediction
  const confirmResolveRef = useRef<((confirmed: boolean) => void) | null>(null)

  useEffect(() => {
    streamEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [stream.length])

  const appendLive = (stageId: number, line: string) => {
    setStream(prev => prev.map(e =>
      e.kind === 'stage' && e.stageId === stageId
        ? { ...e, live: [...(e.live ?? []), line] }
        : e
    ))
  }

  const openEventSource = (runId: string) => {
    esRef.current?.close()
    const es = new EventSource(`/api/pipeline/events?runId=${encodeURIComponent(runId)}`)
    es.onmessage = (evt) => {
      try {
        const event = JSON.parse(evt.data) as BusEvent
        if (event.kind === 'done') { es.close(); return }
        const mapped = busEventToLine(event)
        if (mapped) appendLive(mapped.stageId, mapped.line)
      } catch { /* malformed — skip */ }
    }
    es.onerror = () => es.close()
    esRef.current = es
  }

  const appendEvent = (event: ChatEvent) =>
    setStream(prev => [...prev, event])

  const setStage = (id: number, status: StageStatus, detail?: string, data?: Record<string, string>) => {
    setStream(prev => {
      const existing = prev.find(e => e.kind === 'stage' && e.stageId === id)
      if (existing) {
        return prev.map(e =>
          e.kind === 'stage' && e.stageId === id
            ? { ...e, status, detail: detail ?? e.detail, ...(data ? { data } : {}) }
            : e
        )
      }
      return [...prev, {
        id: `stage-${id}`,
        kind: 'stage' as const,
        stageId: id,
        label: STAGE_LABELS[id],
        status,
        detail: detail ?? null,
        ...(data ? { data } : {}),
      }]
    })
  }

  const reset = () => {
    // Resolve any pending confirmation so a paused pipeline promise never leaks
    confirmResolveRef.current?.(false)
    confirmResolveRef.current = null
    setAwaitingConfirm(false)
    esRef.current?.close()
    setStream([])
    setAppState('capture')
    setReport(null)
    setCameraOpen(false)
    runIdRef.current = ''
  }

  const runPipeline = async (capturedPhotos: { base64: string; preview: string }[]) => {
    if (capturedPhotos.length === 0) return
    const base64s = capturedPhotos.map(p => p.base64)
    const previews = capturedPhotos.map(p => p.preview)

    // Fresh runId per scan — opens the SSE channel before any API call
    const runId = crypto.randomUUID()
    runIdRef.current = runId
    openEventSource(runId)

    setAppState('running')
    appendEvent({ id: 'photos', kind: 'photos', previews })

    try {
      // Stage 1 — Vision
      setStage(1, 'running', 'Analyzing images…')
      const { vision, route, userPrompt: resolvedPrompt } = await post<{
        vision: VisionResult; route: RouteDecision; userPrompt?: string
      }>(apiUrl('/api/vision', runId), { images: base64s, userPrompt: pendingPrompt || undefined })
      setPendingPrompt('')  // clear after use
      setStage(1, 'done', `${vision.brand ?? vision.product_category} · ${(vision.confidence * 100).toFixed(0)}% conf`, {
        Route:         route.route === 'A' ? 'A — direct search'
                     : route.route === 'B' ? 'B — predict first'
                     : route.route === 'D' ? 'D — inventory check'
                     : 'C — unclear',
        Confidence:    `${(vision.confidence * 100).toFixed(0)}%`,
        Brand:         vision.brand ?? '—',
        Model:         vision.model_number ?? '—',
        Category:      vision.product_category,
        Description:   vision.visual_description,
        'Visible text': (vision.visible_text?.length ?? 0) > 0 ? vision.visible_text!.join(', ') : '—',
      })

      if (route.route === 'C') {
        appendEvent({ id: `clarification-${Date.now()}`, kind: 'clarification', message: route.message ?? 'Image unclear — please retake.' })
        setAppState('capture')
        esRef.current?.close()
        return
      }

      // Route D — inventory database check
      if (route.route === 'D') {
        setStage(2, 'skipped', 'Skipped — inventory check mode')
        setStage(3, 'running', 'Checking inventory database…')
        try {
          const checkResult = await post<InventoryCheckResult>(
            apiUrl('/api/inventory-check', runId),
            { vision, userPrompt: resolvedPrompt ?? pendingPrompt }
          )
          setStage(3, 'done',
            checkResult.found ? `Found ${checkResult.matchCount} match(es) in database` : 'Not found in database',
            {
              Found:      checkResult.found ? 'Yes ✓' : 'No',
              Matches:    String(checkResult.matchCount),
              'Query':    checkResult.queryUsed,
              Conclusion: checkResult.conclusion,
              ...(checkResult.items.length > 0 ? {
                Items: checkResult.items.slice(0, 3).map(i =>
                  `${i.ItemName} | Qty: ${i.Qty ?? '?'} | $${i.Market_Price}`
                ).join('\n'),
              } : {}),
            }
          )
          appendEvent({
            id: `clarification-${Date.now()}`,
            kind: 'clarification',
            message: checkResult.conclusion,
          })
        } catch (err) {
          setStage(3, 'error', 'Database check failed')
          throw err
        }
        setStage(4, 'skipped', 'Skipped — inventory check mode')
        setStage(5, 'skipped', 'Skipped — inventory check mode')
        setAppState('report')  // allow user to rescan or take action
        esRef.current?.close()
        return
      }

      // Stage 2 — Prediction (Route B only)
      let productName = vision.brand ?? vision.product_category
      let prediction: PredictionResult | null = null
      if (route.route === 'B') {
        setStage(2, 'running', 'Predicting product…')
        const predRes = await post<{ prediction: PredictionResult }>(apiUrl('/api/predict', runId), vision)
        prediction = predRes.prediction
        productName = predRes.prediction.prediction.product_name
        setStage(2, 'done', productName, {
          Confidence: `${(prediction.prediction.prediction_confidence * 100).toFixed(0)}%`,
          Reasoning:  prediction.prediction.reasoning,
          Candidates: (prediction.candidates ?? []).map(c =>
            `${c.name} (${(c.confidence * 100).toFixed(0)}%) — ${c.differentiator}`
          ).join('\n') || '—',
          Query: prediction.verification_query,
        })

        // Pause for user confirmation when prediction confidence is low
        if (prediction.requires_verification && prediction.prediction.prediction_confidence < 0.65) {
          appendEvent({
            id: `clarification-${Date.now()}`,
            kind: 'clarification',
            message: `⚠️ Low confidence (${(prediction.prediction.prediction_confidence * 100).toFixed(0)}%) — I think this is "${productName}". Type "yes" to confirm and continue searching, or "no" to rescan.`,
          })
          setAwaitingConfirm(true)  // enable the command bar so the user can answer
          const confirmed = await new Promise<boolean>(resolve => {
            confirmResolveRef.current = resolve
          })
          confirmResolveRef.current = null
          setAwaitingConfirm(false)
          if (!confirmed) {
            setAppState('capture')
            esRef.current?.close()
            return
          }
        }
      } else {
        setStage(2, 'skipped', 'Skipped — high confidence')
      }

      // Stage 3 — Price Search (with optional re-search loop if CP2 signals contamination)
      setStage(3, 'running', 'Searching prices…')
      let search = await post<SearchResult>(apiUrl('/api/search', runId), { productName, vision })
      setStage(3, 'done', `${search.sources.length} sources · avg $${search.avg}`, {
        Attempts: String(search.attempts),
        Sources:  search.sources.map(s => `${s.name}: $${s.price} (${s.unit})`).join('\n'),
        Range:    `$${search.min} – $${search.max}`,
        Removed:  (search.contaminated_removed?.length ?? 0) > 0
          ? search.contaminated_removed!.map(s => `${s.name}: $${s.price}`).join('\n')
          : 'None',
      })

      // Stage 5 — Report
      setStage(5, 'running', 'Assembling report…')
      const finalReport = await post<FinalReport>('/api/report', { vision, prediction, search })
      setStage(5, 'done', finalReport.notion_json.ItemName, {
        Sources: `${finalReport.sourceCount} verified`,
        Flags:   finalReport.flags.length > 0 ? finalReport.flags.join('\n') : 'None',
      })

      setReport(finalReport)
      appendEvent({ id: 'report', kind: 'report', report: finalReport })
      setAppState('report')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Pipeline error'
      setStream(prev => prev.map(e =>
        e.kind === 'stage' && e.status === 'running'
          ? { ...e, status: 'error' as StageStatus, detail: message }
          : e
      ))
      appendEvent({ id: `error-${Date.now()}`, kind: 'error', message })
      setAppState('capture')
    } finally {
      esRef.current?.close()
    }
  }

  const handleSave = async (qty: number) => {
    if (!report || appState === 'saved') return
    setSaving(true)
    setStage(6, 'running', `Saving qty ${qty}…`)
    try {
      const res = await post<{ message: string }>('/api/notion', {
        action: 'insert',
        item: report.notion_json,
        qty,
      })
      setStage(6, 'done', res.message)
      appendEvent({ id: `saved-${Date.now()}`, kind: 'saved', qty })
      setAppState('saved')
    } catch (err) {
      setStage(6, 'error', 'Save failed')
      appendEvent({ id: `error-${Date.now()}`, kind: 'error', message: err instanceof Error ? err.message : 'Save failed' })
    } finally {
      setSaving(false)
    }
  }

  const handleCommand = async (text: string) => {
    // Resolve a pending low-confidence prediction confirmation
    if (confirmResolveRef.current) {
      const t = text.trim().toLowerCase()
      const confirmed = /^(yes|y|confirm|correct|ok|yep|sure|continue|proceed)/.test(t)
      const denied   = /^(no|n|wrong|rescan|cancel|abort|stop|retry)/.test(t)
      if (confirmed || denied) {
        appendEvent({
          id: `clarification-${Date.now()}`,
          kind: 'clarification',
          message: confirmed ? '✓ Confirmed — searching prices…' : '↩ Rescanning…',
        })
        confirmResolveRef.current(confirmed)
        return
      }
      // Unrecognised input — remind the user what to type
      appendEvent({
        id: `clarification-${Date.now()}`,
        kind: 'clarification',
        message: 'Type "yes" to confirm and continue, or "no" to rescan.',
      })
      return
    }

    // When in capture state, text input sets the prompt context for the next scan
    // (e.g. "check if we have this" — stored and sent with the next photo)
    if (appState === 'capture' && text.trim()) {
      setPendingPrompt(text.trim())
      appendEvent({
        id: `clarification-${Date.now()}`,
        kind: 'clarification',
        message: `Got it: "${text}" — now take a photo to scan`,
      })
      return
    }

    try {
      const res = await post<{ action: string; qty?: number; destination?: string }>(
        '/api/command', { text }
      )
      switch (res.action) {
        case 'save':
          if (report && res.qty) await handleSave(res.qty)
          break
        case 'navigate':
          window.location.href = res.destination ?? '/inventory'
          break
        case 'rescan':
          reset()
          break
        default:
          appendEvent({ id: `error-${Date.now()}`, kind: 'error', message: `Unknown command: "${text}"` })
      }
    } catch {
      appendEvent({ id: `error-${Date.now()}`, kind: 'error', message: 'Command failed' })
    }
  }

  const isRunning = appState === 'running'
  const headerStatus: 'idle' | 'running' | 'done' =
    isRunning ? 'running' : (appState === 'report' || appState === 'saved') ? 'done' : 'idle'

  return (
    <>
      <CameraOverlay
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onAnalyze={runPipeline}
      />

      {/* Fixed header */}
      <header className="fixed top-0 left-0 right-0 z-30 bg-[#050408]/95 backdrop-blur-md border-b border-[#1a1630] px-4 h-14 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`w-1.5 h-1.5 rounded-full transition-colors ${
            headerStatus === 'running' ? 'bg-[#fb923c] animate-pulse' :
            headerStatus === 'done'    ? 'bg-[#34d399]' :
                                         'bg-[#4c3a6e]'
          }`} />
          <span className="text-[15px] font-bold bg-gradient-to-r from-[#c084fc] to-[#38bdf8] bg-clip-text text-transparent">
            InvScan
          </span>
        </div>
        <div className="flex items-center gap-2">
          {isRunning && (
            <span className="text-[#fb923c] text-[10px] font-semibold tracking-wider animate-pulse">
              ANALYZING
            </span>
          )}
          {(appState === 'report' || appState === 'saved') && (
            <span className="text-[#34d399] text-[10px] font-semibold tracking-wider">✓ DONE</span>
          )}
          <Link
            href="/inventory"
            className="text-[10px] font-semibold text-[#4c3a6e] bg-[#0f0d1e] border border-[#1a1630] rounded-full px-3 py-1"
          >
            History
          </Link>
        </div>
      </header>

      {/* Chat stream */}
      <main className="w-full pt-14 pb-[72px] min-h-screen">
        <div className="flex flex-col gap-3 px-4 pt-4">

          {stream.length === 0 && (
            <div className="flex flex-col items-center justify-center py-24 gap-4">
              <div className="w-16 h-16 rounded-2xl bg-[#0f0d1e] border border-[#2d1f50] flex items-center justify-center">
                <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                  <rect x="2" y="7" width="24" height="17" rx="3" stroke="#4c3a6e" strokeWidth="1.5"/>
                  <circle cx="14" cy="15.5" r="4.5" stroke="#4c3a6e" strokeWidth="1.5"/>
                  <path d="M11 7l1.5-3h3l1.5 3" stroke="#4c3a6e" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </div>
              <p className="text-[#4c3a6e] text-sm font-medium">Tap the camera to scan an item</p>
            </div>
          )}

          {stream.map(event => {
            if (event.kind === 'report') {
              return (
                <ReportCard
                  key={event.id}
                  report={event.report}
                  onSave={handleSave}
                  saving={saving}
                />
              )
            }
            return (
              <ChatBubble
                key={event.id}
                event={event as Exclude<ChatEvent, { kind: 'report' }>}
                onReset={reset}
              />
            )
          })}

          <div ref={streamEndRef} />
        </div>
      </main>

      {/* Fixed command bar */}
      <div className="fixed bottom-0 left-0 right-0 z-40">
        <CommandBar
          onCommand={handleCommand}
          onCameraOpen={() => setCameraOpen(true)}
          placeholder={
            awaitingConfirm ? 'Type "yes" to confirm or "no" to rescan…'
            : appState === 'report' ? '"save qty 50" or speak…'
            : 'Tap 📷 to scan, or type a command…'
          }
          disabled={isRunning && !awaitingConfirm}
        />
      </div>
    </>
  )
}
