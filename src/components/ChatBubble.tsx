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
    return (
      <div className={`${BUBBLE_BASE} ${colorClass} ${dimmed ? 'opacity-40' : ''}`}>
        <span className={`mr-2 ${event.status === 'running' ? 'animate-spin inline-block' : ''}`}>
          {icon}
        </span>
        <span className="font-medium">{event.label}</span>
        {event.detail && (
          <span className="text-[#4c3a6e] ml-1 text-[10px]">— {event.detail}</span>
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
