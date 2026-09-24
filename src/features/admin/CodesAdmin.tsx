import { useState } from 'react'
import { Pencil, Plus, SlidersHorizontal } from 'lucide-react'
import { useHub, usePerms } from '../../data/store'
import type { CodeKind, Section, ShiftCode } from '../../data/types'
import { Badge, Empty, Field, Modal, Switch } from '../../ui/primitives'
import { toast } from '../../ui/toast'
import { PageHead } from '../shell/Shell'
import { live } from '../../data/merge'

const TONES = ['morning', 'afternoon', 'night', 'graphics', 'qc2', 'off', 'hol', 'toil', 'sick', 'training', 'remote', 'accent', 'alert', 'warn']
const KINDS: { v: CodeKind; l: string }[] = [
  { v: 'work', l: 'Working shift' }, { v: 'duty', l: 'Duty (worked on a band)' }, { v: 'rest', l: 'Rest day' }, { v: 'absence', l: 'Absence' }, { v: 'other', l: 'Other' },
]

function CodeForm({ initial, onClose }: { initial?: ShiftCode; onClose: () => void }) {
  const sections = live(useHub((s) => s.data.sections))
  const codes = useHub((s) => s.data.shiftCodes)
  const upsert = useHub((s) => s.upsert)
  const audit = useHub((s) => s.audit)
  const [c, setC] = useState<ShiftCode>(initial ?? { id: '', code: '', label: '', kind: 'other', glyph: '', tone: 'accent', updatedAt: 0 })
  const [match, setMatch] = useState((initial?.match ?? []).join('\n'))
  const set = (p: Partial<ShiftCode>) => setC({ ...c, ...p })
  const code = c.code.trim().toUpperCase()
  const taken = !initial && codes.some((x) => !x.deleted && x.code === code)
  const save = () => {
    const rec: ShiftCode = { ...c, id: initial?.id ?? code, code, glyph: c.glyph || code.slice(0, 2), match: match.split('\n').map((x) => x.trim()).filter(Boolean), updatedAt: Date.now() }
    upsert('shiftCodes', [rec])
    audit(initial ? 'codes.edit' : 'codes.add', rec.code, rec.label)
    toast('Shift code saved')
    onClose()
  }
  return (
    <Modal open onClose={onClose} title={initial ? `Edit code ${initial.code}` : 'Add custom code'} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={!code || !c.label.trim() || taken}>Save</button></>}>
      <div className="form-grid">
        <Field label="Code" htmlFor="c-code" error={taken ? 'Code already exists' : undefined}><input id="c-code" className="input mono" value={c.code} disabled={!!initial?.builtin} onChange={(e) => set({ code: e.target.value.toUpperCase().slice(0, 6) })} /></Field>
        <Field label="Label" htmlFor="c-label"><input id="c-label" className="input" value={c.label} onChange={(e) => set({ label: e.target.value })} /></Field>
        <Field label="Kind" htmlFor="c-kind"><select id="c-kind" className="select" value={c.kind} disabled={!!initial?.builtin} onChange={(e) => set({ kind: e.target.value as CodeKind })}>{KINDS.map((k) => <option key={k.v} value={k.v}>{k.l}</option>)}</select></Field>
        {c.kind === 'work' && (
          <Field label="Band" htmlFor="c-band"><select id="c-band" className="select" value={c.band ?? ''} onChange={(e) => set({ band: e.target.value || undefined })}><option value="">Any (choose per cell)</option>{sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        )}
        <Field label="Hours" htmlFor="c-hours"><input id="c-hours" className="input mono" value={c.hours ?? ''} onChange={(e) => set({ hours: e.target.value || undefined })} placeholder="08:00–16:00" /></Field>
        <Field label="Month-grid glyph" htmlFor="c-glyph"><input id="c-glyph" className="input mono" value={c.glyph} maxLength={2} onChange={(e) => set({ glyph: e.target.value })} /></Field>
        <Field label="Colour" htmlFor="c-tone"><select id="c-tone" className="select" value={c.tone} onChange={(e) => set({ tone: e.target.value })}>{TONES.map((t) => <option key={t}>{t}</option>)}</select></Field>
      </div>
      <div style={{ marginTop: 14 }}>
        <Field label="Import patterns" htmlFor="c-match" hint="One regular expression per line, matched against spreadsheet text (case-insensitive)">
          <textarea id="c-match" className="textarea mono" value={match} onChange={(e) => setMatch(e.target.value)} />
        </Field>
      </div>
    </Modal>
  )
}

function SectionForm({ initial, onClose }: { initial: Section; onClose: () => void }) {
  const upsert = useHub((s) => s.upsert)
  const [s, setS] = useState(initial)
  return (
    <Modal open onClose={onClose} title={`Section — ${initial.name}`} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={() => { upsert('sections', [{ ...s, updatedAt: Date.now() }]); useHub.getState().audit('sections.edit', s.name); onClose() }}>Save</button></>}>
      <div className="form-grid">
        <Field label="Name" htmlFor="s-name"><input id="s-name" className="input" value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} /></Field>
        <Field label="Start" htmlFor="s-start"><input id="s-start" type="time" className="input" value={s.start} onChange={(e) => setS({ ...s, start: e.target.value })} /></Field>
        <Field label="End" htmlFor="s-end"><input id="s-end" type="time" className="input" value={s.end} onChange={(e) => setS({ ...s, end: e.target.value })} /></Field>
      </div>
      <div style={{ marginTop: 14 }}><Switch checked={s.duties} onChange={(v) => setS({ ...s, duties: v })} label="Requires In-Charge and QC 2 every day" /></div>
    </Modal>
  )
}

export function CodesAdmin() {
  const perms = usePerms()
  const codes = live(useHub((s) => s.data.shiftCodes))
  const sections = live(useHub((s) => s.data.sections)).sort((a, b) => a.order - b.order)
  const [edit, setEdit] = useState<ShiftCode | 'new'>()
  const [sec, setSec] = useState<Section>()
  if (!perms.admin) return <Empty icon={<SlidersHorizontal />} title="Administrators only" />
  return (
    <div className="col" style={{ gap: 18 }}>
      <PageHead title="Shift codes & sections" sub="Codes used in the rota and how spreadsheet text is recognised on import." actions={<button className="btn btn-primary" onClick={() => setEdit('new')}><Plus /> Add custom code</button>} />
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Code</th><th>Meaning</th><th>Hours</th><th>Kind</th><th>Import patterns</th><th aria-label="Edit" /></tr></thead>
          <tbody>
            {codes.map((c) => (
              <tr key={c.code}>
                <td><span className={`code-pill tone-${c.tone}`}>{c.code}</span></td>
                <td>{c.label}{c.builtin && <span className="tiny faint"> · built-in</span>}</td>
                <td className="mono small">{c.hours ?? (c.band ? sections.find((s) => s.id === c.band)?.start + '–' + sections.find((s) => s.id === c.band)?.end : '—')}</td>
                <td><Badge tone="muted">{c.kind}</Badge></td>
                <td className="mono tiny faint" style={{ maxWidth: 320, overflowWrap: 'anywhere' }}>{(c.match ?? []).join('  ·  ') || (c.kind === 'work' && c.band ? 'Recognised from hours (e.g. “08 till 16 00”)' : '—')}</td>
                <td><button className="icon-btn sm" aria-label={`Edit ${c.code}`} onClick={() => setEdit(c)}><Pencil /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2>Sections</h2>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Section</th><th>Hours</th><th>Daily duties</th><th aria-label="Edit" /></tr></thead>
          <tbody>
            {sections.map((s) => (
              <tr key={s.id}>
                <td><span className={`badge tone-${s.tone}`}>{s.name}</span></td>
                <td className="mono">{s.start} – {s.end}</td>
                <td>{s.duties ? 'In-Charge + QC 2 required' : '—'}</td>
                <td><button className="icon-btn sm" aria-label={`Edit ${s.name}`} onClick={() => setSec(s)}><Pencil /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && <CodeForm initial={edit === 'new' ? undefined : edit} onClose={() => setEdit(undefined)} />}
      {sec && <SectionForm initial={sec} onClose={() => setSec(undefined)} />}
    </div>
  )
}
