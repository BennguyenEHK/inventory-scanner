'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import CameraOverlay from '@/components/CameraOverlay'
import CommandBar from '@/components/CommandBar'
import ChatBubble from '@/components/ChatBubble'
import ReportCard from '@/components/ReportCard'
import type {
  AppState, ChatEvent, FinalReport, StageStatus,
  VisionResult, RouteDecision, PredictionResult,
  SearchResult, CheckpointResult,
} from '@/types'

const STAGE_LABELS: Record<number, string> = {
  1: 'Vision Extraction',
  2: 'Prediction',
  3: 'Price Search',
  4: 'Verification',
  5: 'Report Assembly',
  6: 'Save to Notion',
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
  const streamEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    streamEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [stream.length])

  const appendEvent = (event: ChatEvent) =>
    setStream(prev => [...prev, event])

  const setStage = (id: number, status: StageStatus, detail?: string) => {
    setStream(prev => {
      const existing = prev.find(e => e.kind === 'stage' && e.stageId === id)
      if (existing) {
        return prev.map(e =>
          e.kind === 'stage' && e.stageId === id
            ? { ...e, status, detail: detail ?? e.detail }
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
      }]
    })
  }

  const reset = () => {
    setStream([])
    setAppState('capture')
    setReport(null)
    setCameraOpen(false)
  }

  const runPipeline = async (capturedPhotos: { base64: string; preview: string }[]) => {
    if (capturedPhotos.length === 0) return
    const base64s = capturedPhotos.map(p => p.base64)
    const previews = capturedPhotos.map(p => p.preview)
    setAppState('running')
    appendEvent({ id: 'photos', kind: 'photos', previews })

    try {
      // Stage 1 — Vision
      setStage(1, 'running', 'Analyzing images…')
      const { vision, route } = await post<{ vision: VisionResult; route: RouteDecision }>(
        '/api/vision', { images: base64s }
      )
      setStage(1, 'done', `${vision.brand ?? vision.product_category} · ${(vision.confidence * 100).toFixed(0)}% conf`)

      if (route.route === 'C') {
        appendEvent({ id: `clarification-${Date.now()}`, kind: 'clarification', message: route.message ?? 'Image unclear — please retake.' })
        setAppState('capture')
        return
      }

      // Stage 2 — Prediction (Route B only)
      let productName = vision.brand ?? vision.product_category
      let prediction: PredictionResult | null = null
      if (route.route === 'B') {
        setStage(2, 'running', 'Predicting product…')
        const predRes = await post<{ prediction: PredictionResult }>('/api/predict', vision)
        prediction = predRes.prediction
        productName = predRes.prediction.prediction.product_name
        setStage(2, 'done', productName)
      } else {
        setStage(2, 'skipped', 'Skipped — high confidence')
      }

      // Stage 3 — Price Search
      setStage(3, 'running', 'Searching prices…')
      const search = await post<SearchResult>('/api/search', { productName })
      setStage(3, 'done', `${search.sources.length} sources · avg $${search.avg}`)

      // Stage 4 — Verification
      setStage(4, 'running', 'Verifying…')
      const [cp1, cp2] = await Promise.all([
        post<CheckpointResult>('/api/verify', { checkpoint: 1, vision }),
        post<CheckpointResult>('/api/verify', { checkpoint: 2, productName, search }),
      ])
      const cp2Clean = cp2.clean_sources?.length ?? search.sources.length
      setStage(4, 'done', `CP1: ${cp1.passed ? '✓' : '⚠'} · CP2: ${cp2Clean} clean sources`)

      // Stage 5 — Report
      setStage(5, 'running', 'Assembling report…')
      const finalReport = await post<FinalReport>('/api/report', { vision, prediction, search, cp1, cp2 })
      setStage(5, 'done', finalReport.notion_json.ItemName)

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
    }
  }

  const handleSave = async (qty: number) => {
    if (!report || appState === 'saved') return  // prevent double-save
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

          {/* Empty state */}
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

          {/* Event stream */}
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
          placeholder={appState === 'report' ? '"save qty 50" or speak…' : 'Tap 📷 to scan, or type a command…'}
          disabled={isRunning}
        />
      </div>
    </>
  )
}
