import { create } from 'zustand'
import { useEffect, useState, type ReactNode } from 'react'
import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react'
import { Modal } from './primitives'

type Tone = 'ok' | 'info' | 'warn' | 'alert'
interface Toast { id: number; tone: Tone; text: ReactNode }

const useToasts = create<{ items: Toast[] }>(() => ({ items: [] }))
let seq = 0

export function toast(text: ReactNode, tone: Tone = 'ok', ms = 4200) {
  const id = ++seq
  useToasts.setState((s) => ({ items: [...s.items, { id, tone, text }].slice(-4) }))
  setTimeout(() => useToasts.setState((s) => ({ items: s.items.filter((t) => t.id !== id) })), ms)
}

const TONE: Record<Tone, { cls: string; I: typeof Info }> = {
  ok: { cls: 'tone-qc2', I: CircleCheck },
  info: { cls: 'tone-accent', I: Info },
  warn: { cls: 'tone-warn', I: TriangleAlert },
  alert: { cls: 'tone-alert', I: CircleAlert },
}

export function Toaster() {
  const items = useToasts((s) => s.items)
  return (
    <div className="toasts" aria-live="polite" aria-atomic="false">
      {items.map((t) => {
        const { cls, I } = TONE[t.tone]
        return (
          <div key={t.id} className={`toast ${cls}`} role={t.tone === 'alert' ? 'alert' : 'status'}>
            <I aria-hidden />
            <div>{t.text}</div>
          </div>
        )
      })}
    </div>
  )
}

// ---- promise-based confirm dialog ---------------------------------------------------------------
interface ConfirmReq {
  title: string
  body?: ReactNode
  confirm?: string
  danger?: boolean
  typeToConfirm?: string
  resolve: (ok: boolean) => void
}
const useConfirm = create<{ req?: ConfirmReq }>(() => ({}))

export function confirmDialog(opts: Omit<ConfirmReq, 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => useConfirm.setState({ req: { ...opts, resolve } }))
}

export function ConfirmHost() {
  const req = useConfirm((s) => s.req)
  const [typed, setTyped] = useState('')
  useEffect(() => setTyped(''), [req])
  if (!req) return null
  const done = (ok: boolean) => {
    req.resolve(ok)
    useConfirm.setState({ req: undefined })
  }
  const blocked = !!req.typeToConfirm && typed.trim().toUpperCase() !== req.typeToConfirm.toUpperCase()
  return (
    <Modal
      open
      onClose={() => done(false)}
      title={req.title}
      footer={
        <>
          <button className="btn" onClick={() => done(false)}>Cancel</button>
          <button className={req.danger ? 'btn btn-danger' : 'btn btn-primary'} disabled={blocked} onClick={() => done(true)} autoFocus={!req.typeToConfirm}>
            {req.confirm ?? 'Confirm'}
          </button>
        </>
      }
    >
      <div className="col" style={{ gap: 14 }}>
        {req.body && <div className="muted">{req.body}</div>}
        {req.typeToConfirm && (
          <div className="field">
            <label htmlFor="confirm-type">Type <strong>{req.typeToConfirm}</strong> to confirm</label>
            <input id="confirm-type" className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus autoComplete="off" />
          </div>
        )}
      </div>
    </Modal>
  )
}
