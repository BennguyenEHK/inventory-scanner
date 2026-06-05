'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import type { InventoryItem } from '@/types'

export default function InventoryPage() {
  const [items, setItems]       = useState<InventoryItem[]>([])
  const [loading, setLoading]   = useState(true)
  const [search, setSearch]     = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [toast, setToast]       = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/notion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'query' }),
      })
      const data = await res.json() as { items: InventoryItem[] }
      setItems(data.items)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = items.filter(item =>
    search === '' ||
    item.ItemName.toLowerCase().includes(search.toLowerCase()) ||
    item.Manufacturer.toLowerCase().includes(search.toLowerCase()) ||
    item.itemId.toLowerCase().includes(search.toLowerCase())
  )

  const handleArchive = async (itemId: string, name: string) => {
    if (!confirm(`Archive ${name} (${itemId})? This cannot be easily undone.`)) return
    await fetch('/api/notion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'archive', itemId }),
    })
    setToast(`🗑️ Archived — ${itemId}`)
    setTimeout(() => setToast(null), 3000)
    await load()
  }

  return (
    <main className="max-w-md mx-auto px-3 pt-3 pb-8 min-h-screen">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <Link href="/" className="text-slate-500 text-xl leading-none">←</Link>
        <h1 className="text-sky-400 font-black text-base flex-1">📋 Inventory</h1>
        <button onClick={load} className="text-slate-500 text-sm" aria-label="Refresh">↻</button>
      </div>

      {/* Search */}
      <input
        type="text"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search by name, manufacturer, or ID…"
        className="w-full bg-[#111827] border border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-300 placeholder-slate-600 outline-none mb-3"
      />

      {loading && (
        <p className="text-slate-500 text-sm text-center py-8">Loading…</p>
      )}
      {!loading && filtered.length === 0 && (
        <p className="text-slate-500 text-sm text-center py-8">
          {search ? 'No items match your search.' : 'No inventory items yet. Scan your first item!'}
        </p>
      )}

      <div className="space-y-2">
        {filtered.map(item => (
          <div key={item.itemId} className="bg-[#111827] rounded-xl overflow-hidden border border-slate-800">
            <button
              className="w-full px-3 py-2.5 flex items-center gap-3 text-left"
              onClick={() => setExpanded(expanded === item.itemId ? null : item.itemId)}
            >
              <div className="flex-1 min-w-0">
                <p className="text-slate-200 text-xs font-semibold truncate">{item.ItemName}</p>
                <div className="flex gap-2 mt-0.5">
                  <span className="text-slate-500 text-[10px]">{item.itemId}</span>
                  <span className="text-sky-400 text-[10px]">${item.Market_Price}</span>
                  <span className="text-slate-500 text-[10px]">Qty: {item.Qty ?? '—'}</span>
                </div>
              </div>
              <span className="text-slate-600 text-xs">{expanded === item.itemId ? '▲' : '▼'}</span>
            </button>

            {expanded === item.itemId && (
              <div className="px-3 pb-3 border-t border-slate-800 pt-2">
                <div className="grid grid-cols-2 gap-1 text-[10px] mb-2">
                  {([
                    ['Manufacturer', item.Manufacturer],
                    ['Origin', item.Item_Origin || '—'],
                    ['Length', item.Length || '—'],
                    ['Width', item.Width || '—'],
                    ['Currency', item.Currency],
                    ['Ext Price', item.Ext_Price != null ? `$${item.Ext_Price}` : '—'],
                  ] as [string, string][]).map(([k, v]) => (
                    <div key={k} className="bg-[#0f172a] rounded px-2 py-1">
                      <span className="text-slate-500">{k}: </span>
                      <span className="text-slate-300">{v}</span>
                    </div>
                  ))}
                </div>
                <p className="text-[9px] text-slate-500 leading-relaxed mb-2 break-words">{item.Notes}</p>
                <button
                  onClick={() => handleArchive(item.itemId, item.ItemName)}
                  className="w-full bg-red-900/30 border border-red-800 rounded-lg py-1.5 text-red-400 text-[10px] font-bold"
                >
                  🗑️ Archive Item
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {toast && (
        <div className="fixed bottom-6 left-3 right-3 max-w-md mx-auto bg-slate-700 text-white rounded-xl px-4 py-2.5 text-sm text-center shadow-lg z-40">
          {toast}
        </div>
      )}
    </main>
  )
}
