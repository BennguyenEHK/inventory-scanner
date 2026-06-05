'use client'

import { useState } from 'react'
import type { FinalReport } from '@/types'

interface Props {
  report: FinalReport
  onSave: (qty: number) => void
  saving: boolean
}

export default function ReportCard({ report, onSave, saving }: Props) {
  const [qty, setQty] = useState(1)
  const [enlarged, setEnlarged] = useState<string | null>(null)
  const item = report.notion_json
  const hasWarnings = report.flags.some(f => f.startsWith('⚠️'))

  return (
    <div className="rounded-2xl bg-[#0a0818] border border-[#a855f7]/25 px-4 py-4 relative overflow-hidden">
      {/* top gradient line */}
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#c084fc] to-transparent" />

      {/* verified badge */}
      <span className={`inline-block text-[9px] font-semibold tracking-wider px-2.5 py-0.5 rounded-full mb-2 ${
        hasWarnings
          ? 'text-amber-400 bg-amber-400/10 border border-amber-400/30'
          : 'text-[#34d399] bg-[#34d399]/10 border border-[#34d399]/30'
      }`}>
        {hasWarnings ? '⚠ REVIEW' : '✓ VERIFIED'}
      </span>

      {/* item name + id */}
      <p className="text-white font-bold text-sm leading-tight mb-0.5">{item.ItemName}</p>
      <p className="text-[#4c3a6e] text-[10px] mb-3">{item.itemId}</p>

      {/* price */}
      <p className="text-[26px] font-bold bg-gradient-to-r from-[#c084fc] to-[#38bdf8] bg-clip-text text-transparent leading-tight mb-1">
        ${item.Market_Price}
        <span className="text-xs text-[#4c3a6e] font-normal ml-1.5">avg · {report.sourceCount} sources</span>
      </p>

      {/* verification images */}
      {report.images.length > 0 && (
        <div className="flex gap-1.5 mb-3">
          {report.images.map((url, i) => (
            <button
              key={i}
              onClick={() => setEnlarged(url)}
              className="flex-1 h-[52px] rounded-lg overflow-hidden bg-[#1a1630] border border-[#2d1f50]/60"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt={`ref ${i + 1}`} className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}
      {report.images.length > 0 && (
        <p className="text-[9px] text-[#4c3a6e] text-center mb-3">↑ Tap to confirm match</p>
      )}

      {/* fields grid */}
      <div className="grid grid-cols-2 gap-1.5 text-[11px] mb-3">
        {([
          ['Mfr', item.Manufacturer],
          ['Origin', item.Item_Origin || '—'],
          ['Unit', item.Sales_Unit],
          ['Currency', item.Currency],
        ] as [string, string][]).map(([label, value]) => (
          <div key={label} className="bg-[#0f0d1e] rounded-lg px-2.5 py-1.5">
            <span className="text-[#4c3a6e]">{label}: </span>
            <span className="text-slate-300">{value}</span>
          </div>
        ))}
      </div>

      {/* warning flags */}
      {report.flags.map((f, i) => (
        <p key={i} className="text-[10px] text-amber-400 mb-1">{f}</p>
      ))}

      {/* qty stepper + save */}
      <div className="flex items-center gap-2 mt-3">
        <button
          onClick={() => setQty(q => Math.max(1, q - 1))}
          disabled={saving}
          className="w-9 h-9 rounded-xl bg-[#12101e] border border-[#2d1f50] text-[#c084fc] font-bold text-base disabled:opacity-30"
        >−</button>
        <span className="text-white font-bold text-base w-8 text-center">{qty}</span>
        <button
          onClick={() => setQty(q => q + 1)}
          disabled={saving}
          className="w-9 h-9 rounded-xl bg-[#12101e] border border-[#2d1f50] text-[#c084fc] font-bold text-base disabled:opacity-30"
        >+</button>
        <button
          onClick={() => onSave(qty)}
          disabled={saving}
          className="flex-1 h-9 bg-gradient-to-r from-[#7c3aed] to-[#2563eb] disabled:opacity-40 rounded-xl text-white font-semibold text-xs"
        >
          {saving ? 'Saving…' : 'Save to Notion →'}
        </button>
      </div>

      {/* enlarged image overlay */}
      {enlarged && (
        <div
          className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-6"
          onClick={() => setEnlarged(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={enlarged} alt="enlarged" className="max-w-full max-h-full rounded-xl" />
        </div>
      )}
    </div>
  )
}
