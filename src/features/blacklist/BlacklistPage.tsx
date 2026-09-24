import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ChevronDown, Download, EyeOff, Lock, Pencil, Plus, ShieldAlert, ShieldCheck, TriangleAlert, Trash2, CircleCheck } from 'lucide-react'
import { useHub, usePerms } from '../../data/store'
import type { BlacklistCategory, BlacklistEntry, BlacklistStatus } from '../../data/types'
import { fold, uid, plural } from '../../lib/text'
import { checkName } from './checkName'
import { SheetsPanel } from './SheetsPanel'
import { mediumDate, today, addDays, diffDays } from '../../lib/dates'
import { Badge, Chip, Empty, Field, Modal, Notice, SearchInput, cx } from '../../ui/primitives'
import { confirmDialog, toast } from '../../ui/toast'
import { downloadBytes } from '../../data/backup'
import { PinEntry } from '../unlock/PinPad'
import { readVault, unlockWithPin, LockedOut, type PinMode } from '../../lib/vault'
import './blacklist.css'

export const CATEGORIES: { id: BlacklistCategory; label: string }[] = [
  { id: 'actor', label: 'Actors' },
  { id: 'journalist', label: 'Journalists' },
  { id: 'presenter', label: 'Presenters' },
  { id: 'contributor', label: 'Contributors' },
  { id: 'other', label: 'Other restricted' },
]
export const STATUSES: { id: BlacklistStatus; label: string; tone: string }[] = [
  { id: 'do-not-book', label: 'Do not book', tone: 'alert' },
  { id: 'review-required', label: 'Editorial review required', tone: 'warn' },
  { id: 'restricted', label: 'Restricted use', tone: 'hol' },
  { id: 'cleared', label: 'Cleared', tone: 'qc2' },
]
const catLabel = (c: BlacklistCategory) => CATEGORIES.find((x) => x.id === c)?.label.replace(/s$/, '') ?? c
const status = (s: BlacklistStatus) => STATUSES.find((x) => x.id === s) ?? STATUSES[0]

function Reauth({ onOk }: { onOk: () => void }) {
  const [mode, setMode] = useState<PinMode>('pin6')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(false)
  const [msg, setMsg] = useState<string>()
  useEffect(() => {
    void readVault().then((v) => v?.pinMode && setMode(v.pinMode))
  }, [])
  return (
    <div className="card card-pad col" style={{ maxWidth: 380, margin: '40px auto', gap: 16 }}>
      <div className="col" style={{ alignItems: 'center', gap: 8, textAlign: 'center' }}>
        <Lock style={{ color: 'var(--alert)' }} />
        <strong>Confirm your PIN to open the blacklist</strong>
        <span className="small muted">Required by this device’s security settings.</span>
      </div>
      <PinEntry
        mode={mode}
        busy={busy}
        error={err}
        label="PIN"
        onSubmit={async (pin) => {
          setBusy(true)
          setErr(false)
          try {
            const ok = await unlockWithPin(pin)
            if (ok) onOk()
            else {
              setErr(true)
              setMsg('Wrong PIN')
            }
          } catch (e) {
            setErr(true)
            setMsg(e instanceof LockedOut ? 'Too many attempts — try later' : String(e))
          } finally {
            setBusy(false)
          }
        }}
      />
      {msg && <p className="small" style={{ color: 'var(--alert)', textAlign: 'center' }}>{msg}</p>}
    </div>
  )
}

function EntryForm({ initial, onClose }: { initial?: BlacklistEntry; onClose: () => void }) {
  const upsert = useHub((s) => s.upsertBlacklist)
  const audit = useHub((s) => s.audit)
  const me = useHub((s) => s.local.userName ?? s.session?.label ?? '')
  const [e, setE] = useState<BlacklistEntry>(
    initial ?? {
      id: '', name: '', category: 'actor', aliases: [], programs: [], channels: [], status: 'do-not-book', reason: '', dateAdded: today(),
      lastReviewed: today(), reviewOwner: me, reviewDue: addDays(today(), 180), active: true, updatedAt: 0,
    },
  )
  const [aliases, setAliases] = useState(e.aliases.join(', '))
  const [programs, setPrograms] = useState(e.programs.join(', '))
  const [channels, setChannels] = useState(e.channels.join(', '))
  const set = (p: Partial<BlacklistEntry>) => setE({ ...e, ...p })
  const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean)
  const save = () => {
    const rec: BlacklistEntry = { ...e, id: e.id || uid('bl-'), aliases: list(aliases), programs: list(programs), channels: list(channels), updatedAt: Date.now(), updatedBy: me }
    upsert([rec])
    audit(initial ? 'blacklist.edit' : 'blacklist.add', rec.name, status(rec.status).label)
    toast(initial ? 'Entry updated' : 'Entry added')
    onClose()
  }
  return (
    <Modal open onClose={onClose} size="wide" title={initial ? `Edit — ${initial.name}` : 'Add blacklist entry'} footer={
      <>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-danger" onClick={save} disabled={!e.name.trim() || !e.reason.trim()}>Save entry</button>
      </>
    }>
      <div className="col" style={{ gap: 14 }}>
        <div className="form-grid">
          <Field label="Name" htmlFor="bl-name"><input id="bl-name" className="input" value={e.name} onChange={(x) => set({ name: x.target.value })} autoFocus dir="auto" /></Field>
          <Field label="Category" htmlFor="bl-cat">
            <select id="bl-cat" className="select" value={e.category} onChange={(x) => set({ category: x.target.value as BlacklistCategory })}>{CATEGORIES.map((c) => <option key={c.id} value={c.id}>{catLabel(c.id)}</option>)}</select>
          </Field>
          <Field label="Status" htmlFor="bl-status">
            <select id="bl-status" className="select" value={e.status} onChange={(x) => set({ status: x.target.value as BlacklistStatus })}>{STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
          </Field>
          <Field label="Alternate names" htmlFor="bl-al" hint="Comma separated — include Arabic spellings"><input id="bl-al" className="input" value={aliases} onChange={(x) => setAliases(x.target.value)} dir="auto" /></Field>
          <Field label="Associated programmes" htmlFor="bl-pr"><input id="bl-pr" className="input" value={programs} onChange={(x) => setPrograms(x.target.value)} dir="auto" /></Field>
          <Field label="Channels" htmlFor="bl-ch"><input id="bl-ch" className="input" value={channels} onChange={(x) => setChannels(x.target.value)} /></Field>
          <Field label="Source / reference" htmlFor="bl-src"><input id="bl-src" className="input" value={e.source ?? ''} onChange={(x) => set({ source: x.target.value })} /></Field>
          <Field label="Date added" htmlFor="bl-da"><input id="bl-da" type="date" className="input" value={e.dateAdded} onChange={(x) => set({ dateAdded: x.target.value })} /></Field>
          <Field label="Last reviewed" htmlFor="bl-lr"><input id="bl-lr" type="date" className="input" value={e.lastReviewed ?? ''} onChange={(x) => set({ lastReviewed: x.target.value })} /></Field>
          <Field label="Next review due" htmlFor="bl-rd"><input id="bl-rd" type="date" className="input" value={e.reviewDue ?? ''} onChange={(x) => set({ reviewDue: x.target.value })} /></Field>
          <Field label="Review owner" htmlFor="bl-ro"><input id="bl-ro" className="input" value={e.reviewOwner ?? ''} onChange={(x) => set({ reviewOwner: x.target.value })} /></Field>
        </div>
        <Field label="Reason / editorial note" htmlFor="bl-reason"><textarea id="bl-reason" className="textarea" value={e.reason} onChange={(x) => set({ reason: x.target.value })} dir="auto" /></Field>
        <Field label="Internal comments" htmlFor="bl-notes"><textarea id="bl-notes" className="textarea" value={e.notes ?? ''} onChange={(x) => set({ notes: x.target.value })} dir="auto" /></Field>
        <label className="check"><input type="checkbox" checked={e.active} onChange={(x) => set({ active: x.target.checked })} /> Active entry</label>
      </div>
    </Modal>
  )
}

function EntryCard({ e, open, onToggle }: { e: BlacklistEntry; open: boolean; onToggle: () => void }) {
  const perms = usePerms()
  const upsert = useHub((s) => s.upsertBlacklist)
  const audit = useHub((s) => s.audit)
  const me = useHub((s) => s.local.userName ?? s.session?.label ?? '')
  const [edit, setEdit] = useState(false)
  const st = status(e.status)
  const overdue = e.active && e.reviewDue && e.reviewDue < today()
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    if (open) {
      audit('blacklist.open', e.name)
      ref.current?.scrollIntoView({ block: 'nearest' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  const markReviewed = () => {
    upsert([{ ...e, lastReviewed: today(), reviewDue: addDays(today(), 180), reviewOwner: me, updatedAt: Date.now(), updatedBy: me }])
    audit('blacklist.review', e.name)
    toast('Marked as reviewed today')
  }
  const del = async () => {
    if (!(await confirmDialog({ title: `Delete ${e.name}?`, body: 'The entry is removed on this device and from the next published version. Consider marking it “Cleared” instead to keep the history.', confirm: 'Delete', danger: true }))) return
    upsert([{ ...e, deleted: true, updatedAt: Date.now(), updatedBy: me }])
    audit('blacklist.delete', e.name)
  }
  return (
    <article ref={ref} className={cx('bl-card', `tone-${st.tone}`, !e.active && 'inactive')}>
      <button className="bl-head" onClick={onToggle} aria-expanded={open}>
        <TriangleAlert className="bl-icon" aria-hidden />
        <span className="col grow" style={{ gap: 2, minWidth: 0 }}>
          <strong dir="auto">{e.name}</strong>
          <span className="small muted">{catLabel(e.category)}{e.programs.length ? ` · ${e.programs.join(', ')}` : ''}</span>
        </span>
        <span className="col" style={{ gap: 4, alignItems: 'flex-end' }}>
          <Badge tone={st.tone} caps>{st.label}</Badge>
          <span className={cx('tiny', overdue ? '' : 'faint')} style={overdue ? { color: 'var(--warn)' } : undefined}>
            {overdue ? 'Review overdue' : e.lastReviewed ? `Last reviewed: ${mediumDate(e.lastReviewed)}` : 'Never reviewed'}
          </span>
        </span>
        <ChevronDown width={18} style={{ transform: open ? 'rotate(180deg)' : undefined, flex: 'none' }} />
      </button>
      {open && (
        <div className="bl-body">
          <dl className="kv">
            <dt>Reason</dt><dd dir="auto">{e.reason}</dd>
            {e.aliases.length > 0 && <><dt>Also known as</dt><dd dir="auto">{e.aliases.join(' · ')}</dd></>}
            {e.channels.length > 0 && <><dt>Channels</dt><dd>{e.channels.join(', ')}</dd></>}
            {e.source && <><dt>Source</dt><dd>{e.source}</dd></>}
            <dt>Date added</dt><dd>{mediumDate(e.dateAdded)}</dd>
            {e.reviewOwner && <><dt>Review owner</dt><dd>{e.reviewOwner}</dd></>}
            {e.reviewDue && <><dt>Next review</dt><dd>{mediumDate(e.reviewDue)}{overdue ? ` (${diffDays(today(), e.reviewDue)} days overdue)` : ''}</dd></>}
            {e.notes && <><dt>Internal comments</dt><dd dir="auto" style={{ whiteSpace: 'pre-line' }}>{e.notes}</dd></>}
            {e.updatedBy && <><dt>Last change</dt><dd className="small muted">{e.updatedBy}</dd></>}
          </dl>
          {perms.editBlacklist && (
            <div className="row-wrap" style={{ marginTop: 12 }}>
              <button className="btn btn-sm" onClick={markReviewed}><CircleCheck /> Mark reviewed today</button>
              <button className="btn btn-sm" onClick={() => setEdit(true)}><Pencil /> Edit</button>
              <button className="btn btn-sm btn-ghost" style={{ color: 'var(--alert)' }} onClick={() => void del()}><Trash2 /> Delete</button>
            </div>
          )}
        </div>
      )}
      {edit && <EntryForm initial={e} onClose={() => setEdit(false)} />}
    </article>
  )
}

export function BlacklistPage() {
  const perms = usePerms()
  const hasKey = useHub((s) => !!s.session?.keys.restricted)
  const blacklist = useHub((s) => s.blacklist)
  const sheets = useHub((s) => s.sheets)
  const local = useHub((s) => s.local)
  const setLocal = useHub((s) => s.setLocal)
  const audit = useHub((s) => s.audit)
  const unlockedAt = useHub((s) => s.blacklistUnlockedAt)
  const markUnlocked = useHub((s) => s.markBlacklistUnlocked)
  const [sp, setSp] = useSearchParams()
  const [q, setQ] = useState('')
  const [cat, setCat] = useState<BlacklistCategory | ''>('')
  const [open, setOpen] = useState<string | undefined>(sp.get('focus') ?? undefined)
  const [adding, setAdding] = useState(false)
  const [exporting, setExporting] = useState(false)
  const filter = sp.get('filter') ?? ''

  const pinOn = useHub((s) => s.pinOn)
  const needReauth = pinOn && local.blacklistReauth && (!unlockedAt || Date.now() - unlockedAt > 5 * 60_000)

  useEffect(() => {
    if (perms.viewBlacklist && hasKey && !needReauth && !local.hideBlacklist) audit('blacklist.view')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needReauth, local.hideBlacklist])

  useEffect(() => {
    if (q.trim().length < 3) return
    const t = setTimeout(() => audit('blacklist.search', q.trim()), 1200)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])

  const live = useMemo(() => blacklist.filter((b) => !b.deleted), [blacklist])
  const liveSheets = useMemo(() => sheets.filter((s) => !s.deleted), [sheets])
  const sheetNames = liveSheets.reduce((a, s) => a + s.names.length, 0)
  const matches = useMemo(() => (q.trim() ? checkName(q, live, liveSheets) : []), [q, live, liveSheets])
  const f = fold(q.trim())
  const list = useMemo(() => {
    return live
      .filter((e) => !cat || e.category === cat)
      .filter((e) => (filter === 'overdue' ? e.active && e.reviewDue && e.reviewDue < today() : true))
      .filter((e) => !f || matches.some((m) => m.e?.id === e.id) || [e.name, ...e.aliases, ...e.programs, ...e.channels, e.reason, e.notes].some((x) => x && fold(x).includes(f)))
      .sort((a, b) => Number(b.active) - Number(a.active) || STATUSES.findIndex((s) => s.id === a.status) - STATUSES.findIndex((s) => s.id === b.status) || a.name.localeCompare(b.name))
  }, [live, cat, f, filter, matches])

  if (!perms.viewBlacklist || !hasKey) {
    return <Empty icon={<ShieldAlert />} title="No access">The blacklist is not available with your access level.</Empty>
  }
  if (local.hideBlacklist) {
    return (
      <Empty icon={<EyeOff />} title="Hidden blacklist mode is on" action={<button className="btn" onClick={() => setLocal({ hideBlacklist: false })}>Show the blacklist on this device</button>}>
        The blacklist is hidden from navigation and search on this device.
      </Empty>
    )
  }
  if (needReauth) return <Reauth onOk={markUnlocked} />

  const exportCsv = (redacted: boolean) => {
    const rows = redacted
      ? [['Name', 'Category', 'Status', 'Last reviewed'], ...list.map((e) => [e.name, catLabel(e.category), status(e.status).label, e.lastReviewed ?? ''])]
      : [['Name', 'Category', 'Alternate names', 'Programmes', 'Channels', 'Status', 'Reason', 'Source', 'Date added', 'Last reviewed', 'Review owner', 'Internal comments', 'Active'],
        ...list.map((e) => [e.name, catLabel(e.category), e.aliases.join('; '), e.programs.join('; '), e.channels.join('; '), status(e.status).label, e.reason, e.source ?? '', e.dateAdded, e.lastReviewed ?? '', e.reviewOwner ?? '', e.notes ?? '', e.active ? 'yes' : 'no'])]
    const csv = '﻿' + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n')
    downloadBytes(new TextEncoder().encode(csv), `Blacklist_${redacted ? 'redacted_' : ''}${today()}.csv`, 'text/csv')
    audit('blacklist.export', redacted ? 'Redacted CSV' : 'Full CSV', `${list.length} entries`)
    setExporting(false)
  }

  return (
    <div className="bl">
      <div className="bl-banner" role="note">
        <ShieldAlert />
        <div className="grow">
          <strong>Restricted — editorial use only.</strong> <span className="muted">Do not share outside the department. Views, searches and changes are recorded in the audit log.</span>
        </div>
      </div>

      <SheetsPanel />

      <div className="bl-check card card-pad">
        <label className="eyebrow" htmlFor="bl-search">Check a name</label>
        <SearchInput value={q} onChange={setQ} placeholder="Search name, alternate name, programme or note" label="Search the blacklist" autoFocus />
        {q.trim().length >= 3 && (
          matches.length ? (
            <div className="bl-result hit" role="status">
              <TriangleAlert />
              <div className="col" style={{ gap: 4 }}>
                <strong>{plural(matches.length, 'possible match', 'possible matches')} on the blacklist</strong>
                {matches.slice(0, 5).map((m, i) => (
                  <button key={`${m.e?.id ?? m.sheet?.id}-${i}`} className="bl-match" onClick={() => m.e && setOpen(m.e.id)}>
                    <span dir="auto">{m.e?.name ?? m.name}</span>
                    {m.e ? <Badge tone={status(m.e.status).tone}>{status(m.e.status).label}</Badge> : <Badge tone="alert">On the blacklist image</Badge>}
                    <span className="tiny faint">{m.how}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="bl-result clear" role="status"><ShieldCheck /><span><strong>No match</strong> for “{q.trim()}” in {plural(live.length + sheetNames, 'listed name')}.{liveSheets.some((s) => !s.names.length) ? ' Some names on the blacklist image are not typed yet — check the image itself.' : ' Always check alternate spellings.'}</span></div>
          )
        )}
      </div>

      <div className="row-wrap" style={{ margin: '16px 0 12px' }}>
        <div className="chips scroll grow" role="group" aria-label="Categories">
          <Chip pressed={!cat && !filter} onClick={() => { setCat(''); setSp({}, { replace: true }) }} count={live.length}>All</Chip>
          {CATEGORIES.map((c) => <Chip key={c.id} tone="alert" pressed={cat === c.id} onClick={() => setCat(cat === c.id ? '' : c.id)} count={live.filter((e) => e.category === c.id).length}>{c.label}</Chip>)}
          <Chip tone="warn" pressed={filter === 'overdue'} onClick={() => setSp(filter === 'overdue' ? {} : { filter: 'overdue' }, { replace: true })} count={live.filter((e) => e.active && e.reviewDue && e.reviewDue < today()).length}>Review overdue</Chip>
        </div>
        {perms.editBlacklist && <button className="btn" onClick={() => setExporting(true)} disabled={!list.length}><Download /> Export</button>}
        {perms.editBlacklist && <button className="btn" onClick={() => setAdding(true)}><Plus /> Add entry</button>}
      </div>

      {live.length === 0 ? (
        liveSheets.length ? (
          <p className="small muted">No detailed entries. {perms.editBlacklist ? 'Use “Add entry” for a person who needs a reason, status or review date beyond the image.' : ''}</p>
        ) : (
          <Empty icon={<ShieldCheck />} title="Nothing on the blacklist yet">
            {perms.editBlacklist ? 'Upload the blacklist image above. You can also add detailed entries with a reason and review date.' : 'The administrator has not published the blacklist yet.'}
          </Empty>
        )
      ) : list.length === 0 ? (
        <Empty icon={<ShieldCheck />} title="No entries match">Try another name, programme or category.</Empty>
      ) : (
        <div className="col" style={{ gap: 8 }}>
          {list.map((e) => <EntryCard key={e.id} e={e} open={open === e.id} onToggle={() => setOpen(open === e.id ? undefined : e.id)} />)}
        </div>
      )}

      {adding && <EntryForm onClose={() => setAdding(false)} />}
      {exporting && (
        <Modal open onClose={() => setExporting(false)} title="Export blacklist" footer={<button className="btn" onClick={() => setExporting(false)}>Cancel</button>}>
          <div className="col" style={{ gap: 14 }}>
            <Notice tone="alert">Exported files are <strong>not encrypted</strong>. Store them only on approved department storage. This export is logged.</Notice>
            <p className="small muted">{plural(list.length, 'entry', 'entries')} (current filter).</p>
            <button className="btn btn-lg" onClick={() => exportCsv(true)}><EyeOff /> Redacted export — names, category, status only</button>
            <button className="btn btn-lg btn-danger" onClick={async () => {
              if (await confirmDialog({ title: 'Export full records?', body: 'Reasons, sources and internal comments will be included in plain text.', confirm: 'Export full CSV', danger: true, typeToConfirm: 'EXPORT' })) exportCsv(false)
            }}><Download /> Full export (includes reasons & comments)</button>
          </div>
        </Modal>
      )}
    </div>
  )
}
