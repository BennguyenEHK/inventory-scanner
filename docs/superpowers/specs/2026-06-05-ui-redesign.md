# UI Redesign — InvScan
**Date:** 2026-06-05  
**Status:** Approved  
**Scope:** Full UI overhaul — layout, colors, typography, camera UX, command bar

---

## 1. Problem Statement

The current UI has three concrete issues:
1. **Width bug** — `max-w-md mx-auto` on the main container leaves blank margins on full-width phones.
2. **Camera lag** — `<input capture="environment">` delegates to the OS camera app, causing a slow app-switch round-trip.
3. **Design quality** — layout is too basic; emoji icons on command bar feel unprofessional; fonts and colors lack identity.

---

## 2. Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Layout pattern | Chat-log + full-screen camera overlay | Main screen is a scrollable event stream; camera is a focused full-screen overlay |
| Palette | Chrome Violet | Purple→cyan gradient on ultra-dark background; green for confirmed, orange for in-progress |
| Typography | Space Grotesk | Geometric, sharp, high-tech without being theatrical; readable at all mobile sizes |
| Camera UX | `getUserMedia()` live viewfinder | Eliminates OS app-switch lag; canvas capture for instant photo feedback |
| Icons | SVG only | No emoji anywhere; mic shows waveform animation during recording |

---

## 3. Color Tokens

```css
--bg:        #050408   /* near-pitch-black */
--surface:   #0f0d1e   /* card / bubble backgrounds */
--surface2:  #12101e   /* input fields, nested surfaces */
--border:    #1a1630   /* default borders */
--border2:   #2d1f50   /* interactive/focused borders */

--grad-start: #c084fc  /* purple — gradient left */
--grad-end:   #38bdf8  /* cyan — gradient right */

--confirmed:  #34d399  /* pipeline done, verified badge */
--running:    #fb923c  /* in-progress stage */
--data:       #38bdf8  /* prices, counts, data values */
--muted:      #4c3a6e  /* dimmed labels, skipped stages */
--text:       #e2e8f0  /* primary body text */
--text-dim:   #64748b  /* secondary text */
```

---

## 4. Typography

**Font:** Space Grotesk (Google Fonts — weights 400, 500, 600, 700)  
**Load in:** `layout.tsx` via `next/font/google`  
**Replace:** existing Geist Sans (keep Geist Mono for code/IDs only if needed)

| Usage | Weight | Size |
|---|---|---|
| App name wordmark | 700 | 15px |
| Report item name | 700 | 14px |
| Report price | 700 | 26px |
| Chat bubble text | 400 | 12px |
| Labels / badges | 600 | 9–10px, letter-spacing 1px |
| Input placeholder | 400 | 13px |

---

## 5. Layout — Main Page (`page.tsx`)

### 5.1 Container
- `w-full` — no max-width constraint
- `pb-[72px]` — bottom padding clears the fixed command bar
- `min-h-screen bg-[--bg]`

### 5.2 App Header (fixed top)
```
[ • InvScan ]                    [ ● ANALYZING | ✓ Done | History ]
```
- Fixed top, `z-30`, full width
- Gradient dot pulse indicator (color shifts: purple=idle, orange=running, green=done)
- "InvScan" wordmark: Space Grotesk 700, purple→cyan gradient text
- Right: contextual status badge OR "History" pill link

### 5.3 Chat Stream
- Scrollable area from below header to above command bar
- `flex flex-col gap-3 px-4 pt-3`
- New events **append to bottom** — stream stays at the latest event
- Auto-scroll to bottom when new bubbles appear (`useEffect` on stream length)

### 5.4 Bubble Types

**Photo confirmation bubble** — appears immediately when user triggers scan:
```
[ 📸 📸 📸 ]   ← thumbnail strip (30×30px rounded squares)
  3 photos captured
```
- Background: `--surface`, border-radius `4px 12px 12px 4px` (left-anchored)
- Thumbnails: actual image previews from canvas capture

**Pipeline stage bubble** — one per stage as it transitions to running/done/error:
```
✓  Vision — Bosch GWS 18V-10 · 91% conf
⟳  Searching 8 sources…              ← animated spinner char
–  Prediction skipped (high conf)    ← dimmed
✕  Search failed: timeout            ← red
```
- Color per status: `--confirmed` / `--running` / `--muted` / `danger`
- Text size: 12px, weight 500

**Report card** — appears when pipeline completes, stays pinned in stream:
- See Section 7 below.

**Error/clarification bubble** — amber background, full-width:
```
⚠ Image unclear — please retake from a different angle
```

**Save confirmation bubble** — appears after successful Notion save:
```
✓ Saved to Notion — qty 50  [Scan Another →]
```

---

## 6. Camera Overlay

The camera is a **full-screen overlay** triggered by the camera icon in the command bar.

### 6.1 Trigger
- Camera icon button in command bar → sets `cameraOpen = true`
- Overlay mounts over the entire page (`fixed inset-0 z-50`)

### 6.2 Viewfinder
- `getUserMedia({ video: { facingMode: 'environment' }, audio: false })` on mount
- Stream renders into a `<video>` element (`object-fit: cover`, full overlay height minus controls)
- On unmount: stop all tracks
- **Fallback:** if `getUserMedia` throws or is not supported → fall back to `<input type="file" capture="environment">`

### 6.3 Corner Bracket UI
- Four absolute-positioned corner brackets (2px solid `--grad-start`) — 24×24px each
- Crosshair at center: 1px lines, `--grad-start` at 40% opacity
- Top bar: `✕` close button (left) + `N / 3` photo count (right)

### 6.4 Photo Strip
- Thumbnails of captured shots sit just above the shutter controls
- Each thumb: 28×28px, border `1px solid --grad-start at 60%`, rounded-md
- Empty slots: dashed border, `+` icon

### 6.5 Controls Row
```
[ Gallery ]    (●)    [ Flip ]
```
- **Gallery:** SVG image icon + "Gallery" label — opens `<input type="file" multiple>` for existing photos
- **Shutter:** 56px circle, `2.5px solid --grad-start` border, box-shadow glow, white inner disk — tap captures canvas snapshot from video feed
- **Flip:** SVG rotate icon + "Flip" label — toggles `facingMode` between `'environment'` and `'user'`

### 6.6 Analyze Button
- Appears above controls when `photos.length > 0`
- Full-width pill: gradient bg `--grad-start → --grad-end`, `⚡ Analyze N Photos →`
- Tapping: closes overlay, fires `runPipeline()`

### 6.7 Canvas Capture
```ts
function captureFrame(videoEl: HTMLVideoElement): string {
  const canvas = document.createElement('canvas')
  canvas.width = videoEl.videoWidth
  canvas.height = videoEl.videoHeight
  canvas.getContext('2d')!.drawImage(videoEl, 0, 0)
  return canvas.toDataURL('image/jpeg', 0.85).split(',')[1]
}
```
- Same 1024px resize logic as existing `fileToBase64`

---

## 7. Report Card

The report card docks into the chat stream as the final bubble. It replaces the separate `ItemReport` + `QtyControl` components in the chat context.

```
┌─────────────────────────────────────┐  ← top gradient line (purple→cyan)
│ ✓ VERIFIED                          │
│ Bosch GWS 18V-10 Angle Grinder      │  ← Space Grotesk 700, 14px
│ $289  avg · 8 sources               │  ← 26px gradient text
│ [ 🖼 ] [ 🖼 ] [ 🖼 ]                │  ← verification image strip (tap to enlarge)
│ Mfr: Bosch    Origin: Germany       │
│ Unit: Each    Currency: USD         │
│ [ − ]  1  [ + ]   [ Save to Notion →] │
└─────────────────────────────────────┘
```

- Border: `1px solid rgba(168,85,247,0.25)`, `border-radius: 14px`
- Top inset line: `::before` pseudo, `background: linear-gradient(90deg, transparent, #c084fc, #38bdf8, transparent)`
- Price text: gradient clip same as wordmark
- Verified badge: `#34d399` text on `#34d39915` bg
- Warning flags appear below fields in amber
- Qty stepper: `−` / `+` are `28px` square buttons, `--surface2` bg, `--grad-start` color
- Save button: gradient bg, full remaining width, Space Grotesk 600

---

## 8. Command Bar

Fixed bottom, `z-40`, full device width. Height: `64px` visible + safe-area padding.

```
[ 📷 ] [ ─────────── type or speak… ─────────── ] [ 🖼 ] [ 🎤 ] [ ↑ ]
```

All icons are inline SVG (12×12px viewBox 16×16).

### States

**Idle:**  
- Camera icon: `--muted` stroke  
- Input: `--surface` bg, `--border` border, placeholder `--muted`  
- Gallery icon: `--muted` stroke  
- Mic icon: `--muted` stroke  
- Send: `--surface2` bg, up-arrow `--border2` color (dimmed)

**Typing (text.length > 0):**  
- Input border shifts to `--border2`  
- Send button: gradient bg (`--grad-start → --grad-end`), white arrow

**Recording (listening = true):**  
- Input area replaced by waveform animation: 8 vertical bars, height animated staggered, `--grad-start` color, `REC` label  
- Mic icon: `--grad-start` glow border  
- Camera + send dimmed to 30% opacity

### Background
- `--bg / 0.95` with `backdrop-blur-md`
- Border-top: `1px solid --border`

---

## 9. Files to Create / Modify

| File | Action | Notes |
|---|---|---|
| `src/app/layout.tsx` | Modify | Add Space Grotesk via `next/font/google`; remove Geist Sans |
| `src/app/globals.css` | Modify | Replace color tokens with Chrome Violet palette |
| `src/app/page.tsx` | Rewrite | Chat-log architecture, stream state, auto-scroll |
| `src/components/CameraOverlay.tsx` | Create | Full-screen overlay, getUserMedia, canvas capture |
| `src/components/CommandBar.tsx` | Rewrite | SVG icons, 3 states, waveform animation |
| `src/components/ChatBubble.tsx` | Create | Reusable bubble: system / photo / error / save-confirm |
| `src/components/ReportCard.tsx` | Create | Report + qty control merged, gradient glow card |
| `src/components/PhotoCapture.tsx` | Delete | Replaced by CameraOverlay |
| `src/components/PhotoCapture.test.tsx` | Delete | Component removed |
| `src/components/PipelineProgress.tsx` | Delete | Replaced by ChatBubble stream in page.tsx |
| `src/components/PipelineProgress.test.tsx` | Delete | Component removed |
| `src/components/ItemReport.tsx` | Delete | Replaced by ReportCard |
| `src/components/QtyControl.tsx` | Delete | Merged into ReportCard |

---

## 10. State Model

`page.tsx` manages a `ChatEvent[]` stream alongside the existing `AppState`:

```ts
type ChatEventKind =
  | 'photos'          // { photos: string[] (preview URLs) }
  | 'stage'           // { stageId: number; label: string; status; detail }
  | 'report'          // { report: FinalReport }
  | 'error'           // { message: string }
  | 'clarification'   // { message: string }
  | 'saved'           // { qty: number }

type ChatEvent = { id: string; kind: ChatEventKind; payload: unknown }
```

When a pipeline stage updates, the existing event for that stage is updated in place (by id), not appended again.

---

## 11. What Is NOT Changing

- All API routes (`/api/vision`, `/api/predict`, `/api/search`, `/api/verify`, `/api/report`, `/api/notion`, `/api/command`) — untouched
- All TypeScript types in `src/types/`
- `src/app/inventory/page.tsx` — out of scope for this redesign
- Pipeline logic in `page.tsx` — same `runPipeline` / `handleSave` / `handleCommand` flow, just adapted to push events to stream instead of updating stage array

---

## 12. Acceptance Criteria

- [ ] Page fills full phone width on Samsung Galaxy S-series and iPhone viewports
- [ ] Camera opens as full-screen overlay with live viewfinder (no OS app switch)
- [ ] Each pipeline stage streams in as a chat bubble in real-time
- [ ] Report card appears with gradient glow border when pipeline completes
- [ ] Command bar shows waveform animation during voice recording
- [ ] No emoji in icons — all SVG
- [ ] Space Grotesk renders as the only body font
- [ ] Chrome Violet palette applied throughout
