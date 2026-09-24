import { useEffect, useRef, useState } from 'react'
import { Delete } from 'lucide-react'
import type { PinMode } from '../../lib/vault'

/** 6-digit keypad (touch + physical keyboard) or a passcode field. */
export function PinEntry({ mode, onSubmit, busy, error, label, autoFocus = true }: {
  mode: PinMode
  onSubmit: (pin: string) => void
  busy?: boolean
  error?: boolean
  label: string
  autoFocus?: boolean
}) {
  const [pin, setPin] = useState('')
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (error) setPin('')
  }, [error])

  useEffect(() => {
    if (mode !== 'pin6' || busy) return
    // Physical keyboard while a keypad button (not an input) has focus; a focused input handles its own typing.
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (/^\d$/.test(e.key)) setPin((p) => (p.length < 6 ? p + e.key : p))
      else if (e.key === 'Backspace') setPin((p) => p.slice(0, -1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode, busy])

  // Desktop: focus the hidden field so typing works immediately. Touch: keep the on-screen keypad visible.
  useEffect(() => {
    if (mode === 'pin6' && autoFocus && window.matchMedia('(pointer: fine)').matches) ref.current?.focus()
  }, [mode, autoFocus, busy])

  useEffect(() => {
    if (mode === 'pin6' && pin.length === 6) {
      onSubmit(pin)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin, mode])

  if (mode === 'passcode') {
    return (
      <form
        className="col"
        style={{ gap: 12 }}
        onSubmit={(e) => {
          e.preventDefault()
          if (pin.length >= 8) onSubmit(pin)
        }}
      >
        <label className="field-label" htmlFor="passcode">{label}</label>
        <input
          ref={ref}
          id="passcode"
          className="input"
          type="password"
          autoComplete="current-password"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          autoFocus={autoFocus}
          aria-invalid={error}
          disabled={busy}
          style={{ minHeight: 48, fontSize: '1.05rem' }}
        />
        <button className="btn btn-primary btn-lg" disabled={busy || pin.length < 8}>
          {busy ? <span className="spinner" /> : 'Unlock'}
        </button>
      </form>
    )
  }

  const press = (d: string) => !busy && setPin((p) => (p.length < 6 ? p + d : p))
  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="sr-only" aria-live="polite">{label}. {pin.length} of 6 digits entered.</div>
      <div className={`pin-dots${error ? ' error' : ''}`} aria-hidden>
        {Array.from({ length: 6 }, (_, i) => <span key={i} className={i < pin.length ? 'on' : ''} />)}
      </div>
      {/* hidden input so mobile users can also type with the numeric keyboard */}
      <input
        ref={ref}
        className="sr-only"
        inputMode="numeric"
        autoComplete="one-time-code"
        aria-label={label}
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
      />
      <div className="keypad" aria-label="Keypad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button key={d} type="button" onClick={() => press(d)} disabled={busy}>{d}</button>
        ))}
        <button type="button" className="ghost" onClick={() => setPin('')} disabled={busy}>Clear</button>
        <button type="button" onClick={() => press('0')} disabled={busy}>0</button>
        <button type="button" className="ghost" onClick={() => setPin((p) => p.slice(0, -1))} aria-label="Delete digit" disabled={busy}>
          {busy ? <span className="spinner" style={{ margin: 'auto' }} /> : <Delete />}
        </button>
      </div>
    </div>
  )
}
