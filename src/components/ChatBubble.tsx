'use client'

import type { ChatEvent, StageStatus } from '@/types'

const STATUS_COLOR: Record<StageStatus, string> = {
  done:    'text-[#34d399]',
  running: 'text-[#fb923c]',
  error:   'text-red-400',
  skipped: 'text-[#4c3a6e]',
  pending: 'text-[#4c3a6e]',
}

const STATUS_ICON: Record<StageStatus, string> = {
  done:    '✓',
  running: '⟳',
  error:   '✕',
  skipped: '–',
  pending: '·',
}

function isDimmed(status: StageStatus): boolean {
  return status === 'pending' || status === 'skipped'
}

type NonReportEvent = Exclude<ChatEvent, { kind: 'report' }>

interface Props {
  event: NonReportEvent
  onReset?: () => void
}

const BUBBLE_BASE = 'rounded-[4px_12px_12px_4px] bg-[#0f0d1e] px-3 py-2 text-xs max-w-[92%]'

export default function ChatBubble({ event, onReset }: Props) {
  if (event.kind === 'photos') {
    return (
      <div className={BUBBLE_BASE}>
        <p className="text-[#4c3a6e] text-[10px] font-medium mb-1.5">
          {event.previews.length} photo{event.previews.length !== 1 ? 's' : ''} captured
        </p>
        {event.previews.length > 0 && (
          <div className="flex gap-1.5">
            {event.previews.map((src, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i} src={src} alt="" className="w-8 h-8 rounded-md object-cover border border-[#2d1f50]/60" />
            ))}
          </div>
        )}
      </div>
    )
  }

  if (event.kind === 'stage') {
    const colorClass = STATUS_COLOR[event.status]
    const icon = STATUS_ICON[event.status]
    const dimmed = isDimmed(event.status)
    const entries = event.data ? Object.entries(event.data) : []
    return (
      <div className={`${BUBBLE_BASE} ${colorClass} ${dimmed ? 'opacity-40' : ''}`}>
        {/* Stage header row */}
        <div className="flex items-baseline gap-1.5">
          <span className={`${event.status === 'running' ? 'animate-spin inline-block' : ''}`}>
            {icon}
          </span>
          <span className="font-medium">{event.label}</span>
          {event.detail && (
            <span className="text-[#4c3a6e] text-[10px]">— {event.detail}</span>
          )}
        </div>

        {/* Expandable detail box — only when data is available */}
        {entries.length > 0 && (
          <details className="mt-2 group">
            <summary className="list-none cursor-pointer select-none flex items-center gap-1 text-[#4c3a6e] text-[9px] font-medium w-fit">
              <svg
                width="8" height="8" viewBox="0 0 8 8" fill="none"
                className="transition-transform group-open:rotate-90"
              >
                <path d="M2.5 1.5L5.5 4 2.5 6.5" stroke="#4c3a6e" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Details
            </summary>
            <div className="mt-1.5 bg-[#080615] rounded-lg border border-[#1a1630] px-2.5 py-2 space-y-1.5">
              {entries.map(([key, value]) => (
                <div key={key} className="text-[9px]">
                  <span className="text-[#4c3a6e] font-semibold uppercase tracking-wide">{key}</span>
                  <p className="text-slate-400 mt-0.5 whitespace-pre-wrap break-words leading-relaxed">{value}</p>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    )
  }

  if (event.kind === 'error') {
    return (
      <div className="rounded-xl bg-red-900/30 border border-red-700 px-3 py-2 text-xs text-red-300 max-w-[92%]">
        ✕ {event.message}
      </div>
    )
  }

  if (event.kind === 'clarification') {
    return (
      <div className="rounded-xl bg-amber-900/30 border border-amber-700 px-3 py-2 text-xs text-amber-300 max-w-[92%]">
        ⚠ {event.message}
      </div>
    )
  }

  // kind === 'saved'
  return (
    <div className="rounded-xl bg-[#0f0d1e] border border-[#34d399]/40 px-3 py-3 max-w-[92%]">
      <p className="text-[#34d399] font-semibold text-xs mb-2">✓ Saved to Notion — qty {event.qty}</p>
      <button
        onClick={onReset}
        className="w-full bg-[#12101e] border border-[#2d1f50] rounded-lg py-2 text-[#c084fc] font-semibold text-xs"
      >
        Scan Another →
      </button>
    </div>
  )
}
