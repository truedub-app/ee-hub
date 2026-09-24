import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Copy, Heart, Mail, Pencil, Phone, Plus, Share2, Star, Users, CheckCircle2, Trash2 } from 'lucide-react'
import { useHub, usePerms } from '../../data/store'
import type { Contact, Staff } from '../../data/types'
import { CONTACT_TEAMS } from '../../data/defaults'
import { fold, slug, uid } from '../../lib/text'
import { addDays, shortDay, today } from '../../lib/dates'
import { Avatar, Badge, Chip, Empty, Field, Modal, SearchInput, cx } from '../../ui/primitives'
import { confirmDialog, toast } from '../../ui/toast'
import { bandOf, cellOf, dutyRoleOf } from '../rota/model'
import { useRotaCtx } from '../rota/useRota'
import './contacts.css'

const TEAM_TONE: Record<string, string> = {
  'Editing & Editorial': 'accent', 'TV Services': 'cat-editorial', Acquisition: 'cat-scheduling', 'Scheduling & Planning': 'cat-workflow',
  'Tech Ops': 'cat-editing', Transmission: 'cat-compliance', IT: 'cat-subtitling', Production: 'cat-walkthroughs', Other: 'cat-rules',
}

function copyText(text: string, what = 'Copied') {
  void navigator.clipboard?.writeText(text).then(() => toast(what), () => toast('Copy failed', 'alert'))
}

function vcard(c: { name: string; jobTitle?: string; team?: string; extension?: string; email?: string; mobile?: string }) {
  return ['BEGIN:VCARD', 'VERSION:3.0', `FN:${c.name}`, c.jobTitle && `TITLE:${c.jobTitle}`, c.team && `ORG:MBC;${c.team}`, c.extension && `TEL;TYPE=WORK:${c.extension}`, c.mobile && `TEL;TYPE=CELL:${c.mobile}`, c.email && `EMAIL:${c.email}`, 'END:VCARD'].filter(Boolean).join('\n')
}

async function share(c: Contact | Staff, team?: string) {
  const text = [c.name, c.jobTitle, team, c.extension && `Ext. ${c.extension}`, c.email].filter(Boolean).join('\n')
  if (navigator.share) {
    try {
      await navigator.share({ title: c.name, text })
      return
    } catch {
      /* cancelled */
    }
  }
  copyText(`${text}\n\n${vcard({ ...c, team })}`, 'Contact copied (vCard)')
}

function ExtLinks({ ext }: { ext?: string }) {
  if (!ext) return null
  return (
    <span className="row" style={{ gap: 6 }}>
      {ext.split(/[/,]/).map((e) => e.trim()).filter(Boolean).map((e) => (
        <a key={e} className="ext" href={`tel:${e}`} aria-label={`Call extension ${e}`}><Phone width={14} /> {e}</a>
      ))}
    </span>
  )
}

function ContactCard({ c, fav, focus }: { c: Contact; fav: boolean; focus: boolean }) {
  const perms = usePerms()
  const toggleFavorite = useHub((s) => s.toggleFavorite)
  const [edit, setEdit] = useState(false)
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    if (focus) ref.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [focus])
  return (
    <article ref={ref} className={cx('contact-card', `tone-${TEAM_TONE[c.team] ?? 'accent'}`, focus && 'focus')}>
      <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
        <Avatar name={c.name} tone={TEAM_TONE[c.team] ?? 'accent'} round={c.kind === 'group'} />
        <div className="col grow" style={{ gap: 2, minWidth: 0 }}>
          <strong className="c-name">{c.name}{c.kind === 'group' && <Badge tone="muted">Group</Badge>}</strong>
          {c.jobTitle && <span className="small muted">{c.jobTitle}</span>}
          <span className="tiny faint">{c.team}{c.subTeam && c.subTeam !== c.team ? ` · ${c.subTeam}` : ''}</span>
        </div>
        <button className={cx('icon-btn sm', fav && 'fav')} aria-pressed={fav} aria-label={fav ? 'Remove from favourites' : 'Add to favourites'} onClick={() => toggleFavorite(c.id)}>
          <Heart fill={fav ? 'currentColor' : 'none'} />
        </button>
      </div>
      {c.channels.length > 0 && (
        <div className="row-wrap" style={{ gap: 6 }}>{c.channels.map((ch) => <Badge key={ch} tone="muted">{ch}</Badge>)}</div>
      )}
      {c.responsibility && <p className="small" style={{ color: 'var(--text-2)' }}>{c.responsibility}</p>}
      <div className="contact-actions">
        <ExtLinks ext={c.extension} />
        {c.email && <a className="ext" href={`mailto:${c.email}`} aria-label={`Email ${c.name}`}><Mail width={14} /> <span className="truncate">{c.email}</span></a>}
        <span className="spacer" />
        {c.email && <button className="icon-btn sm" aria-label="Copy email" title="Copy email" onClick={() => copyText(c.email!, 'Email copied')}><Copy /></button>}
        <button className="icon-btn sm" aria-label="Share contact" title="Share" onClick={() => void share(c, c.team)}><Share2 /></button>
        {perms.editContacts && <button className="icon-btn sm" aria-label="Edit contact" title="Edit" onClick={() => setEdit(true)}><Pencil /></button>}
      </div>
      {edit && <ContactForm initial={c} onClose={() => setEdit(false)} />}
    </article>
  )
}

function ContactForm({ initial, onClose }: { initial?: Contact; onClose: () => void }) {
  const upsert = useHub((s) => s.upsert)
  const remove = useHub((s) => s.remove)
  const audit = useHub((s) => s.audit)
  const [c, setC] = useState<Contact>(initial ?? { id: '', name: '', kind: 'person', team: 'Other', channels: [], updatedAt: 0 })
  const [channels, setChannels] = useState((initial?.channels ?? []).join(', '))
  const save = () => {
    const id = c.id || `ct-${slug(c.name)}-${uid().slice(0, 4)}`
    upsert('contacts', [{ ...c, id, channels: channels.split(',').map((x) => x.trim()).filter(Boolean), updatedAt: Date.now() }])
    audit(initial ? 'contact.edit' : 'contact.add', c.name)
    toast('Contact saved')
    onClose()
  }
  const del = async () => {
    if (!initial) return
    if (!(await confirmDialog({ title: `Delete ${initial.name}?`, body: 'The contact is removed from this device and from the next published data version.', confirm: 'Delete', danger: true }))) return
    remove('contacts', [initial.id])
    audit('contact.delete', initial.name)
    onClose()
  }
  const set = (patch: Partial<Contact>) => setC({ ...c, ...patch })
  return (
    <Modal
      open
      onClose={onClose}
      title={initial ? `Edit ${initial.name}` : 'Add contact'}
      footer={
        <>
          {initial && <button className="btn btn-ghost" style={{ marginRight: 'auto', color: 'var(--alert)' }} onClick={() => void del()}><Trash2 /> Delete</button>}
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={!c.name.trim()}>Save</button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Name" htmlFor="cf-name"><input id="cf-name" className="input" value={c.name} onChange={(e) => set({ name: e.target.value })} autoFocus /></Field>
        <Field label="Job title" htmlFor="cf-title"><input id="cf-title" className="input" value={c.jobTitle ?? ''} onChange={(e) => set({ jobTitle: e.target.value })} /></Field>
        <Field label="Team" htmlFor="cf-team">
          <select id="cf-team" className="select" value={c.team} onChange={(e) => set({ team: e.target.value })}>{CONTACT_TEAMS.map((t) => <option key={t}>{t}</option>)}</select>
        </Field>
        <Field label="Sub-team" htmlFor="cf-sub"><input id="cf-sub" className="input" value={c.subTeam ?? ''} onChange={(e) => set({ subTeam: e.target.value })} /></Field>
        <Field label="Extension(s)" htmlFor="cf-ext" hint="Separate several with /"><input id="cf-ext" className="input" value={c.extension ?? ''} onChange={(e) => set({ extension: e.target.value })} inputMode="tel" /></Field>
        <Field label="Mobile" htmlFor="cf-mob"><input id="cf-mob" className="input" value={c.mobile ?? ''} onChange={(e) => set({ mobile: e.target.value })} inputMode="tel" /></Field>
        <Field label="Email" htmlFor="cf-email"><input id="cf-email" className="input" type="email" value={c.email ?? ''} onChange={(e) => set({ email: e.target.value })} /></Field>
        <Field label="Type" htmlFor="cf-kind">
          <select id="cf-kind" className="select" value={c.kind} onChange={(e) => set({ kind: e.target.value as Contact['kind'] })}><option value="person">Person</option><option value="group">Group mailbox / desk</option></select>
        </Field>
      </div>
      <div className="col" style={{ gap: 14, marginTop: 14 }}>
        <Field label="Channels" htmlFor="cf-ch" hint="Comma separated, e.g. MBC 1, MBC Drama"><input id="cf-ch" className="input" value={channels} onChange={(e) => setChannels(e.target.value)} /></Field>
        <Field label="Responsibility / areas covered" htmlFor="cf-resp"><textarea id="cf-resp" className="textarea" value={c.responsibility ?? ''} onChange={(e) => set({ responsibility: e.target.value })} /></Field>
      </div>
    </Modal>
  )
}

function StaffCard({ s, onOpen }: { s: Staff; onOpen: () => void }) {
  const ctx = useRotaCtx()
  const t = today()
  const sec = ctx.sections.find((x) => x.id === s.section)
  const a = cellOf(ctx.idx, s.id, t)
  const code = a ? ctx.idx.codes.get(a.code) : undefined
  const role = dutyRoleOf(ctx.idx, s.id, t)
  return (
    <button className={cx('contact-card staff', `tone-${sec?.tone ?? 'accent'}`)} onClick={onOpen} style={{ textAlign: 'left' }}>
      <div className="row" style={{ gap: 12 }}>
        <Avatar name={s.name} tone={sec?.tone} />
        <div className="col grow" style={{ gap: 2, minWidth: 0 }}>
          <strong className="c-name">{s.preferredName ?? s.name}</strong>
          <span className="small muted">{[s.jobTitle ?? 'Editor', sec?.name].filter(Boolean).join(' · ')}</span>
        </div>
      </div>
      <div className="row-wrap" style={{ gap: 6 }}>
        {(sec || a) && (
          <Badge tone={code?.kind === 'work' || code?.kind === 'duty' ? ctx.sections.find((x) => x.id === bandOf(ctx.idx, a))?.tone ?? 'accent' : code?.tone ?? 'muted'}>
            Today: {code ? (code.kind === 'work' || code.kind === 'duty' ? ctx.sections.find((x) => x.id === bandOf(ctx.idx, a))?.name ?? code.label : code.label) : 'No entry'}
          </Badge>
        )}
        {role.inCharge && <Badge tone="incharge"><Star /> In Charge</Badge>}
        {(role.qc2 || a?.code === 'Q') && <Badge tone="qc2"><CheckCircle2 /> QC 2</Badge>}
        {s.review && <Badge tone="warn">Needs review</Badge>}
      </div>
      <div className="contact-actions">
        {s.extension ? <span className="ext"><Phone width={14} /> {s.extension}</span> : <span className="tiny faint">No extension on file</span>}
      </div>
    </button>
  )
}

export function StaffProfile({ id, onClose }: { id: string; onClose: () => void }) {
  const ctx = useRotaCtx()
  const perms = usePerms()
  const navigate = useNavigate()
  const s = ctx.idx.staff.get(id)
  if (!s) return null
  const sec = ctx.sections.find((x) => x.id === s.section)
  const days = Array.from({ length: 7 }, (_, i) => addDays(today(), i))
  return (
    <Modal open onClose={onClose} title="Team profile" footer={
      <>
        {perms.editStaff && <button className="btn" onClick={() => navigate(`/admin/staff?edit=${encodeURIComponent(s.id)}`)}><Pencil /> Edit profile</button>}
        <button className="btn" onClick={() => void share(s, 'Editing & Editorial')}><Share2 /> Share</button>
        {sec && <button className="btn btn-primary" onClick={() => navigate(`/rota?view=week&staff=${encodeURIComponent(s.id)}`)}>Open in rota</button>}
      </>
    }>
      <div className="col" style={{ gap: 16 }}>
        <div className="row" style={{ gap: 14 }}>
          <Avatar name={s.name} size="lg" tone={sec?.tone} />
          <div className="col" style={{ gap: 2 }}>
            <h2 style={{ fontSize: '1.2rem' }}>{s.name}</h2>
            <span className="muted">{s.jobTitle ?? 'Editor'} · Editing &amp; Editorial</span>
            <div className="row-wrap" style={{ marginTop: 4 }}>
              {s.inChargeEligible && <Badge tone="incharge"><Star /> In-Charge eligible</Badge>}
              {s.qc2Eligible && <Badge tone="qc2"><CheckCircle2 /> QC 2 eligible</Badge>}
              {!s.active && <Badge tone="alert">Inactive</Badge>}
            </div>
          </div>
        </div>
        <dl className="kv">
          {s.preferredName && <><dt>Preferred name</dt><dd>{s.preferredName}</dd></>}
          <dt>Home section</dt><dd>{sec ? <>{sec.name} <span className="mono faint">({sec.start}–{sec.end})</span></> : <span className="faint">Not on the rota</span>}</dd>
          <dt>Extension</dt><dd>{s.extension ? <ExtLinks ext={s.extension} /> : <span className="faint">—</span>}</dd>
          <dt>Email</dt><dd>{s.email ? <a href={`mailto:${s.email}`}>{s.email}</a> : <span className="faint">—</span>}</dd>
          {s.mobile && <><dt>Mobile</dt><dd><a href={`tel:${s.mobile}`}>{s.mobile}</a></dd></>}
          <dt>Skills</dt><dd>{s.skills?.length ? s.skills.join(', ') : <span className="faint">—</span>}</dd>
          <dt>Languages</dt><dd>{s.languages?.length ? s.languages.join(', ') : <span className="faint">—</span>}</dd>
          {s.employeeId && <><dt>Employee ID</dt><dd className="mono">{s.employeeId}</dd></>}
          {s.aliases.length > 0 && <><dt>Rota spellings</dt><dd className="small muted">{s.aliases.join(' · ')}</dd></>}
        </dl>
        {s.review && <p className="small" style={{ color: 'var(--warn)' }}>⚠ {s.review}</p>}
        {sec && <div>
          <div className="eyebrow" style={{ marginBottom: 8 }}>Next 7 days</div>
          <div className="row-wrap" style={{ gap: 6 }}>
            {days.map((d) => {
              const a = cellOf(ctx.idx, s.id, d)
              const code = a ? ctx.idx.codes.get(a.code) : undefined
              const band = ctx.sections.find((x) => x.id === bandOf(ctx.idx, a))
              const tone = a?.code === 'Q' ? 'qc2' : code?.kind === 'work' ? band?.tone : code?.tone ?? 'unassigned'
              return (
                <span key={d} className={`badge lg tone-${tone}`} title={code?.label}>
                  {shortDay(d)} · {a ? a.code : '—'}
                </span>
              )
            })}
          </div>
        </div>}
      </div>
    </Modal>
  )
}

export function ContactsPage() {
  const { staffId } = useParams()
  const [sp, setSp] = useSearchParams()
  const navigate = useNavigate()
  const perms = usePerms()
  const contacts = useHub((s) => s.data.contacts)
  const staff = useHub((s) => s.data.staff)
  const favorites = useHub((s) => s.local.favorites)
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState(false)
  const tab = sp.get('tab') === 'team' || staffId ? 'team' : 'network'
  const team = sp.get('team') ?? ''
  const focus = sp.get('focus') ?? undefined
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (sp.get('focusSearch')) searchRef.current?.focus()
  }, [sp])

  const live = useMemo(() => contacts.filter((c) => !c.deleted), [contacts])
  const teams = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of live) m.set(c.team, (m.get(c.team) ?? 0) + 1)
    return CONTACT_TEAMS.filter((t) => m.has(t)).map((t) => [t, m.get(t)!] as const).concat([...m.entries()].filter(([t]) => !CONTACT_TEAMS.includes(t)))
  }, [live])

  const f = fold(q.trim())
  const matchC = (c: Contact) => !f || [c.name, c.jobTitle, c.team, c.subTeam, c.responsibility, c.extension, c.email, ...c.channels].some((x) => x && fold(x).includes(f))
  const list = live
    .filter((c) => (team === '★' ? favorites.includes(c.id) : !team || c.team === team) && matchC(c))
    .sort((a, b) => Number(favorites.includes(b.id)) - Number(favorites.includes(a.id)) || CONTACT_TEAMS.indexOf(a.team) - CONTACT_TEAMS.indexOf(b.team) || a.name.localeCompare(b.name))
  const staffList = staff
    .filter((s) => !s.deleted && (!f || [s.name, s.preferredName, s.jobTitle, s.extension, s.email, ...(s.skills ?? []), ...(s.languages ?? [])].some((x) => x && fold(x).includes(f))))
    .sort((a, b) => a.section.localeCompare(b.section) || a.name.localeCompare(b.name))

  const setParam = (k: string, v?: string) => {
    const n = new URLSearchParams(sp)
    if (v) n.set(k, v)
    else n.delete(k)
    n.delete('focus')
    n.delete('focusSearch')
    setSp(n, { replace: true })
  }

  return (
    <div>
      <div className="tabs" role="tablist" style={{ marginBottom: 16 }}>
        <button role="tab" aria-selected={tab === 'network'} onClick={() => navigate('/contacts')}>Network directory<span className="count">{live.length}</span></button>
        <button role="tab" aria-selected={tab === 'team'} onClick={() => navigate('/contacts?tab=team')}>Editing &amp; Editorial team<span className="count">{staff.filter((s) => !s.deleted).length}</span></button>
      </div>
      <div className="row-wrap" style={{ marginBottom: 14 }}>
        <div className="grow" style={{ maxWidth: 560 }}>
          <SearchInput inputRef={searchRef} value={q} onChange={setQ} placeholder={tab === 'team' ? 'Search name, skills, extension…' : 'Search name, title, team, channel, extension, email…'} />
        </div>
        {tab === 'network' && perms.editContacts && <button className="btn" onClick={() => setAdding(true)}><Plus /> Add contact</button>}
      </div>
      {tab === 'network' && (
        <>
          <div className="chips scroll" style={{ marginBottom: 16 }} role="group" aria-label="Teams">
            <Chip pressed={!team} onClick={() => setParam('team')} count={live.length}>All teams</Chip>
            <Chip pressed={team === '★'} onClick={() => setParam('team', team === '★' ? undefined : '★')} tone="alert" icon={<Heart />} count={favorites.filter((id) => live.some((c) => c.id === id)).length}>Favourites</Chip>
            {teams.map(([t, n]) => <Chip key={t} tone={TEAM_TONE[t] ?? 'accent'} dot pressed={team === t} onClick={() => setParam('team', team === t ? undefined : t)} count={n}>{t}</Chip>)}
          </div>
          {list.length === 0 ? (
            <Empty icon={<Users />} title={team === '★' ? 'No favourites yet' : 'No contacts found'}>{team === '★' ? 'Tap the heart on a contact to keep it here.' : 'Try another name, team or extension.'}</Empty>
          ) : (
            <div className="contact-grid">{list.map((c) => <ContactCard key={c.id} c={c} fav={favorites.includes(c.id)} focus={focus === c.id} />)}</div>
          )}
          <p className="tiny faint" style={{ marginTop: 16 }}>The directory works offline. Calling and email open your phone or mail app and need normal telephone or network service.</p>
        </>
      )}
      {tab === 'team' && (
        staffList.length === 0 ? <Empty icon={<Users />} title="No team members found" /> : (
          <div className="contact-grid">{staffList.map((s) => <StaffCard key={s.id} s={s} onOpen={() => navigate(`/contacts/staff/${encodeURIComponent(s.id)}`)} />)}</div>
        )
      )}
      {adding && <ContactForm onClose={() => setAdding(false)} />}
      {staffId && <StaffProfile id={decodeURIComponent(staffId)} onClose={() => navigate('/contacts?tab=team')} />}
    </div>
  )
}
