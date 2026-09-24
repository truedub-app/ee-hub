import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Star, Trash2 } from 'lucide-react'
import { create } from 'zustand'
import { useHub, usePerms } from '../../data/store'
import type { ISODate, RotaAssignment } from '../../data/types'
import { longDate } from '../../lib/dates'
import { Avatar, Badge, Field, Modal, Notice, cx } from '../../ui/primitives'
import { toast } from '../../ui/toast'
import { bandOf, dutyEligibility, hoursOf } from './model'
import { saveCell, saveDuty, useRotaCtx } from './useRota'

interface EditReq { staffId?: string; date: ISODate }
const useEditor = create<{ req?: EditReq; menu?: EditReq & { x: number; y: number } }>(() => ({}))

export function openCellEditor(req: EditReq) {
  useEditor.setState({ req, menu: undefined })
}
export function openQuickMenu(req: EditReq & { x: number; y: number }) {
  useEditor.setState({ menu: req })
}

/** Long-press (touch) / right-click (mouse) handlers for rota cells. */
export function cellPressHandlers(req: EditReq, enabled: boolean) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let fired = false
  if (!enabled) return {}
  return {
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault()
      openQuickMenu({ ...req, x: e.clientX, y: e.clientY })
    },
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType !== 'touch') return
      fired = false
      const { clientX: x, clientY: y } = e
      timer = setTimeout(() => {
        fired = true
        navigator.vibrate?.(15)
        openQuickMenu({ ...req, x, y })
      }, 480)
    },
    onPointerUp: () => clearTimeout(timer),
    onPointerLeave: () => clearTimeout(timer),
    onPointerCancel: () => clearTimeout(timer),
    onClickCapture: (e: React.MouseEvent) => {
      if (fired) {
        e.stopPropagation()
        e.preventDefault()
        fired = false
      }
    },
  }
}

export function CellEditorHost() {
  const req = useEditor((s) => s.req)
  const menu = useEditor((s) => s.menu)
  return (
    <>
      {req && <CellEditor req={req} onClose={() => useEditor.setState({ req: undefined })} />}
      {menu && <QuickMenu req={menu} onClose={() => useEditor.setState({ menu: undefined })} />}
    </>
  )
}

function CellEditor({ req, onClose }: { req: EditReq; onClose: () => void }) {
  const ctx = useRotaCtx()
  const perms = usePerms()
  const staffList = useMemo(() => ctx.staff.filter((s) => !s.deleted && s.active).sort((a, b) => a.name.localeCompare(b.name)), [ctx.staff])
  const [staffId, setStaffId] = useState(req.staffId ?? '')
  const [date, setDate] = useState(req.date)
  const prev = staffId ? ctx.idx.cell.get(`${staffId}|${date}`) : undefined
  const staff = ctx.idx.staff.get(staffId)
  const [code, setCode] = useState(prev?.code ?? '')
  const [band, setBand] = useState(bandOf(ctx.idx, prev) ?? staff?.section ?? '')
  const [note, setNote] = useState(prev?.note ?? '')

  useEffect(() => {
    const p = staffId ? ctx.idx.cell.get(`${staffId}|${date}`) : undefined
    const s = ctx.idx.staff.get(staffId)
    setCode(p?.code ?? '')
    setBand(bandOf(ctx.idx, p) ?? s?.section ?? '')
    setNote(p?.note ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staffId, date])

  const codes = ctx.codes.filter((c) => !c.deleted && c.code !== 'X')
  const selected = ctx.idx.codes.get(code)
  const needsBand = selected && (selected.kind === 'duty' || (selected.kind === 'work' && !selected.band))
  const duty = ctx.idx.duty.get(`${date}|${band}`)
  const readOnly = !perms.editRota

  const save = () => {
    if (!staffId || !code) return
    const next: Omit<RotaAssignment, 'updatedAt' | 'id'> = {
      staffId, date, code, band: needsBand ? band : selected?.band, note: note || undefined,
    }
    saveCell(next, prev)
    // keep duty records consistent when someone is moved off a band
    for (const d of ctx.duties) {
      if (d.deleted || d.date !== date) continue
      const onBand = (selected?.kind === 'work' || selected?.kind === 'duty') && (next.band ?? selected?.band) === d.band
      if (!onBand && d.inChargeId === staffId) saveDuty(date, d.band, { inChargeId: undefined })
      if (!onBand && d.qc2Id === staffId) saveDuty(date, d.band, { qc2Id: undefined })
    }
    if (code === 'Q' && band && (!duty?.qc2Id || duty.qc2Id !== staffId)) saveDuty(date, band, { qc2Id: staffId })
    toast(`${staff?.name ?? 'Shift'} — ${selected?.label ?? code} saved`)
    onClose()
  }

  const clear = () => {
    if (!prev) return onClose()
    useHub.getState().remove('rota', [prev.id])
    useHub.getState().audit('rota.clear', `${staff?.name} ${date}`, prev.code)
    toast('Cell cleared')
    onClose()
  }

  const eligIc = staffId && band ? dutyEligibility(date, band, staffId, ctx, ctx.idx) : undefined
  const sec = ctx.sections.find((s) => s.id === band)

  return (
    <Modal
      open
      onClose={onClose}
      title={readOnly ? 'Shift details' : prev ? 'Edit or reassign shift' : 'Assign shift'}
      footer={
        readOnly ? <button className="btn" onClick={onClose}>Close</button> : (
          <>
            {prev && <button className="btn btn-ghost" onClick={clear} style={{ marginRight: 'auto', color: 'var(--alert)' }}><Trash2 /> Clear cell</button>}
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" onClick={save} disabled={!staffId || !code || (needsBand && !band)}>Save</button>
          </>
        )
      }
    >
      <div className="col" style={{ gap: 16 }}>
        {req.staffId ? (
          <div className="row" style={{ gap: 12 }}>
            <Avatar name={staff?.name ?? '?'} tone={ctx.sections.find((s) => s.id === staff?.section)?.tone} />
            <div className="col" style={{ gap: 0 }}>
              <strong>{staff?.name}</strong>
              <span className="small muted">{longDate(date)}</span>
            </div>
          </div>
        ) : (
          <div className="form-grid">
            <Field label="Staff member" htmlFor="ce-staff">
              <select id="ce-staff" className="select" value={staffId} onChange={(e) => setStaffId(e.target.value)}>
                <option value="">Choose…</option>
                {staffList.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="Date" htmlFor="ce-date">
              <input id="ce-date" type="date" className="input" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
            </Field>
          </div>
        )}
        {prev?.raw && <p className="small faint">Imported as “{prev.raw}”{prev.inferred ? ` · ${prev.inferred}` : ''}</p>}
        {readOnly ? (
          <dl className="kv">
            <dt>Assignment</dt><dd>{selected ? `${selected.label} (${selected.code})` : 'Not on the rota'}</dd>
            {hoursOf(ctx.idx, ctx.sections, prev) && <><dt>Hours</dt><dd className="mono">{hoursOf(ctx.idx, ctx.sections, prev)}</dd></>}
            {sec && <><dt>Band</dt><dd>{sec.name}</dd></>}
            {prev?.note && <><dt>Note</dt><dd>{prev.note}</dd></>}
            {duty?.inChargeId === staffId && <><dt>Duty</dt><dd><Badge tone="incharge"><Star /> In-Charge</Badge></dd></>}
            {duty?.qc2Id === staffId && <><dt>Duty</dt><dd><Badge tone="qc2"><CheckCircle2 /> QC 2 & Missing List</Badge></dd></>}
          </dl>
        ) : (
          <>
            <div className="field">
              <span className="field-label">Assignment</span>
              <div className="code-grid" role="group" aria-label="Shift code">
                {codes.map((c) => (
                  <button key={c.code} type="button" className={cx('code-opt', `tone-${c.tone}`)} aria-pressed={code === c.code} onClick={() => setCode(c.code)}>
                    <strong>{c.code}</strong>
                    <span>{c.label}{c.hours ? ` · ${c.hours}` : ''}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="form-grid">
              {needsBand && (
                <Field label="Band" htmlFor="ce-band" hint="Which shift band this duty is worked on">
                  <select id="ce-band" className="select" value={band} onChange={(e) => setBand(e.target.value)}>
                    <option value="">Choose…</option>
                    {ctx.sections.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.start}–{s.end}</option>)}
                  </select>
                </Field>
              )}
            </div>
            <Field label="Note" htmlFor="ce-note">
              <input id="ce-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
            </Field>
            {code === 'Q' && eligIc && !eligIc.ok && prev && <Notice tone="warn">Currently: {eligIc.reason}. Saving moves them onto the {sec?.name ?? 'selected'} band as QC 2.</Notice>}
          </>
        )}
      </div>
    </Modal>
  )
}

function QuickMenu({ req, onClose }: { req: EditReq & { x: number; y: number }; onClose: () => void }) {
  const ctx = useRotaCtx()
  const perms = usePerms()
  const staffId = req.staffId!
  const a = ctx.idx.cell.get(`${staffId}|${req.date}`)
  const band = bandOf(ctx.idx, a)
  const duty = band ? ctx.idx.duty.get(`${req.date}|${band}`) : undefined
  const onShift = !!band && (ctx.idx.codes.get(a?.code ?? '')?.kind === 'work' || ctx.idx.codes.get(a?.code ?? '')?.kind === 'duty')
  useEffect(() => {
    const close = () => onClose()
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [onClose])
  const quick = ['M', 'A', 'N', 'OFF', 'HOL', 'SICK'].map((c) => ctx.idx.codes.get(c)).filter(Boolean)
  const x = Math.min(req.x, window.innerWidth - 240)
  const y = Math.min(req.y, window.innerHeight - 380)
  const set = (code: string) => {
    const c = ctx.idx.codes.get(code)
    saveCell({ staffId, date: req.date, code, band: c?.band }, a)
    toast(`${ctx.idx.staff.get(staffId)?.name}: ${c?.label}`)
    onClose()
  }
  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 149 }} onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose() }} />
      <div className="menu" role="menu" style={{ left: x, top: y }} aria-label="Quick actions">
        <div className="tiny faint" style={{ padding: '6px 10px' }}>{ctx.idx.staff.get(staffId)?.name} · {req.date}</div>
        {perms.editRota && quick.map((c) => (
          <button key={c!.code} role="menuitem" onClick={() => set(c!.code)}>
            <span className={`code-pill tone-${c!.tone}`}>{c!.code}</span> {c!.label}
          </button>
        ))}
        {perms.editRota && onShift && <hr />}
        {perms.editRota && onShift && (
          <button role="menuitem" onClick={() => { saveDuty(req.date, band!, { inChargeId: duty?.inChargeId === staffId ? undefined : staffId }); onClose() }}>
            <Star style={{ color: 'var(--incharge)' }} /> {duty?.inChargeId === staffId ? 'Remove In-Charge' : 'Make In-Charge'}
          </button>
        )}
        {perms.editRota && onShift && (
          <button role="menuitem" onClick={() => { saveDuty(req.date, band!, { qc2Id: duty?.qc2Id === staffId ? undefined : staffId }); onClose() }}>
            <CheckCircle2 style={{ color: 'var(--qc2)' }} /> {duty?.qc2Id === staffId ? 'Remove QC 2' : 'Make QC 2 duty holder'}
          </button>
        )}
        <hr />
        <button role="menuitem" onClick={() => openCellEditor({ staffId, date: req.date })}>{perms.editRota ? 'Edit / reassign…' : 'Details…'}</button>
      </div>
    </>
  )
}
