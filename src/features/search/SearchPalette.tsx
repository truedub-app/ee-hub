import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { create } from 'zustand'
import { BookOpen, CalendarDays, Contact, FileText, Hash, ShieldAlert, UserRound } from 'lucide-react'
import { canSeeBlacklist, useHub } from '../../data/store'
import { buildSearchIndex, runSearch, snippet, type Hit, type HitKind } from './searchIndex'
import { Badge, Highlight, Modal, SearchInput } from '../../ui/primitives'
import { rotaIndex, cellOf, bandOf, dutyRoleOf } from '../rota/model'
import { today, shortDay, addDays } from '../../lib/dates'

const usePalette = create<{ isOpen: boolean }>(() => ({ isOpen: false }))

export function useSearchPalette() {
  return { open: () => usePalette.setState({ isOpen: true }), close: () => usePalette.setState({ isOpen: false }) }
}

/** Shared, memoised search index for the current data. */
export function useSearchIndex() {
  const data = useHub((s) => s.data)
  const contents = useHub((s) => s.contents)
  const blacklist = useHub((s) => s.blacklist)
  const sheets = useHub((s) => s.sheets)
  const allowBl = useHub(() => canSeeBlacklist())
  return useMemo(
    () => buildSearchIndex({
      staff: data.staff, sections: data.sections, contacts: data.contacts, docs: data.docs, categories: data.categories,
      contents, blacklist: allowBl ? blacklist : undefined, sheets: allowBl ? sheets : undefined,
    }),
    [data.staff, data.sections, data.contacts, data.docs, data.categories, contents, blacklist, sheets, allowBl],
  )
}

const GROUPS: { key: string; label: string; kinds: HitKind[]; icon: typeof FileText }[] = [
  { key: 'rota', label: 'ROTA', kinds: ['staff'], icon: CalendarDays },
  { key: 'manual', label: 'Manual', kinds: ['doc', 'section', 'glossary', 'page'], icon: BookOpen },
  { key: 'contacts', label: 'Contacts', kinds: ['contact', 'staff'], icon: Contact },
  { key: 'blacklist', label: 'Blacklist', kinds: ['blacklist'], icon: ShieldAlert },
]

export function SearchPalette() {
  const isOpen = usePalette((s) => s.isOpen)
  const close = () => usePalette.setState({ isOpen: false })
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const navigate = useNavigate()
  const index = useSearchIndex()
  const data = useHub((s) => s.data)
  const allowBl = useHub(() => canSeeBlacklist())
  const audit = useHub((s) => s.audit)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        usePalette.setState({ isOpen: true })
      } else if (e.key === '/' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault()
        usePalette.setState({ isOpen: true })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (isOpen) {
      setSel(0)
      setTimeout(() => inputRef.current?.select(), 30)
    }
  }, [isOpen])

  const hits = useMemo(() => runSearch(index, q, { limit: 60 }), [index, q])
  const idx = rotaIndex({ staff: data.staff, codes: data.shiftCodes, sections: data.sections, rota: data.rota, duties: data.duties })

  const groups = useMemo(() => {
    const used = new Set<string>()
    return GROUPS.map((g) => {
      const items: { hit: Hit; key: string }[] = []
      for (const h of hits) {
        if (!g.kinds.includes(h.doc.kind)) continue
        const key = `${g.key}:${h.doc.id}`
        if (g.key === 'contacts' && h.doc.kind === 'staff' && used.has(`rota:${h.doc.id}`) && items.length > 4) continue
        if (items.length >= (g.key === 'manual' ? 8 : 5)) break
        used.add(key)
        items.push({ hit: h, key })
      }
      return { ...g, items }
    }).filter((g) => (g.key === 'blacklist' ? allowBl && q.trim() : true))
  }, [hits, allowBl, q])

  const flat = groups.flatMap((g) => g.items.map((i) => ({ ...i, group: g.key })))
  const go = (i: number) => {
    const item = flat[i]
    if (!item) return
    const h = item.hit
    let route = h.doc.route
    if (item.group === 'rota') route = `/rota?view=week&staff=${encodeURIComponent(h.doc.refId)}&date=${today()}`
    if (item.group === 'blacklist') audit('blacklist.search', h.doc.title)
    close()
    setQ('')
    navigate(route)
  }

  const rotaLine = (staffId: string) => {
    const t = today()
    const parts: string[] = []
    for (let i = 0; i < 3; i++) {
      const d = addDays(t, i)
      const a = cellOf(idx, staffId, d)
      if (!a) continue
      const code = idx.codes.get(a.code)
      const band = data.sections.find((s) => s.id === bandOf(idx, a))
      const duty = dutyRoleOf(idx, staffId, d)
      const label = code?.kind === 'work' || code?.kind === 'duty' ? `${band?.name ?? code.label}${duty.inCharge ? ' ★' : ''}${duty.qc2 || a.code === 'Q' ? ' · QC 2' : ''}` : code?.label ?? a.code
      parts.push(`${i === 0 ? 'Today' : shortDay(d)}: ${label}`)
    }
    return parts.join('  ·  ') || 'No rota entries in the next days'
  }

  let n = -1
  return (
    <Modal open={isOpen} onClose={close} title="Search" size="wide" mobile="full">
      <div className="col" style={{ gap: 14 }}>
        <SearchInput
          inputRef={inputRef}
          value={q}
          onChange={(v) => {
            setQ(v)
            setSel(0)
          }}
          placeholder="Search staff, rota, procedures, contacts, blacklist…"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setSel((s) => Math.min(flat.length - 1, s + 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setSel((s) => Math.max(0, s - 1))
            } else if (e.key === 'Enter') go(sel)
          }}
        />
        {!q.trim() && (
          <p className="small muted">
            Try a name, a procedure (<em>TXMHD</em>, <em>NO EC</em>), a team (<em>MAM</em>), an extension or Arabic text. Press <kbd>↑</kbd> <kbd>↓</kbd> and <kbd>Enter</kbd>.
          </p>
        )}
        {q.trim() &&
          groups.map((g) => (
            <section key={g.key} aria-label={g.label}>
              <div className="eyebrow row" style={{ marginBottom: 6 }}>
                <g.icon width={14} height={14} /> {g.label}
              </div>
              {g.items.length === 0 ? (
                <p className="small faint" style={{ padding: '4px 0 6px' }}>No result</p>
              ) : (
                <div className="col" style={{ gap: 2 }} role="listbox" aria-label={`${g.label} results`}>
                  {g.items.map((it) => {
                    n++
                    const i = n
                    const h = it.hit
                    const sn = g.key === 'manual' || g.key === 'blacklist' ? snippet(h.doc.body, h.terms) : undefined
                    const Icon = h.doc.kind === 'staff' ? UserRound : h.doc.kind === 'glossary' ? Hash : h.doc.kind === 'contact' ? Contact : h.doc.kind === 'blacklist' ? ShieldAlert : FileText
                    return (
                      <button
                        key={it.key}
                        role="option"
                        aria-selected={sel === i}
                        className="row"
                        onMouseEnter={() => setSel(i)}
                        onClick={() => go(i)}
                        style={{
                          alignItems: 'flex-start', gap: 12, padding: '10px 12px', borderRadius: 10, border: 0, textAlign: 'left', color: 'var(--text)',
                          background: sel === i ? 'var(--accent-soft)' : 'transparent',
                        }}
                      >
                        <Icon width={18} height={18} style={{ marginTop: 2, color: h.doc.kind === 'blacklist' ? 'var(--alert)' : 'var(--text-3)', flex: 'none' }} />
                        <span className="col grow" style={{ gap: 2, minWidth: 0 }}>
                          <span className="row" style={{ gap: 8 }}>
                            <strong className="truncate">{h.doc.title}</strong>
                            {h.doc.kind === 'page' && <Badge tone="muted">Page {h.doc.page}</Badge>}
                            {h.doc.kind === 'glossary' && <Badge tone="cat-segmentation">Comment</Badge>}
                          </span>
                          <span className="small muted truncate">{g.key === 'rota' ? rotaLine(h.doc.refId) : h.doc.subtitle}</span>
                          {sn && sn.text && (
                            <span className="small faint" dir="auto" style={{ overflowWrap: 'anywhere' }}>
                              <Highlight text={sn.text} marks={sn.marks} />
                            </span>
                          )}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
            </section>
          ))}
      </div>
    </Modal>
  )
}
