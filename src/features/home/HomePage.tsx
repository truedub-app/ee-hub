import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  BookOpen, CalendarDays, CheckCircle2, ChevronRight, CircleAlert, Clock, Contact, FileSpreadsheet, Info, Play, ShieldAlert,
  Star, TriangleAlert, UserPlus, X, FileText,
} from 'lucide-react'
import { canSeeBlacklist, useHub, usePerms } from '../../data/store'
import { greeting, hm, longDate, relativeDateTime, today, formatDuration } from '../../lib/dates'
import { Badge, Empty, cx, Glyph } from '../../ui/primitives'
import { dayModel, cellOf, bandOf, hoursOf } from '../rota/model'
import { useRotaCtx } from '../rota/useRota'
import { openCellEditor } from '../rota/CellEditor'
import { useNotices } from './notices'
import { useSearchPalette } from '../search/SearchPalette'
import type { Section } from '../../data/types'
import { InstallBanner } from '../install/Install'
import './home.css'

function currentBand(sections: Section[], now = new Date()): string | undefined {
  const m = now.getHours() * 60 + now.getMinutes()
  for (const s of sections) {
    const a = hm(s.start)
    let b = hm(s.end)
    if (b <= a) b += 24 * 60
    if ((m >= a && m < b) || (m + 24 * 60 >= a && m + 24 * 60 < b)) return s.id
  }
  return undefined
}

function TodayCard() {
  const ctx = useRotaCtx()
  const meId = useHub((s) => s.local.staffId)
  const navigate = useNavigate()
  const t = today()
  if (!meId) {
    return (
      <section className="card home-today" aria-label="Today's shift">
        <div className="eyebrow">Today</div>
        <p className="muted">Pick your name to see your own shift here.</p>
        <button className="btn btn-sm" onClick={() => navigate('/settings#profile')}>Choose my profile</button>
      </section>
    )
  }
  const a = cellOf(ctx.idx, meId, t)
  const code = a ? ctx.idx.codes.get(a.code) : undefined
  const band = bandOf(ctx.idx, a)
  const sec = ctx.sections.find((s) => s.id === band) ?? ctx.sections.find((s) => s.id === ctx.idx.staff.get(meId)?.section)
  const duty = band ? ctx.idx.duty.get(`${t}|${band}`) : undefined
  const working = code?.kind === 'work' || code?.kind === 'duty'
  const inCharge = duty?.inChargeId === meId
  const qc2Name = duty?.qc2Id ? ctx.idx.staff.get(duty.qc2Id)?.name : undefined
  const icName = duty?.inChargeId ? ctx.idx.staff.get(duty.inChargeId)?.name : undefined
  const tone = a?.code === 'Q' ? 'qc2' : working ? sec?.tone : code?.tone ?? 'unassigned'
  return (
    <section className={cx('card home-today stripe', `tone-${tone}`)} aria-label="Today's shift">
      <div className="row"><span className="eyebrow">Today</span><span className="spacer" /><span className="small faint">{longDate(t)}</span></div>
      {!a ? (
        <p className="big">Not on the rota today</p>
      ) : (
        <>
          <p className="big">
            {working ? <>{sec?.name} <span className="code-pill" style={{ verticalAlign: 'middle' }}>{a.code}</span></> : code?.label ?? a.code}
          </p>
          {working && <p className="mono muted">{hoursOf(ctx.idx, ctx.sections, a)}</p>}
          {working && (
            <div className="col" style={{ gap: 6, marginTop: 6 }}>
              {inCharge ? <Badge tone="incharge" lg><Star /> You are In Charge</Badge> : icName ? <span className="small"><Star width={14} style={{ color: 'var(--incharge)', verticalAlign: -2 }} /> In Charge: <strong>{icName}</strong></span> : <span className="small" style={{ color: 'var(--warn)' }}>In Charge not assigned</span>}
              {a.code === 'Q' || duty?.qc2Id === meId ? <Badge tone="qc2" lg><CheckCircle2 /> You are on QC 2 & Missing List</Badge> : qc2Name ? <span className="small"><CheckCircle2 width={14} style={{ color: 'var(--qc2)', verticalAlign: -2 }} /> QC 2: <strong>{qc2Name}</strong></span> : null}
            </div>
          )}
        </>
      )}
      <button className="btn btn-sm btn-ghost" style={{ alignSelf: 'flex-start', marginTop: 'auto' }} onClick={() => navigate('/rota?scope=me')}>My schedule <ChevronRight /></button>
    </section>
  )
}

function Coverage() {
  const ctx = useRotaCtx()
  const navigate = useNavigate()
  const t = today()
  const bands = dayModel(t, ctx, ctx.idx)
  const now = currentBand(ctx.sections)
  if (!ctx.idx.byDate.has(t)) {
    return (
      <section className="card" aria-label="Department coverage">
        <div className="card-head"><span className="eyebrow">Department coverage</span></div>
        <Empty icon={<CalendarDays />} title="No rota for today">The loaded rota covers {ctx.idx.dates[0] ?? '—'} to {ctx.idx.dates[ctx.idx.dates.length - 1] ?? '—'}.</Empty>
      </section>
    )
  }
  return (
    <section className="card" aria-label="Department coverage">
      <div className="card-head"><span className="eyebrow">Department coverage · today</span><button className="btn btn-sm btn-ghost" onClick={() => navigate('/rota')}>Open rota <ChevronRight /></button></div>
      <div className="coverage">
        {bands.map((b) => (
          <button key={b.section.id} className={cx('cov-row', `tone-${b.section.tone}`, now === b.section.id && 'now')} onClick={() => navigate(`/rota?sec=${b.section.id}`)}>
            <span className="cov-name">{b.section.name}{now === b.section.id && <Badge tone="accent" caps>Now</Badge>}</span>
            <span className="cov-hours mono">{b.section.start}–{b.section.end}</span>
            <span className="cov-count"><strong>{b.working.length}</strong> working · <span className={cx(b.absent.length > 0 && 'abs')}>{b.absent.length} absent</span></span>
            {b.section.duties && (
              <span className="cov-duty">
                <span className={cx('ic', !b.inCharge && 'missing')}><Star width={13} /> {b.inCharge?.name ?? 'No In-Charge'}</span>
                <span className={cx('qc', !b.qc2 && 'missing')}><CheckCircle2 width={13} /> {b.qc2?.name ?? 'No QC 2'}</span>
              </span>
            )}
          </button>
        ))}
      </div>
    </section>
  )
}

function QuickActions() {
  const navigate = useNavigate()
  const perms = usePerms()
  const showBl = useHub(() => canSeeBlacklist())
  const palette = useSearchPalette()
  const actions = [
    { icon: <CalendarDays />, label: 'View today’s rota', on: () => navigate('/rota') },
    perms.editRota && { icon: <UserPlus />, label: 'Assign shift', on: () => { navigate('/rota'); openCellEditor({ date: today() }) } },
    { icon: <BookOpen />, label: 'Open Work Manual', on: () => navigate('/manual') },
    { icon: <Contact />, label: 'Search contacts', on: () => navigate('/contacts?focusSearch=1') },
    perms.importRota && { icon: <FileSpreadsheet />, label: 'Import new rota', on: () => navigate('/rota/import') },
    showBl && { icon: <ShieldAlert />, label: 'Check the blacklist', on: () => navigate('/blacklist'), tone: 'alert' },
    { icon: <FileText />, label: 'Search everything', on: palette.open },
  ].filter(Boolean) as { icon: React.ReactNode; label: string; on: () => void; tone?: string }[]
  return (
    <section className="card" aria-label="Quick actions">
      <div className="card-head"><span className="eyebrow">Quick actions</span></div>
      <div className="quick">
        {actions.map((a) => (
          <button key={a.label} className={cx('quick-btn', a.tone && `tone-${a.tone}`)} onClick={a.on}>
            {a.icon}<span>{a.label}</span>
          </button>
        ))}
      </div>
    </section>
  )
}

function Recent() {
  const navigate = useNavigate()
  const recent = useHub((s) => s.local.recent)
  const docs = useHub((s) => s.data.docs)
  const categories = useHub((s) => s.data.categories)
  const list = useMemo(() => {
    const byId = new Map(docs.filter((d) => !d.deleted).map((d) => [d.id, d]))
    const r = recent.map((x) => byId.get(x.id)).filter(Boolean)
    if (r.length >= 3) return { title: 'Recently opened', items: r.slice(0, 5) }
    const featured = ['vid-qc2', 'user-guide', 'segmentation-map', 'proc-01', 'proc-09'].map((id) => byId.get(id)).filter(Boolean)
    return { title: r.length ? 'Recently opened' : 'Start here', items: [...r, ...featured.filter((f) => !r.includes(f))].slice(0, 5) }
  }, [recent, docs])
  return (
    <section className="card" aria-label={list.title}>
      <div className="card-head"><span className="eyebrow">{list.title}</span><button className="btn btn-sm btn-ghost" onClick={() => navigate('/manual')}>All documents <ChevronRight /></button></div>
      <div className="col" style={{ padding: 8, gap: 2 }}>
        {list.items.map((d) => {
          const cat = categories.find((c) => c.id === d!.category)
          return (
            <button key={d!.id} className={cx('recent-row', `tone-${cat?.tone}`)} onClick={() => navigate(`/manual/${d!.id}`)}>
              <span className="glyph">{d!.kind === 'video' ? <Play width={16} /> : <Glyph name={cat?.glyph ?? 'file'} size={16} />}</span>
              <span className="col grow" style={{ gap: 0, minWidth: 0 }}>
                <span className="truncate" style={{ fontWeight: 560 }}>{d!.title}</span>
                <span className="tiny faint">{cat?.name}{d!.duration ? ` · ${formatDuration(d!.duration)}` : d!.pageCount ? ` · ${d!.pageCount} pages` : ''}</span>
              </span>
              <ChevronRight width={16} className="faint" />
            </button>
          )
        })}
      </div>
    </section>
  )
}

function Notices() {
  const notices = useNotices()
  const navigate = useNavigate()
  const setLocal = useHub((s) => s.setLocal)
  const dismissed = useHub((s) => s.local.dismissed)
  return (
    <section className="card" aria-label="Important notices">
      <div className="card-head"><span className="eyebrow">Important notices</span><span className="spacer" />{notices.length > 0 && <Badge tone={notices.some((n) => n.tone === 'alert') ? 'alert' : 'warn'}>{notices.length}</Badge>}</div>
      {notices.length === 0 ? (
        <p className="small muted" style={{ padding: 18 }}>All clear — nothing needs attention.</p>
      ) : (
        <ul className="notices" role="list">
          {notices.map((n) => (
            <li key={n.id} className={cx('notice-row', `tone-${n.tone === 'info' ? 'accent' : n.tone}`)}>
              {n.tone === 'alert' ? <CircleAlert /> : n.tone === 'warn' ? <TriangleAlert /> : <Info />}
              <button className="grow" onClick={() => n.to && navigate(n.to)}>{n.text}</button>
              <button className="icon-btn sm" aria-label="Dismiss" onClick={() => setLocal({ dismissed: [...dismissed, n.id] })}><X /></button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function HomePage() {
  const userName = useHub((s) => s.local.userName)
  const lastDataAt = useHub((s) => s.local.lastDataAt)
  const version = useHub((s) => s.local.packVersion)
  const online = useHub((s) => s.net.online)
  const first = userName?.split(' ')[0]
  return (
    <div className="home">
      <header className="home-hero">
        <div className="col" style={{ gap: 6 }}>
          <span className="eyebrow">Editing &amp; Editorial Hub</span>
          <h1>{greeting()}{first ? `, ${first}` : ''}</h1>
          <div className="row-wrap small muted">
            <Badge tone={online ? 'qc2' : 'warn'} caps>{online ? 'Local mode' : 'Offline mode'}</Badge>
            {lastDataAt && <span className="row" style={{ gap: 4 }}><Clock width={14} /> Last updated: {relativeDateTime(lastDataAt)}</span>}
            {version && <span>· Data version {version}</span>}
          </div>
        </div>
      </header>
      <InstallBanner />
      <div className="home-grid">
        <TodayCard />
        <Coverage />
        <Notices />
        <QuickActions />
        <Recent />
      </div>
    </div>
  )
}
