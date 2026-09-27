import { useNavigate } from 'react-router-dom'
import { CalendarDays, CheckCircle2, ChevronRight, CircleAlert, Clock, Info, Star, TriangleAlert, X } from 'lucide-react'
import { useHub } from '../../data/store'
import { greeting, hm, longDate, relativeDateTime, shortDay, today } from '../../lib/dates'
import { Badge, Empty, cx } from '../../ui/primitives'
import { dayModel, cellOf, bandOf, hoursOf } from '../rota/model'
import { useRotaCtx, useRotaToday } from '../rota/useRota'
import { useNotices } from './notices'
import type { Section } from '../../data/types'
import { InstallBanner } from '../install/Install'
import { MbcLogo } from '../../ui/MbcLogo'
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
  const t = useRotaToday()
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
  // after midnight the rota day is still yesterday (night shift); show the shift coming up in the morning too
  const cal = today()
  const upcoming = cal !== t ? cellOf(ctx.idx, meId, cal) : undefined
  const upCode = upcoming ? ctx.idx.codes.get(upcoming.code) : undefined
  const upWorking = upCode?.kind === 'work' || upCode?.kind === 'duty'
  const upSec = ctx.sections.find((s) => s.id === bandOf(ctx.idx, upcoming))
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
      {upcoming && upWorking && (
        <p className="small muted" style={{ marginTop: 6 }}>
          Coming up: <strong>{shortDay(cal)}</strong> · {upSec?.name ?? upCode?.label} <span className="mono">{hoursOf(ctx.idx, ctx.sections, upcoming)}</span>
        </p>
      )}
      <button className="btn btn-sm btn-ghost" style={{ alignSelf: 'flex-start', marginTop: 'auto' }} onClick={() => navigate('/rota?scope=me')}>My schedule <ChevronRight /></button>
    </section>
  )
}

function Coverage() {
  const ctx = useRotaCtx()
  const navigate = useNavigate()
  const t = useRotaToday()
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
          <div className="mobile-only home-logo"><MbcLogo /></div>
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
      </div>
    </div>
  )
}
