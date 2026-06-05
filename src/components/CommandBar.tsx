'use client'

import { useEffect, useRef, useState } from 'react'

interface Props {
  onCommand: (text: string) => void
  placeholder?: string
  disabled?: boolean
}

// Self-contained types — SpeechRecognition is browser-only and inconsistently typed
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

export default function CommandBar({ onCommand, placeholder, disabled }: Props) {
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
      const transcript = Array.from({ length: e.results.length }, (_, i) => e.results[i][0].transcript).join('')
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

  return (
    <div className={`bg-[#111827] rounded-xl px-3 py-2 flex gap-2 items-center border ${listening ? 'border-sky-500' : 'border-slate-800'}`}>
      <input
        type="text"
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && submit()}
        placeholder={placeholder ?? 'Type a command or speak…'}
        disabled={disabled}
        className="flex-1 bg-transparent text-slate-300 text-[11px] placeholder-slate-600 outline-none disabled:opacity-50"
      />
      <button
        onClick={toggleMic}
        disabled={disabled}
        className={`text-base disabled:opacity-40 transition-colors ${listening ? 'text-sky-400 animate-pulse' : 'text-slate-500'}`}
      >🎤</button>
      <button
        onClick={submit}
        disabled={disabled || !text.trim()}
        className="bg-sky-600 disabled:opacity-40 rounded-lg w-7 h-7 flex items-center justify-center text-white text-xs font-bold"
      >↑</button>
    </div>
  )
}
