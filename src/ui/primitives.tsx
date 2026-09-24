import { useEffect, useId, useRef, type ReactNode } from 'react'
import {
  BadgeCheck, BookMarked, CalendarClock, Captions, CircleAlert, Clapperboard, Info, Play, Scale, Scissors, Search, ShieldCheck,
  TriangleAlert, Tv, Workflow, X, type LucideIcon, FileText,
} from 'lucide-react'
import { initials as makeInitials } from '../lib/text'

export const GLYPHS: Record<string, LucideIcon> = {
  scale: Scale, scissors: Scissors, clapperboard: Clapperboard, play: Play, workflow: Workflow, 'badge-check': BadgeCheck,
  captions: Captions, tv: Tv, 'shield-check': ShieldCheck, 'calendar-clock': CalendarClock, 'book-marked': BookMarked, file: FileText,
}

export function Glyph({ name, size = 18 }: { name: string; size?: number }) {
  const I = GLYPHS[name] ?? FileText
  return <I width={size} height={size} aria-hidden />
}

export function cx(...c: (string | false | null | undefined)[]): string {
  return c.filter(Boolean).join(' ')
}

export function Badge({ tone, children, solid, caps, lg, title, className }: { tone?: string; children: ReactNode; solid?: boolean; caps?: boolean; lg?: boolean; title?: string; className?: string }) {
  return <span className={cx('badge', tone && `tone-${tone}`, solid && 'solid', caps && 'caps', lg && 'lg', className)} title={title}>{children}</span>
}

export function Avatar({ name, tone = 'accent', size, round, label }: { name: string; tone?: string; size?: 'sm' | 'lg'; round?: boolean; label?: string }) {
  return (
    <span className={cx('avatar', `tone-${tone}`, size, round && 'round')} aria-hidden={!label} aria-label={label}>
      {makeInitials(name)}
    </span>
  )
}

export function Empty({ icon, title, children, action }: { icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  )
}

export function Notice({ tone = 'accent', icon, children, action }: { tone?: 'accent' | 'warn' | 'alert' | 'qc2' | 'incharge'; icon?: ReactNode; children: ReactNode; action?: ReactNode }) {
  const I = tone === 'alert' ? CircleAlert : tone === 'warn' ? TriangleAlert : Info
  return (
    <div className={`notice tone-${tone}`} role={tone === 'alert' ? 'alert' : 'status'}>
      {icon ?? <I aria-hidden />}
      <div className="grow">{children}</div>
      {action}
    </div>
  )
}

export function SearchInput({ value, onChange, placeholder, autoFocus, label, onKeyDown, inputRef }: {
  value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean; label?: string
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void; inputRef?: React.Ref<HTMLInputElement>
}) {
  return (
    <div className="search-input">
      <Search className="lead" aria-hidden />
      <input
        ref={inputRef}
        className="input"
        type="search"
        value={value}
        placeholder={placeholder}
        aria-label={label ?? placeholder}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        enterKeyHint="search"
      />
      {value && (
        <button type="button" className="icon-btn sm clear" aria-label="Clear search" onClick={() => onChange('')}>
          <X />
        </button>
      )}
    </div>
  )
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Chip({ pressed, onClick, tone, icon, children, count, dot }: { pressed?: boolean; onClick?: () => void; tone?: string; icon?: ReactNode; children: ReactNode; count?: number; dot?: boolean }) {
  return (
    <button type="button" className={cx('chip', tone && `tone-${tone}`)} aria-pressed={!!pressed} onClick={onClick}>
      {dot && <span className="dot" />}
      {icon}
      {children}
      {count !== undefined && <span className="count">{count}</span>}
    </button>
  )
}

export function Modal({ open, onClose, title, children, footer, size, mobile = 'sheet', labelledBy, headExtra }: {
  open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; size?: 'wide' | 'full'
  mobile?: 'sheet' | 'full'; labelledBy?: string; headExtra?: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const id = useId()
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  if (!open) return null
  return (
    <dialog
      ref={ref}
      className={cx('modal', mobile === 'sheet' ? 'sheet-mobile' : 'full-mobile')}
      aria-labelledby={labelledBy ?? id}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose()
      }}
    >
      <div className={cx('modal-box', size)}>
        <div className="modal-head">
          <h2 id={id}>{title}</h2>
          {headExtra}
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <X />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </dialog>
  )
}

export function Field({ label, hint, error, children, htmlFor }: { label: string; hint?: ReactNode; error?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {error ? <span className="error">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  )
}

export function Switch({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="track" aria-hidden />
      <span className="col" style={{ gap: 2 }}>
        <span>{label}</span>
        {hint && <span className="tiny faint">{hint}</span>}
      </span>
    </label>
  )
}

export function Progress({ value }: { value: number }) {
  return (
    <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)}>
      <span style={{ width: `${Math.max(2, Math.min(100, value * 100))}%` }} />
    </div>
  )
}

export function Highlight({ text, marks }: { text: string; marks: [number, number][] }) {
  if (!marks.length) return <>{text}</>
  const out: ReactNode[] = []
  let at = 0
  marks.forEach(([s, e], i) => {
    if (s < at) return
    out.push(text.slice(at, s))
    out.push(<mark key={i}>{text.slice(s, e)}</mark>)
    at = e
  })
  out.push(text.slice(at))
  return <>{out}</>
}
