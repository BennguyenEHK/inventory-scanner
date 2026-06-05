'use client'

import type { PipelineStage } from '@/types'

interface Props {
  stages: PipelineStage[]
}

const STATUS_CONFIG = {
  done:    { icon: '✓', color: 'text-emerald-400', bg: 'bg-emerald-500',  border: '' },
  running: { icon: '⟳', color: 'text-amber-400',   bg: 'bg-amber-500',    border: '' },
  error:   { icon: '✕', color: 'text-red-400',      bg: 'bg-red-500',      border: '' },
  skipped: { icon: '–', color: 'text-slate-500',    bg: 'bg-slate-600',    border: '' },
  pending: { icon: ' ', color: 'text-slate-600',    bg: 'bg-transparent',  border: 'border border-slate-700' },
}

export default function PipelineProgress({ stages }: Props) {
  return (
    <div className="bg-[#111827] rounded-xl p-3 mb-3">
      <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-3">Pipeline Progress</p>
      <div className="space-y-0">
        {stages.map((stage, idx) => {
          const cfg = STATUS_CONFIG[stage.status]
          const isDimmed = stage.status === 'pending' || stage.status === 'skipped'
          return (
            <div
              key={stage.id}
              className={`flex items-center gap-3 py-2 ${idx < stages.length - 1 ? 'border-b border-slate-800' : ''} ${isDimmed ? 'opacity-40' : ''}`}
            >
              <div className={`w-5 h-5 rounded-full ${cfg.bg} ${cfg.border} flex items-center justify-center flex-shrink-0`}>
                <span className={`text-[9px] font-bold text-white ${stage.status === 'running' ? 'animate-spin inline-block' : ''}`}>
                  {cfg.icon}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-[11px] font-semibold ${cfg.color}`}>{stage.label}</p>
                {stage.detail && (
                  <p className="text-[9px] text-slate-500 truncate">{stage.detail}</p>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
