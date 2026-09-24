import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Merge, Pencil, Plus, Star, CheckCircle2, UserX } from 'lucide-react'
import { useHub, usePerms } from '../../data/store'
import type { Staff } from '../../data/types'
import { fold, initials, nameKey, uid } from '../../lib/text'
import { Avatar, Badge, Empty, Field, Modal, SearchInput, Switch, cx } from '../../ui/primitives'
import { confirmDialog, toast } from '../../ui/toast'
import { PageHead } from '../shell/Shell'
import { live } from '../../data/merge'

function StaffForm({ initial, onClose }: { initial?: Staff; onClose: () => void }) {
  const sections = useHub((s) => s.data.sections).filter((s) => !s.deleted)
  const allStaff = useHub((s) => s.data.staff)
  const upsert = useHub((s) => s.upsert)
  const audit = useHub((s) => s.audit)
  const [s, setS] = useState<Staff>(initial ?? { id: '', name: '', initials: '', aliases: [], section: sections[0]?.id ?? '', active: true, updatedAt: 0 })
  const [skills, setSkills] = useState((initial?.skills ?? []).join(', '))
  const [langs, setLangs] = useState((initial?.languages ?? []).join(', '))
  const [aliases, setAliases] = useState((initial?.aliases ?? []).join(', '))
  const set = (p: Partial<Staff>) => setS({ ...s, ...p })
  const list = (v: string) => v.split(',').map((x) => x.trim()).filter(Boolean)
  const dup = !initial && allStaff.some((x) => !x.deleted && nameKey(x.name) === nameKey(s.name))
  const save = () => {
    const rec: Staff = {
      ...s,
      id: s.id || `st-${nameKey(s.name).slice(0, 24)}-${uid().slice(0, 4)}`,
      initials: initials(s.name),
      skills: list(skills), languages: list(langs), aliases: list(aliases),
      review: s.review && (s.extension || s.email) ? undefined : s.review,
      updatedAt: Date.now(),
    }
    upsert('staff', [rec])
    audit(initial ? 'staff.edit' : 'staff.add', rec.name)
    toast('Staff profile saved')
    onClose()
  }
  return (
    <Modal open onClose={onClose} size="wide" title={initial ? `Edit — ${initial.name}` : 'Add staff member'} footer={
      <>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={!s.name.trim() || dup}>Save</button>
      </>
    }>
      <div className="col" style={{ gap: 14 }}>
        {s.review && (
          <div className="notice tone-warn"><span>⚠ {s.review}</span><button className="btn btn-sm" style={{ marginLeft: 'auto' }} onClick={() => set({ review: undefined })}>Mark reviewed</button></div>
        )}
        <div className="form-grid">
          <Field label="Full name" htmlFor="sf-name" error={dup ? 'A staff member with this name already exists' : undefined}><input id="sf-name" className="input" value={s.name} onChange={(e) => set({ name: e.target.value })} autoFocus /></Field>
          <Field label="Preferred name" htmlFor="sf-pref"><input id="sf-pref" className="input" value={s.preferredName ?? ''} onChange={(e) => set({ preferredName: e.target.value || undefined })} /></Field>
          <Field label="Job title" htmlFor="sf-title"><input id="sf-title" className="input" value={s.jobTitle ?? ''} onChange={(e) => set({ jobTitle: e.target.value || undefined })} placeholder="e.g. Senior Editor" /></Field>
          <Field label="Home section" htmlFor="sf-sec">
            <select id="sf-sec" className="select" value={s.section} onChange={(e) => set({ section: e.target.value })}>{sections.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
          </Field>
          <Field label="Extension" htmlFor="sf-ext"><input id="sf-ext" className="input" value={s.extension ?? ''} onChange={(e) => set({ extension: e.target.value || undefined })} inputMode="tel" /></Field>
          <Field label="Email" htmlFor="sf-email"><input id="sf-email" type="email" className="input" value={s.email ?? ''} onChange={(e) => set({ email: e.target.value || undefined })} /></Field>
          <Field label="Mobile" htmlFor="sf-mob"><input id="sf-mob" className="input" value={s.mobile ?? ''} onChange={(e) => set({ mobile: e.target.value || undefined })} inputMode="tel" /></Field>
          <Field label="Employee ID" htmlFor="sf-id"><input id="sf-id" className="input" value={s.employeeId ?? ''} onChange={(e) => set({ employeeId: e.target.value || undefined })} /></Field>
        </div>
        <div className="form-grid">
          <Field label="Skills" htmlFor="sf-skills" hint="Comma separated"><input id="sf-skills" className="input" value={skills} onChange={(e) => setSkills(e.target.value)} placeholder="News, documentaries, Arabic content" /></Field>
          <Field label="Languages" htmlFor="sf-langs"><input id="sf-langs" className="input" value={langs} onChange={(e) => setLangs(e.target.value)} placeholder="Arabic, English, French" /></Field>
          <Field label="Rota spellings (aliases)" htmlFor="sf-al" hint="Names as written in the Excel rota"><input id="sf-al" className="input" value={aliases} onChange={(e) => setAliases(e.target.value)} /></Field>
        </div>
        <div className="row-wrap" style={{ gap: 24 }}>
          <Switch checked={!!s.inChargeEligible} onChange={(v) => set({ inChargeEligible: v })} label="In-Charge eligible" hint="Only eligible staff are offered as In-Charge once anyone is marked" />
          <Switch checked={!!s.qc2Eligible} onChange={(v) => set({ qc2Eligible: v })} label="QC 2 eligible" />
          <Switch checked={s.active} onChange={(v) => set({ active: v })} label="Active" />
        </div>
      </div>
    </Modal>
  )
}

function MergeDialog({ staff, onClose }: { staff: Staff[]; onClose: () => void }) {
  const [from, setFrom] = useState('')
  const [into, setInto] = useState('')
  const st = useHub.getState
  const run = async () => {
    const a = staff.find((s) => s.id === from)
    const b = staff.find((s) => s.id === into)
    if (!a || !b || a.id === b.id) return
    if (!(await confirmDialog({ title: `Merge “${a.name}” into “${b.name}”?`, body: `All rota cells and duties of ${a.name} move to ${b.name}; ${a.name} is removed and kept as an alias for future imports.`, confirm: 'Merge', danger: true }))) return
    const now = Date.now()
    const s = st()
    const rota = s.data.rota.filter((r) => r.staffId === a.id && !r.deleted)
    s.upsert('rota', [
      ...rota.map((r) => ({ ...r, deleted: true, updatedAt: now })),
      ...rota.filter((r) => !s.data.rota.some((x) => x.id === `${b.id}|${r.date}` && !x.deleted)).map((r) => ({ ...r, id: `${b.id}|${r.date}`, staffId: b.id, updatedAt: now })),
    ])
    s.upsert('duties', s.data.duties.filter((d) => d.inChargeId === a.id || d.qc2Id === a.id).map((d) => ({ ...d, inChargeId: d.inChargeId === a.id ? b.id : d.inChargeId, qc2Id: d.qc2Id === a.id ? b.id : d.qc2Id, updatedAt: now })))
    s.upsert('staff', [{ ...b, aliases: [...new Set([...b.aliases, a.name, ...a.aliases])], updatedAt: now }])
    s.remove('staff', [a.id])
    s.audit('staff.merge', `${a.name} → ${b.name}`, `${rota.length} cells`)
    toast('Staff merged')
    onClose()
  }
  return (
    <Modal open onClose={onClose} title="Merge duplicate staff" footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-danger" disabled={!from || !into || from === into} onClick={() => void run()}>Merge</button></>}>
      <div className="form-grid">
        <Field label="Duplicate (will be removed)" htmlFor="m-from"><select id="m-from" className="select" value={from} onChange={(e) => setFrom(e.target.value)}><option value="">Choose…</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <Field label="Keep" htmlFor="m-into"><select id="m-into" className="select" value={into} onChange={(e) => setInto(e.target.value)}><option value="">Choose…</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
      </div>
    </Modal>
  )
}

export function StaffAdmin() {
  const perms = usePerms()
  const [sp, setSp] = useSearchParams()
  const staff = useHub((s) => s.data.staff)
  const sections = useHub((s) => s.data.sections)
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState(false)
  const [merging, setMerging] = useState(false)
  const editId = sp.get('edit')
  const liveStaff = useMemo(() => live(staff).sort((a, b) => a.section.localeCompare(b.section) || a.name.localeCompare(b.name)), [staff])
  const list = liveStaff.filter((s) => !q || fold(`${s.name} ${s.jobTitle ?? ''} ${s.aliases.join(' ')}`).includes(fold(q)))
  if (!perms.editStaff) return <Empty icon={<UserX />} title="Restricted">Only managers and administrators can edit staff.</Empty>
  const editing = editId ? liveStaff.find((s) => s.id === editId) : undefined
  return (
    <div className="col" style={{ gap: 16 }}>
      <PageHead title="Staff" sub="Profiles used by the rota, team directory and duty board." actions={<><button className="btn" onClick={() => setMerging(true)}><Merge /> Merge duplicates</button><button className="btn btn-primary" onClick={() => setAdding(true)}><Plus /> Add staff</button></>} />
      <div style={{ maxWidth: 460 }}><SearchInput value={q} onChange={setQ} placeholder="Search staff" /></div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Name</th><th>Section</th><th>Contact</th><th>Duties</th><th>Status</th><th aria-label="Edit" /></tr></thead>
          <tbody>
            {list.map((s) => {
              const sec = sections.find((x) => x.id === s.section)
              return (
                <tr key={s.id} className={cx(!s.active && 'faint')}>
                  <td><div className="row" style={{ gap: 10 }}><Avatar name={s.name} size="sm" tone={sec?.tone} /><div className="col" style={{ gap: 0 }}><strong>{s.name}</strong><span className="tiny faint">{s.jobTitle ?? '—'}</span></div></div></td>
                  <td>{sec?.name ?? <Badge tone="alert">{s.section}</Badge>}</td>
                  <td className="small">{[s.extension && `Ext ${s.extension}`, s.email].filter(Boolean).join(' · ') || <span className="faint">Missing</span>}</td>
                  <td><div className="row" style={{ gap: 4 }}>{s.inChargeEligible && <Badge tone="incharge"><Star /></Badge>}{s.qc2Eligible && <Badge tone="qc2"><CheckCircle2 /></Badge>}</div></td>
                  <td>{s.review ? <Badge tone="warn" title={s.review}>Review</Badge> : s.active ? <Badge tone="qc2">Active</Badge> : <Badge tone="muted">Inactive</Badge>}</td>
                  <td><button className="icon-btn sm" aria-label={`Edit ${s.name}`} onClick={() => setSp({ edit: s.id })}><Pencil /></button></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {adding && <StaffForm onClose={() => setAdding(false)} />}
      {editing && <StaffForm initial={editing} onClose={() => setSp({})} />}
      {merging && <MergeDialog staff={liveStaff} onClose={() => setMerging(false)} />}
    </div>
  )
}
