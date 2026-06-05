'use client'

import { useState } from 'react'
import type { FinalReport } from '@/types'

interface Props {
  report: FinalReport
}

export default function ItemReport({ report }: Props) {
  const [enlarged, setEnlarged] = useState<string | null>(null)
  const item = report.notion_json
  const hasWarnings = report.flags.some(f => f.startsWith('⚠️'))

  return (
    <div className="bg-[#111827] rounded-xl p-3 mb-3 border border-sky-900">
      {/* Header */}
      <div className="flex justify-between items-start mb-2">
        <div>
          <p className="text-sky-400 text-sm font-bold leading-tight">{item.ItemName}</p>
          <p className="text-slate-500 text-[10px]">{item.itemId}</p>
        </div>
        <span className={`text-[9px] px-2 py-0.5 rounded font-bold ${hasWarnings ? 'bg-amber-500/20 text-amber-400' : 'bg-emerald-500/20 text-emerald-400'}`}>
          {hasWarnings ? '⚠️ REVIEW' : '✓ VERIFIED'}
        </span>
      </div>

      {/* Verification images */}
      {report.images.length > 0 && (
        <div className="grid grid-cols-3 gap-1.5 mb-2">
          {report.images.map((url, i) => (
            <button key={i} onClick={() => setEnlarged(url)} className="h-14 rounded overflow-hidden bg-blue-950">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt={`ref ${i + 1}`} className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}
      {report.images.length > 0 && (
        <p className="text-[9px] text-slate-500 text-center mb-2">↑ Tap images to confirm match</p>
      )}

      {/* Pricing */}
      <div className="bg-[#0f172a] rounded-lg p-2 mb-2">
        <div className="flex justify-between items-center mb-1">
          <span className="text-emerald-400 text-[10px] font-bold">💰 {report.sourceCount} Sources</span>
          <span className="text-sky-400 text-[11px] font-bold">Avg: ${item.Market_Price}</span>
        </div>
        <p className="text-slate-500 text-[9px] leading-relaxed">
          {item.Notes.split('\n')[0].replace('Prices: ', '')}
        </p>
      </div>

      {/* Fields grid */}
      <div className="grid grid-cols-2 gap-1.5 text-[10px]">
        {[
          ['Mfr', item.Manufacturer],
          ['Origin', item.Item_Origin || '—'],
          ['Length', item.Length || '—'],
          ['Width', item.Width || '—'],
          ['Currency', item.Currency],
          ['Unit', item.Sales_Unit],
        ].map(([label, value]) => (
          <div key={label} className="bg-[#0f172a] rounded px-2 py-1">
            <span className="text-slate-500">{label}: </span>
            <span className="text-slate-300">{value}</span>
          </div>
        ))}
      </div>

      {/* Flags */}
      {report.flags.map((f, i) => (
        <p key={i} className="text-[9px] text-amber-400 mt-1">{f}</p>
      ))}

      {/* Enlarged image overlay */}
      {enlarged && (
        <div
          className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4"
          onClick={() => setEnlarged(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={enlarged} alt="enlarged" className="max-w-full max-h-full rounded-xl" />
        </div>
      )}
    </div>
  )
}
