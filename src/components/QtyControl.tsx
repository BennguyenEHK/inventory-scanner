'use client'

import { useState } from 'react'

interface Props {
  onSave: (qty: number) => void
  disabled?: boolean
  saving?: boolean
}

export default function QtyControl({ onSave, disabled, saving }: Props) {
  const [qty, setQty] = useState(1)

  return (
    <div className="bg-[#111827] rounded-xl px-3 py-2 mb-2 flex gap-2 items-center">
      <span className="text-slate-500 text-xs">Qty:</span>
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => setQty(q => Math.max(1, q - 1))}
          disabled={disabled || saving}
          className="bg-[#1e293b] disabled:opacity-40 rounded w-7 h-7 flex items-center justify-center text-slate-300 text-sm font-bold"
        >−</button>
        <input
          type="number"
          min={1}
          value={qty}
          onChange={e => setQty(Math.max(1, parseInt(e.target.value) || 1))}
          disabled={disabled || saving}
          className="w-12 h-7 bg-[#0f172a] border border-slate-700 text-white text-center text-xs rounded disabled:opacity-40"
        />
        <button
          onClick={() => setQty(q => q + 1)}
          disabled={disabled || saving}
          className="bg-[#1e293b] disabled:opacity-40 rounded w-7 h-7 flex items-center justify-center text-slate-300 text-sm font-bold"
        >+</button>
      </div>
      <button
        onClick={() => onSave(qty)}
        disabled={disabled || saving || qty < 1}
        className="flex-1 bg-gradient-to-r from-emerald-500 to-sky-600 disabled:opacity-40 rounded-lg py-1.5 text-white text-xs font-bold"
      >
        {saving ? '⏳ Saving…' : '✅ Save to Notion'}
      </button>
    </div>
  )
}
