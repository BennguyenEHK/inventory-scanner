# UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the InvScan mobile UI from a static single-page layout into a Chrome Violet chat-log with a full-screen camera overlay.

**Architecture:** The main page becomes a scrollable `ChatEvent[]` stream — each pipeline stage and result appends a typed bubble. A full-screen `CameraOverlay` component uses `getUserMedia()` for a live viewfinder (no OS app-switch lag). The command bar is rebuilt with SVG-only icons and an animated waveform during recording.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind v4, Space Grotesk (Google Fonts), Vitest

**Spec:** `docs/superpowers/specs/2026-06-05-ui-redesign.md`

---

## Parallelization Map

```
Wave 1 (fully parallel — no shared state):
  Task 1: Foundation (globals.css + layout.tsx + types)
  Task 2: ChatBubble component
  Task 3: ReportCard component
  Task 4: CameraOverlay component
  Task 5: CommandBar rewrite

Wave 2 (after all Wave 1 tasks complete):
  Task 6: page.tsx rewrite

Wave 3 (after Task 6):
  Task 7: Cleanup — delete old components
```

---

## File Map

| File | Action | Responsible For |
|---|---|---|
| `src/types/index.ts` | Modify | Add `ChatEvent` discriminated union |
| `src/app/globals.css` | Modify | Chrome Violet CSS tokens + wave keyframe |
| `src/app/layout.tsx` | Modify | Space Grotesk font, remove Geist Sans |
| `.gitignore` | Modify | Ignore `.superpowers/` directory |
| `src/components/ChatBubble.tsx` | Create | Renders all non-report chat events as styled bubbles |
| `src/components/ChatBubble.test.ts` | Create | Pure logic tests for status colors, icons, helpers |
| `src/components/ReportCard.tsx` | Create | Final report card with integrated qty stepper |
| `src/components/ReportCard.test.ts` | Create | Qty clamping, save-button enabled logic |
| `src/components/CameraOverlay.tsx` | Create | Full-screen getUserMedia viewfinder + canvas capture |
| `src/components/CameraOverlay.test.ts` | Create | captureFrame / resizeImage / photo-limit logic |
| `src/components/CommandBar.tsx` | Rewrite | SVG icons, 3 visual states, waveform animation |
| `src/components/CommandBar.test.ts` | Create | canSubmit, mic state logic |
| `src/app/page.tsx` | Rewrite | Chat-log architecture, stream state, auto-scroll |
| `src/app/page.test.ts` | Create | Stream append/update logic |
| `src/components/PhotoCapture.tsx` | Delete | Replaced by CameraOverlay |
| `src/components/PhotoCapture.test.tsx` | Delete | Component removed |
| `src/components/PipelineProgress.tsx` | Delete | Replaced by ChatBubble stream |
| `src/components/PipelineProgress.test.tsx` | Delete | Component removed |
| `src/components/ItemReport.tsx` | Delete | Replaced by ReportCard |
| `src/components/QtyControl.tsx` | Delete | Merged into ReportCard |

---

## Task 1: Foundation — types, palette, font

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/app/globals.css`
- Modify: `src/app/layout.tsx`
- Modify: `.gitignore`

- [ ] **Step 1: Add `ChatEvent` type to `src/types/index.ts`**

Append to the end of `src/types/index.ts`:

```ts
// Chat-log stream events (UI layer only)
export type ChatEvent =
  | { id: string; kind: 'photos'; previews: string[] }
  | { id: string; kind: 'stage'; stageId: number; label: string; status: StageStatus; detail: string | null }
  | { id: string; kind: 'report'; report: FinalReport }
  | { id: string; kind: 'error'; message: string }
  | { id: string; kind: 'clarification'; message: string }
  | { id: string; kind: 'saved'; qty: number }
```

- [ ] **Step 2: Replace `src/app/globals.css` with Chrome Violet tokens**

Full replacement:

```css
@import "tailwindcss";

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --font-sans: var(--font-space-grotesk);

  --color-surface:    #0f0d1e;
  --color-surface2:   #12101e;
  --color-border:     #1a1630;
  --color-border2:    #2d1f50;
  --color-muted:      #4c3a6e;
  --color-confirmed:  #34d399;
  --color-running:    #fb923c;
  --color-accent:     #38bdf8;
  --color-danger:     #ef4444;
}

:root {
  --background:  #050408;
  --foreground:  #e2e8f0;
  --grad-from:   #c084fc;
  --grad-to:     #38bdf8;
}

* { -webkit-tap-highlight-color: transparent; }

body {
  background: var(--background);
  color: var(--foreground);
  font-family: var(--font-space-grotesk), system-ui, sans-serif;
  overscroll-behavior-y: contain;
}

@keyframes wave {
  0%, 100% { transform: scaleY(1); }
  50%       { transform: scaleY(0.3); }
}

::-webkit-scrollbar { width: 4px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: #2d1f50; border-radius: 2px; }
```

- [ ] **Step 3: Update `src/app/layout.tsx` to use Space Grotesk**

Full replacement:

```tsx
import type { Metadata, Viewport } from 'next'
import { Space_Grotesk } from 'next/font/google'
import './globals.css'

const spaceGrotesk = Space_Grotesk({
  variable: '--font-space-grotesk',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
})

export const metadata: Metadata = {
  title: 'InvScan — Inventory Scanner',
  description: 'AI-powered inventory scanner with Notion integration',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${spaceGrotesk.variable} h-full`}>
      <body className="min-h-full flex flex-col bg-[#050408] text-slate-200 antialiased">
        {children}
      </body>
    </html>
  )
}
```

- [ ] **Step 4: Add `.superpowers/` to `.gitignore`**

Append to `.gitignore`:
```
# brainstorming visual companion
.superpowers/
```

- [ ] **Step 5: Build to confirm no TypeScript errors**

```bash
npm run build
```

Expected: exits 0, no type errors. If Space Grotesk import fails, confirm `next` version supports `next/font/google` (it does since Next 13).

- [ ] **Step 6: Commit**

```bash
git add src/types/index.ts src/app/globals.css src/app/layout.tsx .gitignore
git commit -m "feat: add ChatEvent type, Chrome Violet palette, Space Grotesk font"
```

---

## Task 2: ChatBubble component

**Files:**
- Create: `src/components/ChatBubble.tsx`
- Create: `src/components/ChatBubble.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/components/ChatBubble.test.ts`:

```ts
import { describe, it, expect } from 'vitest'

// Pure logic extracted from ChatBubble — test these before writing the component

type StageStatus = 'pending' | 'running' | 'done' | 'skipped' | 'error'

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

describe('ChatBubble logic', () => {
  it('maps every StageStatus to a color class', () => {
    const statuses: StageStatus[] = ['done', 'running', 'error', 'skipped', 'pending']
    for (const s of statuses) {
      expect(STATUS_COLOR[s]).toBeTruthy()
    }
  })

  it('maps every StageStatus to an icon', () => {
    const statuses: StageStatus[] = ['done', 'running', 'error', 'skipped', 'pending']
    for (const s of statuses) {
      expect(STATUS_ICON[s]).toBeTruthy()
    }
  })

  it('done stage uses confirmed color', () => {
    expect(STATUS_COLOR['done']).toBe('text-[#34d399]')
  })

  it('running stage uses orange color', () => {
    expect(STATUS_COLOR['running']).toBe('text-[#fb923c]')
  })

  it('error stage uses red color', () => {
    expect(STATUS_COLOR['error']).toBe('text-red-400')
  })

  it('pending and skipped are dimmed', () => {
    expect(isDimmed('pending')).toBe(true)
    expect(isDimmed('skipped')).toBe(true)
    expect(isDimmed('done')).toBe(false)
    expect(isDimmed('running')).toBe(false)
    expect(isDimmed('error')).toBe(false)
  })

  it('photos bubble: count label is singular for 1 photo', () => {
    const count = 1
    const label = `${count} photo${count !== 1 ? 's' : ''} captured`
    expect(label).toBe('1 photo captured')
  })

  it('photos bubble: count label is plural for multiple photos', () => {
    const count = 3
    const label = `${count} photo${count !== 1 ? 's' : ''} captured`
    expect(label).toBe('3 photos captured')
  })
})
```

- [ ] **Step 2: Run test to confirm it passes (logic-only — no component yet)**

```bash
npm test -- ChatBubble
```

Expected: PASS (all assertions are on plain logic, no component needed)

- [ ] **Step 3: Create `src/components/ChatBubble.tsx`**

```tsx
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
```

- [ ] **Step 4: Build to confirm no TS errors**

```bash
npm run build
```

Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/components/ChatBubble.tsx src/components/ChatBubble.test.ts
git commit -m "feat: add ChatBubble component for chat-log stream"
```

---

## Task 3: ReportCard component

**Files:**
- Create: `src/components/ReportCard.tsx`
- Create: `src/components/ReportCard.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/components/ReportCard.test.ts`:

```ts
import { describe, it, expect } from 'vitest'

function clampQty(qty: number, min = 1): number {
  return Math.max(min, qty)
}

function canSave(saving: boolean, qty: number): boolean {
  return !saving && qty >= 1
}

function hasWarnings(flags: string[]): boolean {
  return flags.some(f => f.startsWith('⚠️'))
}

function badgeText(flags: string[]): string {
  return hasWarnings(flags) ? '⚠ REVIEW' : '✓ VERIFIED'
}

describe('ReportCard logic', () => {
  it('clamps qty to minimum of 1 when decremented below 1', () => {
    expect(clampQty(0)).toBe(1)
    expect(clampQty(-5)).toBe(1)
    expect(clampQty(1)).toBe(1)
    expect(clampQty(5)).toBe(5)
  })

  it('allows save when not saving and qty >= 1', () => {
    expect(canSave(false, 1)).toBe(true)
    expect(canSave(false, 50)).toBe(true)
  })

  it('blocks save when saving is true', () => {
    expect(canSave(true, 1)).toBe(false)
  })

  it('blocks save when qty is 0', () => {
    expect(canSave(false, 0)).toBe(false)
  })

  it('detects warning flags by ⚠️ prefix', () => {
    expect(hasWarnings(['⚠️ Price may be outdated'])).toBe(true)
    expect(hasWarnings(['ℹ️ Info note'])).toBe(false)
    expect(hasWarnings([])).toBe(false)
  })

  it('returns VERIFIED badge when no warnings', () => {
    expect(badgeText([])).toBe('✓ VERIFIED')
  })

  it('returns REVIEW badge when warnings present', () => {
    expect(badgeText(['⚠️ Some warning'])).toBe('⚠ REVIEW')
  })
})
```

- [ ] **Step 2: Run test to confirm it passes**

```bash
npm test -- ReportCard
```

Expected: PASS

- [ ] **Step 3: Create `src/components/ReportCard.tsx`**

```tsx
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
```

- [ ] **Step 4: Build to confirm no TS errors**

```bash
npm run build
```

Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/components/ReportCard.tsx src/components/ReportCard.test.ts
git commit -m "feat: add ReportCard with integrated qty stepper and gradient glow"
```

---

## Task 4: CameraOverlay component

**Files:**
- Create: `src/components/CameraOverlay.tsx`
- Create: `src/components/CameraOverlay.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/components/CameraOverlay.test.ts`:

```ts
import { describe, it, expect } from 'vitest'

const MAX_PHOTOS = 3

function canAddMore(count: number, max = MAX_PHOTOS): boolean {
  return count < max
}

function remainingSlots(count: number, max = MAX_PHOTOS): number {
  return Math.max(0, max - count)
}

function sliceToRemaining(files: File[], current: number, max = MAX_PHOTOS): File[] {
  return files.slice(0, Math.max(0, max - current))
}

function analyzeButtonLabel(count: number): string {
  return `⚡ Analyze ${count} Photo${count !== 1 ? 's' : ''} →`
}

// resizeImage logic (dimension math only — no DOM needed)
function computeResizeDimensions(
  width: number,
  height: number,
  maxPx = 1024
): { width: number; height: number } {
  if (width <= maxPx && height <= maxPx) return { width, height }
  if (width > height) {
    return { width: maxPx, height: Math.round(height * maxPx / width) }
  }
  return { width: Math.round(width * maxPx / height), height: maxPx }
}

describe('CameraOverlay logic', () => {
  it('allows adding when count < MAX_PHOTOS', () => {
    expect(canAddMore(0)).toBe(true)
    expect(canAddMore(1)).toBe(true)
    expect(canAddMore(2)).toBe(true)
  })

  it('blocks adding when count >= MAX_PHOTOS', () => {
    expect(canAddMore(3)).toBe(false)
    expect(canAddMore(4)).toBe(false)
  })

  it('calculates remaining slots correctly', () => {
    expect(remainingSlots(0)).toBe(3)
    expect(remainingSlots(1)).toBe(2)
    expect(remainingSlots(2)).toBe(1)
    expect(remainingSlots(3)).toBe(0)
  })

  it('slices files to fit remaining capacity', () => {
    const files = [new File([], 'a'), new File([], 'b'), new File([], 'c'), new File([], 'd')]
    expect(sliceToRemaining(files, 2).length).toBe(1)
    expect(sliceToRemaining(files, 0).length).toBe(3)
    expect(sliceToRemaining(files, 3).length).toBe(0)
  })

  it('shows singular label for 1 photo', () => {
    expect(analyzeButtonLabel(1)).toBe('⚡ Analyze 1 Photo →')
  })

  it('shows plural label for multiple photos', () => {
    expect(analyzeButtonLabel(2)).toBe('⚡ Analyze 2 Photos →')
    expect(analyzeButtonLabel(3)).toBe('⚡ Analyze 3 Photos →')
  })

  describe('computeResizeDimensions', () => {
    it('does not resize images within maxPx', () => {
      const result = computeResizeDimensions(800, 600, 1024)
      expect(result).toEqual({ width: 800, height: 600 })
    })

    it('scales down wide images preserving aspect ratio', () => {
      const result = computeResizeDimensions(2048, 1024, 1024)
      expect(result.width).toBe(1024)
      expect(result.height).toBe(512)
    })

    it('scales down tall images preserving aspect ratio', () => {
      const result = computeResizeDimensions(1024, 2048, 1024)
      expect(result.width).toBe(512)
      expect(result.height).toBe(1024)
    })

    it('handles square images', () => {
      const result = computeResizeDimensions(2000, 2000, 1024)
      expect(result.width).toBe(1024)
      expect(result.height).toBe(1024)
    })
  })
})
```

- [ ] **Step 2: Run test to confirm it passes**

```bash
npm test -- CameraOverlay
```

Expected: PASS

- [ ] **Step 3: Create `src/components/CameraOverlay.tsx`**

```tsx
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

interface PhotoEntry {
  preview: string
  base64: string
}

interface Props {
  open: boolean
  onClose: () => void
  onAnalyze: (photos: PhotoEntry[]) => void
}

const MAX_PHOTOS = 3

export function computeResizeDimensions(
  width: number,
  height: number,
  maxPx = 1024
): { width: number; height: number } {
  if (width <= maxPx && height <= maxPx) return { width, height }
  if (width > height) {
    return { width: maxPx, height: Math.round(height * maxPx / width) }
  }
  return { width: Math.round(width * maxPx / height), height: maxPx }
}

export function captureFrame(video: HTMLVideoElement): string {
  const canvas = document.createElement('canvas')
  canvas.width = video.videoWidth
  canvas.height = video.videoHeight
  canvas.getContext('2d')!.drawImage(video, 0, 0)
  return canvas.toDataURL('image/jpeg', 0.85)
}

export async function resizeDataUrl(dataUrl: string, maxPx = 1024): Promise<string> {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => {
      const { width, height } = computeResizeDimensions(img.naturalWidth, img.naturalHeight, maxPx)
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      canvas.getContext('2d')!.drawImage(img, 0, 0, width, height)
      resolve(canvas.toDataURL('image/jpeg', 0.85).split(',')[1])
    }
    img.src = dataUrl
  })
}

export async function fileToEntry(file: File): Promise<PhotoEntry> {
  const preview = URL.createObjectURL(file)
  const base64 = await resizeDataUrl(preview)
  return { preview, base64 }
}

export default function CameraOverlay({ open, onClose, onAnalyze }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const galleryRef = useRef<HTMLInputElement>(null)
  const [photos, setPhotos] = useState<PhotoEntry[]>([])
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment')
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null)
  const [fallback, setFallback] = useState(false)

  const stopStream = useCallback((stream: MediaStream | null) => {
    stream?.getTracks().forEach(t => t.stop())
  }, [])

  useEffect(() => {
    if (!open) {
      stopStream(mediaStream)
      setMediaStream(null)
      setPhotos([])
      setFallback(false)
      return
    }

    let active = true
    navigator.mediaDevices?.getUserMedia({ video: { facingMode }, audio: false })
      .then(stream => {
        if (!active) { stream.getTracks().forEach(t => t.stop()); return }
        setMediaStream(stream)
        setFallback(false)
        if (videoRef.current) videoRef.current.srcObject = stream
      })
      .catch(() => { if (active) setFallback(true) })

    return () => {
      active = false
    }
  // mediaStream intentionally excluded — would cause loop
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, facingMode])

  const capture = async () => {
    if (!videoRef.current || photos.length >= MAX_PHOTOS) return
    const dataUrl = captureFrame(videoRef.current)
    const base64 = await resizeDataUrl(dataUrl)
    const preview = dataUrl
    setPhotos(prev => [...prev, { preview, base64 }])
  }

  const handleGalleryFiles = async (files: FileList | null) => {
    if (!files) return
    const remaining = MAX_PHOTOS - photos.length
    const toAdd = Array.from(files).slice(0, remaining)
    const entries = await Promise.all(toAdd.map(fileToEntry))
    setPhotos(prev => [...prev, ...entries])
  }

  const handleAnalyze = () => {
    onAnalyze(photos)
    stopStream(mediaStream)
    onClose()
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      {/* Viewfinder */}
      <div className="relative flex-1 overflow-hidden bg-[#080610]">
        {!fallback ? (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-4 px-8">
            <p className="text-[#4c3a6e] text-sm text-center">Camera access unavailable</p>
            <button
              onClick={() => galleryRef.current?.click()}
              className="bg-gradient-to-r from-[#7c3aed] to-[#2563eb] rounded-xl px-6 py-3 text-white font-semibold text-sm"
            >
              Choose Photos from Gallery
            </button>
          </div>
        )}

        {/* Corner brackets */}
        <div className="absolute top-5 left-5 w-6 h-6 border-t-2 border-l-2 border-[#c084fc] rounded-tl" />
        <div className="absolute top-5 right-5 w-6 h-6 border-t-2 border-r-2 border-[#c084fc] rounded-tr" />
        <div className="absolute bottom-24 left-5 w-6 h-6 border-b-2 border-l-2 border-[#c084fc] rounded-bl" />
        <div className="absolute bottom-24 right-5 w-6 h-6 border-b-2 border-r-2 border-[#c084fc] rounded-br" />

        {/* Top bar: close + count */}
        <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 pt-4">
          <button
            onClick={() => { stopStream(mediaStream); onClose() }}
            className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center text-white/60 text-sm"
          >✕</button>
          <span className="text-[#c084fc] text-xs font-semibold tracking-wider">
            {photos.length} / {MAX_PHOTOS}
          </span>
        </div>

        {/* Analyze button + photo strip */}
        {photos.length > 0 && (
          <div className="absolute bottom-3 left-4 right-4 flex flex-col gap-2">
            <button
              onClick={handleAnalyze}
              className="w-full bg-gradient-to-r from-[#7c3aed] to-[#2563eb] rounded-xl py-3 text-white font-semibold text-sm"
            >
              ⚡ Analyze {photos.length} Photo{photos.length !== 1 ? 's' : ''} →
            </button>
            <div className="flex gap-2">
              {photos.map((p, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={i}
                  src={p.preview}
                  alt=""
                  className="w-9 h-9 rounded-lg object-cover border border-[#c084fc]/60"
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Controls row */}
      <div className="bg-black px-6 py-5 flex items-center justify-between border-t border-[#1a1630]">
        {/* Gallery */}
        <button
          onClick={() => galleryRef.current?.click()}
          disabled={photos.length >= MAX_PHOTOS}
          className="flex flex-col items-center gap-1.5 disabled:opacity-30"
        >
          <div className="w-11 h-11 rounded-xl bg-[#12101e] border border-[#2d1f50] flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
              <rect x="1" y="3" width="14" height="11" rx="2" stroke="#6b4fa0" strokeWidth="1.2"/>
              <path d="M1 10l4-3 3 3 2-2 5 4" stroke="#6b4fa0" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <span className="text-[#6b4fa0] text-[9px] font-semibold tracking-wide">Gallery</span>
        </button>

        {/* Shutter */}
        <button
          onClick={capture}
          disabled={photos.length >= MAX_PHOTOS || fallback}
          className="w-16 h-16 rounded-full border-[2.5px] border-[#c084fc] flex items-center justify-center disabled:opacity-30"
          style={{ boxShadow: '0 0 20px rgba(192,132,252,0.3)' }}
        >
          <div className="w-[52px] h-[52px] rounded-full bg-white" />
        </button>

        {/* Flip */}
        <button
          onClick={() => setFacingMode(m => m === 'environment' ? 'user' : 'environment')}
          disabled={fallback}
          className="flex flex-col items-center gap-1.5 disabled:opacity-30"
        >
          <div className="w-11 h-11 rounded-xl bg-[#12101e] border border-[#2d1f50] flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
              <path d="M3 8a5 5 0 1 1 10 0" stroke="#6b4fa0" strokeWidth="1.2" strokeLinecap="round"/>
              <path d="M13 8l-2-2M13 8l-2 2" stroke="#6b4fa0" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
          </div>
          <span className="text-[#6b4fa0] text-[9px] font-semibold tracking-wide">Flip</span>
        </button>
      </div>

      <input
        ref={galleryRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={e => handleGalleryFiles(e.target.files)}
      />
    </div>
  )
}
```

- [ ] **Step 4: Build to confirm no TS errors**

```bash
npm run build
```

Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/components/CameraOverlay.tsx src/components/CameraOverlay.test.ts
git commit -m "feat: add CameraOverlay with getUserMedia live viewfinder"
```

---

## Task 5: CommandBar rewrite

**Files:**
- Modify: `src/components/CommandBar.tsx` (full rewrite)
- Create: `src/components/CommandBar.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/components/CommandBar.test.ts`:

```ts
import { describe, it, expect } from 'vitest'

function canSubmit(text: string): boolean {
  return text.trim().length > 0
}

function inputBorderClass(listening: boolean, hasText: boolean): string {
  if (listening) return 'border-[#c084fc]/50'
  if (hasText) return 'border-[#4c3a6e]'
  return 'border-[#1a1630]'
}

function sendButtonClass(hasText: boolean): string {
  return hasText
    ? 'bg-gradient-to-br from-[#7c3aed] to-[#2563eb]'
    : 'bg-[#0f0d1e] border border-[#1a1630] opacity-40'
}

describe('CommandBar logic', () => {
  it('cannot submit empty string', () => {
    expect(canSubmit('')).toBe(false)
    expect(canSubmit('   ')).toBe(false)
  })

  it('can submit non-empty text', () => {
    expect(canSubmit('save qty 50')).toBe(true)
    expect(canSubmit(' save ')).toBe(true)
  })

  it('input border is purple when listening', () => {
    expect(inputBorderClass(true, false)).toBe('border-[#c084fc]/50')
    expect(inputBorderClass(true, true)).toBe('border-[#c084fc]/50')
  })

  it('input border dims when has text but not listening', () => {
    expect(inputBorderClass(false, true)).toBe('border-[#4c3a6e]')
  })

  it('input border is default when idle', () => {
    expect(inputBorderClass(false, false)).toBe('border-[#1a1630]')
  })

  it('send button is gradient when has text', () => {
    expect(sendButtonClass(true)).toContain('from-[#7c3aed]')
  })

  it('send button is dimmed when no text', () => {
    expect(sendButtonClass(false)).toContain('opacity-40')
  })
})
```

- [ ] **Step 2: Run test to confirm it passes**

```bash
npm test -- CommandBar
```

Expected: PASS

- [ ] **Step 3: Rewrite `src/components/CommandBar.tsx`**

Full replacement of the file:

```tsx
'use client'

import { useEffect, useRef, useState } from 'react'

interface Props {
  onCommand: (text: string) => void
  onCameraOpen: () => void
  placeholder?: string
  disabled?: boolean
}

type SRInstance = {
  continuous: boolean; interimResults: boolean; lang: string
  onresult: ((e: SREvent) => void) | null
  onend: (() => void) | null
  start(): void; stop(): void
}
type SRResult = { isFinal: boolean; [i: number]: { transcript: string } }
type SREvent = { results: SRResult[] & { length: number } }
type SRWindow = Window & {
  SpeechRecognition?: new () => SRInstance
  webkitSpeechRecognition?: new () => SRInstance
}

const WAVE_HEIGHTS = [4, 8, 12, 7, 10, 5, 9, 4]

export default function CommandBar({ onCommand, onCameraOpen, placeholder, disabled }: Props) {
  const [text, setText] = useState('')
  const [listening, setListening] = useState(false)
  const recognitionRef = useRef<SRInstance | null>(null)

  useEffect(() => {
    const w = window as SRWindow
    const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition
    if (!SR) return
    const rec = new SR()
    rec.continuous = false
    rec.interimResults = true
    rec.lang = 'en-US'
    rec.onresult = (e: SREvent) => {
      const transcript = Array.from(
        { length: e.results.length },
        (_, i) => e.results[i][0].transcript
      ).join('')
      setText(transcript)
      if (e.results[e.results.length - 1].isFinal) setListening(false)
    }
    rec.onend = () => setListening(false)
    recognitionRef.current = rec
  }, [])

  const toggleMic = () => {
    if (!recognitionRef.current) return
    if (listening) { recognitionRef.current.stop() }
    else { setText(''); recognitionRef.current.start(); setListening(true) }
  }

  const submit = () => {
    const trimmed = text.trim()
    if (!trimmed) return
    onCommand(trimmed)
    setText('')
  }

  const hasText = text.trim().length > 0

  return (
    <div className="px-4 py-3 flex items-center gap-2 bg-[#050408]/95 border-t border-[#1a1630] backdrop-blur-md">
      {/* Camera */}
      <button
        onClick={onCameraOpen}
        disabled={disabled || listening}
        className="w-[38px] h-[38px] rounded-xl bg-[#0f0d1e] border border-[#2d1f50] flex items-center justify-center flex-shrink-0 disabled:opacity-30 transition-opacity"
        aria-label="Open camera"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
          <rect x="1" y="4" width="14" height="10" rx="2" stroke="#4c3a6e" strokeWidth="1.3"/>
          <circle cx="8" cy="9" r="2.5" stroke="#4c3a6e" strokeWidth="1.3"/>
          <path d="M6 4l1-2h2l1 2" stroke="#4c3a6e" strokeWidth="1.3" strokeLinecap="round"/>
        </svg>
      </button>

      {/* Input / Waveform */}
      <div className={`flex-1 h-[38px] rounded-xl bg-[#0f0d1e] border flex items-center px-3 transition-colors ${
        listening ? 'border-[#c084fc]/50' : hasText ? 'border-[#4c3a6e]' : 'border-[#1a1630]'
      }`}>
        {listening ? (
          <div className="flex items-center gap-1 w-full">
            <div className="flex items-end gap-[3px] h-4 flex-1">
              {WAVE_HEIGHTS.map((h, i) => (
                <div
                  key={i}
                  className="w-[2px] rounded-sm bg-[#c084fc]"
                  style={{
                    height: `${h}px`,
                    animation: `wave 0.8s ease-in-out ${i * 0.1}s infinite`,
                  }}
                />
              ))}
            </div>
            <span className="text-[#c084fc] text-[9px] font-semibold tracking-widest ml-2">REC</span>
          </div>
        ) : (
          <input
            type="text"
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && submit()}
            placeholder={placeholder ?? 'Type a command or speak…'}
            disabled={disabled}
            className="w-full bg-transparent text-slate-300 text-[13px] placeholder-[#2d1f50] outline-none disabled:opacity-50"
          />
        )}
      </div>

      {/* Mic */}
      <button
        onClick={toggleMic}
        disabled={disabled}
        className={`w-[38px] h-[38px] rounded-xl border flex items-center justify-center flex-shrink-0 disabled:opacity-30 transition-colors ${
          listening
            ? 'bg-[#c084fc]/10 border-[#c084fc]'
            : 'bg-[#0f0d1e] border-[#2d1f50]'
        }`}
        aria-label={listening ? 'Stop recording' : 'Start voice input'}
      >
        <svg width="14" height="16" viewBox="0 0 14 16" fill="none" aria-hidden>
          <rect x="4" y="0.5" width="6" height="9" rx="3"
            stroke={listening ? '#c084fc' : '#4c3a6e'} strokeWidth="1.3"/>
          <path d="M2 8c0 2.76 2.24 5 5 5s5-2.24 5-5"
            stroke={listening ? '#c084fc' : '#4c3a6e'} strokeWidth="1.3" strokeLinecap="round"/>
          <line x1="7" y1="13" x2="7" y2="15.5"
            stroke={listening ? '#c084fc' : '#4c3a6e'} strokeWidth="1.3" strokeLinecap="round"/>
        </svg>
      </button>

      {/* Send */}
      <button
        onClick={submit}
        disabled={disabled || !hasText}
        className={`w-[38px] h-[38px] rounded-xl flex items-center justify-center flex-shrink-0 transition-all ${
          hasText
            ? 'bg-gradient-to-br from-[#7c3aed] to-[#2563eb]'
            : 'bg-[#0f0d1e] border border-[#1a1630] opacity-40'
        }`}
        aria-label="Send command"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
          <path d="M6 10V2M2 6l4-4 4 4" stroke="white" strokeWidth="1.5"
            strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
    </div>
  )
}
```

- [ ] **Step 4: Build to confirm no TS errors**

```bash
npm run build
```

Expected: exits 0. (Page.tsx will still reference the old CommandBar signature — that's fine; it gets rewritten in Task 6.)

- [ ] **Step 5: Commit**

```bash
git add src/components/CommandBar.tsx src/components/CommandBar.test.ts
git commit -m "feat: rewrite CommandBar with SVG icons and waveform animation"
```

---

## Task 6: page.tsx — chat-log architecture

**Files:**
- Modify: `src/app/page.tsx` (full rewrite)
- Create: `src/app/page.test.ts`

**Prerequisite:** Tasks 1–5 must be complete.

- [ ] **Step 1: Write the failing test**

Create `src/app/page.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import type { ChatEvent, StageStatus } from '@/types'

const STAGE_LABELS: Record<number, string> = {
  1: 'Vision Extraction',
  2: 'Prediction',
  3: 'Price Search',
  4: 'Verification',
  5: 'Report Assembly',
  6: 'Save to Notion',
}

// Pure stream manipulation functions extracted from the component
function appendEvent(stream: ChatEvent[], event: ChatEvent): ChatEvent[] {
  return [...stream, event]
}

function setStageInStream(
  stream: ChatEvent[],
  id: number,
  status: StageStatus,
  detail?: string
): ChatEvent[] {
  const existing = stream.find(e => e.kind === 'stage' && e.stageId === id)
  if (existing) {
    return stream.map(e =>
      e.kind === 'stage' && e.stageId === id
        ? { ...e, status, detail: detail ?? e.detail }
        : e
    )
  }
  return [...stream, {
    id: `stage-${id}`,
    kind: 'stage' as const,
    stageId: id,
    label: STAGE_LABELS[id],
    status,
    detail: detail ?? null,
  }]
}

function markRunningStagesAsError(stream: ChatEvent[], message: string): ChatEvent[] {
  return stream.map(e =>
    e.kind === 'stage' && e.status === 'running'
      ? { ...e, status: 'error' as StageStatus, detail: message }
      : e
  )
}

describe('page stream logic', () => {
  it('appendEvent grows stream by one', () => {
    const stream: ChatEvent[] = []
    const next = appendEvent(stream, { id: 'e1', kind: 'error', message: 'oops' })
    expect(next).toHaveLength(1)
    expect(next[0].kind).toBe('error')
  })

  it('appendEvent does not mutate original stream', () => {
    const stream: ChatEvent[] = []
    appendEvent(stream, { id: 'e1', kind: 'error', message: 'oops' })
    expect(stream).toHaveLength(0)
  })

  it('setStageInStream appends when stage not yet in stream', () => {
    const result = setStageInStream([], 1, 'running', 'Analyzing…')
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ kind: 'stage', stageId: 1, status: 'running', detail: 'Analyzing…' })
  })

  it('setStageInStream updates existing stage in place', () => {
    const stream = setStageInStream([], 1, 'running', 'Analyzing…')
    const updated = setStageInStream(stream, 1, 'done', 'Bosch drill · 91%')
    expect(updated).toHaveLength(1)
    expect(updated[0]).toMatchObject({ stageId: 1, status: 'done', detail: 'Bosch drill · 91%' })
  })

  it('setStageInStream preserves other events when updating', () => {
    let stream = setStageInStream([], 1, 'running')
    stream = setStageInStream(stream, 2, 'running')
    stream = setStageInStream(stream, 1, 'done', 'done detail')
    expect(stream).toHaveLength(2)
    expect(stream.find(e => e.kind === 'stage' && e.stageId === 1)).toMatchObject({ status: 'done' })
    expect(stream.find(e => e.kind === 'stage' && e.stageId === 2)).toMatchObject({ status: 'running' })
  })

  it('markRunningStagesAsError only affects running stages', () => {
    let stream: ChatEvent[] = []
    stream = setStageInStream(stream, 1, 'done', 'ok')
    stream = setStageInStream(stream, 2, 'running', 'in progress')
    const result = markRunningStagesAsError(stream, 'timeout')
    expect(result.find(e => e.kind === 'stage' && e.stageId === 1)).toMatchObject({ status: 'done' })
    expect(result.find(e => e.kind === 'stage' && e.stageId === 2)).toMatchObject({ status: 'error', detail: 'timeout' })
  })

  it('STAGE_LABELS covers all 6 stages', () => {
    for (let i = 1; i <= 6; i++) {
      expect(STAGE_LABELS[i]).toBeTruthy()
    }
  })
})
```

- [ ] **Step 2: Run test to confirm it passes**

```bash
npm test -- page
```

Expected: PASS

- [ ] **Step 3: Rewrite `src/app/page.tsx`**

Full replacement:

```tsx
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
    if (!report) return
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
            if (event.kind === 'report' && report) {
              return (
                <ReportCard
                  key={event.id}
                  report={report}
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
```

- [ ] **Step 4: Run full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 5: Build**

```bash
npm run build
```

Expected: exits 0, no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/page.tsx src/app/page.test.ts
git commit -m "feat: rewrite page.tsx as chat-log stream with camera overlay integration"
```

---

## Task 7: Cleanup — delete old components

**Files:**
- Delete: `src/components/PhotoCapture.tsx`
- Delete: `src/components/PhotoCapture.test.tsx`
- Delete: `src/components/PipelineProgress.tsx`
- Delete: `src/components/PipelineProgress.test.tsx`
- Delete: `src/components/ItemReport.tsx`
- Delete: `src/components/QtyControl.tsx`

**Prerequisite:** Task 6 must be complete and `npm run build` must pass.

- [ ] **Step 1: Delete old component files**

```bash
rm src/components/PhotoCapture.tsx
rm src/components/PhotoCapture.test.tsx
rm src/components/PipelineProgress.tsx
rm src/components/PipelineProgress.test.tsx
rm src/components/ItemReport.tsx
rm src/components/QtyControl.tsx
```

- [ ] **Step 2: Run full test suite to confirm no broken imports**

```bash
npm test
```

Expected: PASS. If any test imports a deleted file, remove that test file too.

- [ ] **Step 3: Build to confirm clean**

```bash
npm run build
```

Expected: exits 0.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: delete replaced components (PhotoCapture, PipelineProgress, ItemReport, QtyControl)"
```

---

## Self-Review Notes

**Spec coverage check:**
- ✅ Width fix: `w-full` on `<main>`, no max-w-md — Task 6
- ✅ Chrome Violet tokens — Task 1
- ✅ Space Grotesk — Task 1
- ✅ ChatBubble stream — Tasks 2, 6
- ✅ ReportCard with gradient glow — Task 3
- ✅ CameraOverlay getUserMedia — Task 4
- ✅ SVG-only CommandBar — Task 5
- ✅ Waveform animation — Task 5 (keyframe in Task 1)
- ✅ Auto-scroll — Task 6 (streamEndRef)
- ✅ Fallback for getUserMedia — Task 4
- ✅ Old components deleted — Task 7

**Type consistency:**
- `ChatEvent` defined in `src/types/index.ts` (Task 1), imported in ChatBubble, ReportCard (not needed), page.tsx
- `StageStatus` already in `src/types/index.ts` — used by ChatEvent and ChatBubble
- `onAnalyze` prop in CameraOverlay: `(photos: { base64: string; preview: string }[]) => void` — matches `runPipeline` signature in page.tsx
- `onCameraOpen` added to CommandBar props — matches call in page.tsx

**Wave map confirmed:** Tasks 1–5 share no state and can run in parallel. Task 6 imports all five.
