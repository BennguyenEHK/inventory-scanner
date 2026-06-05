'use client'

import { useState } from 'react'
import Link from 'next/link'
import PhotoCapture from '@/components/PhotoCapture'
import PipelineProgress from '@/components/PipelineProgress'
import ItemReport from '@/components/ItemReport'
import QtyControl from '@/components/QtyControl'
import CommandBar from '@/components/CommandBar'
import type {
  AppState, FinalReport, PipelineStage,
  VisionResult, RouteDecision, PredictionResult,
  SearchResult, CheckpointResult,
} from '@/types'

const INITIAL_STAGES: PipelineStage[] = [
  { id: 1, label: 'Vision Extraction',  status: 'pending', detail: null },
  { id: 2, label: 'Prediction',          status: 'pending', detail: null },
  { id: 3, label: 'Price Search',        status: 'pending', detail: null },
  { id: 4, label: 'Verification',        status: 'pending', detail: null },
  { id: 5, label: 'Report Assembly',     status: 'pending', detail: null },
  { id: 6, label: 'Save to Notion',      status: 'pending', detail: null },
]

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
  const [appState, setAppState]   = useState<AppState>('capture')
  const [photos, setPhotos]       = useState<string[]>([])
  const [stages, setStages]       = useState<PipelineStage[]>(INITIAL_STAGES)
  const [report, setReport]       = useState<FinalReport | null>(null)
  const [toast, setToast]         = useState<{ msg: string; ok: boolean } | null>(null)
  const [saving, setSaving]       = useState(false)
  const [clarification, setClarification] = useState<string | null>(null)

  const setStage = (id: number, status: PipelineStage['status'], detail?: string) =>
    setStages(prev => prev.map(s => s.id === id ? { ...s, status, detail: detail ?? s.detail } : s))

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 4000)
  }

  const reset = () => {
    setAppState('capture')
    setPhotos([])
    setStages(INITIAL_STAGES)
    setReport(null)
    setClarification(null)
  }

  const runPipeline = async () => {
    if (photos.length === 0) return
    setAppState('running')
    setStages(INITIAL_STAGES)
    setClarification(null)

    try {
      // Stage 1 — Vision
      setStage(1, 'running', 'Analyzing images…')
      const { vision, route } = await post<{ vision: VisionResult; route: RouteDecision }>(
        '/api/vision', { images: photos }
      )
      setStage(1, 'done', `${vision.brand ?? vision.product_category} · ${(vision.confidence * 100).toFixed(0)}% conf`)

      // Route C — image too unclear
      if (route.route === 'C') {
        setClarification(route.message ?? 'Image unclear — please retake.')
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

      // Stage 4 — Verification (CP1 + CP2 in parallel)
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
      setAppState('report')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Pipeline error'
      setStages(prev =>
        prev.map(s => s.status === 'running' ? { ...s, status: 'error', detail: msg } : s)
      )
      showToast(`❌ ${msg}`, false)
      setAppState('capture')
    }
  }

  const handleSave = async (qty: number) => {
    if (!report) return
    setSaving(true)
    setStage(6, 'running', `Saving qty ${qty}…`)
    try {
      const res = await post<{ message: string }>('/api/notion', {
        action: 'insert',
        item: report.notion_json,
        qty,
      })
      setStage(6, 'done', 'Saved ✓')
      showToast(res.message)
      setAppState('saved')
    } catch (err) {
      setStage(6, 'error', 'Save failed')
      showToast(`❌ ${err instanceof Error ? err.message : 'Save failed'}`, false)
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
        case 'update':
          showToast('Use the qty stepper to update saved items', false)
          break
        case 'navigate':
          window.location.href = res.destination ?? '/inventory'
          break
        case 'rescan':
          reset()
          break
        default:
          showToast(`Unknown command: "${text}"`, false)
      }
    } catch {
      showToast('Command failed', false)
    }
  }

  const isRunning = appState === 'running'

  return (
    <main className="max-w-md mx-auto px-3 pt-3 pb-28 min-h-screen">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-sky-400 font-black text-base tracking-tight">📦 InvScan</h1>
        <div className="flex items-center gap-2">
          {isRunning && (
            <span className="text-amber-400 text-[10px] font-bold animate-pulse">● ANALYZING</span>
          )}
          {appState === 'report' && (
            <span className="text-emerald-400 text-[10px] font-bold">✓ DONE</span>
          )}
          <Link href="/inventory" className="bg-[#1e293b] rounded-full px-3 py-1 text-slate-400 text-[10px]">
            History
          </Link>
        </div>
      </div>

      {/* Route C clarification */}
      {clarification && (
        <div className="bg-amber-900/30 border border-amber-700 rounded-xl p-3 mb-3 text-amber-300 text-xs">
          {clarification}
        </div>
      )}

      {/* STATE 1: Capture */}
      {appState === 'capture' && (
        <>
          <PhotoCapture onPhotosChange={setPhotos} disabled={isRunning} />
          <button
            onClick={runPipeline}
            disabled={photos.length === 0}
            className="w-full bg-gradient-to-br from-sky-600 to-violet-600 disabled:opacity-40 rounded-xl py-3 text-white font-black text-sm mb-2"
          >
            ⚡ Analyze Items
            {photos.length > 0 && (
              <span className="text-xs font-normal ml-1 opacity-70">
                {photos.length} photo{photos.length > 1 ? 's' : ''} ready
              </span>
            )}
          </button>
        </>
      )}

      {/* STATE 2: Running */}
      {isRunning && <PipelineProgress stages={stages} />}

      {/* STATE 3+4: Report / Saved */}
      {(appState === 'report' || appState === 'saved') && report && (
        <>
          <PipelineProgress stages={stages} />
          <ItemReport report={report} />
          {appState === 'report' && (
            <QtyControl onSave={handleSave} saving={saving} />
          )}
          {appState === 'saved' && (
            <button
              onClick={reset}
              className="w-full bg-[#1e293b] rounded-xl py-2.5 text-slate-300 text-sm font-bold mb-2"
            >
              📷 Scan Another Item
            </button>
          )}
        </>
      )}

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-24 left-3 right-3 max-w-md mx-auto rounded-xl px-4 py-2.5 text-sm font-bold shadow-lg z-40 ${toast.ok ? 'bg-emerald-600' : 'bg-red-700'} text-white`}>
          {toast.msg}
        </div>
      )}

      {/* Persistent Command Bar — always at bottom */}
      <div className="fixed bottom-0 left-0 right-0 bg-[#0a0a0f]/95 backdrop-blur-sm px-3 pt-2 pb-4 max-w-md mx-auto">
        <CommandBar
          onCommand={handleCommand}
          placeholder={appState === 'report' ? '"save qty 50" or speak…' : 'Type a command or speak…'}
        />
      </div>
    </main>
  )
}
