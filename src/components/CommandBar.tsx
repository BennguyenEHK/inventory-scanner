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
