import { CheckCircle2, CircleAlert, Star, TriangleAlert, UserPlus } from 'lucide-react'
import { usePerms } from '../../data/store'
import type { ISODate } from '../../data/types'
import { Avatar, Badge, Empty, Notice, cx } from '../../ui/primitives'
import { toast } from '../../ui/toast'
import { dayModel, dutyEligibility, hoursOf, type BandDay, type Person } from './model'
import { openCellEditor, cellPressHandlers } from './CellEditor'
import { saveDuty, useRotaCtx } from './useRota'
import type { RotaFilter } from './RotaPage'

export function DutyBoard({ date, bands }: { date: ISODate; bands: BandDay[] }) {
  const perms = usePerms()
  const ctx = useRotaCtx()
  const withDuties = bands.filter((b) => b.section.duties)
  if (!withDuties.length) return null
  return (
    <div className="duty-board" aria-label="Duty assignment board">
      {withDuties.map((b) => {
        const choose = (role: 'inChargeId' | 'qc2Id', id: string) => {
          if (id) {
            const e = dutyEligibility(date, b.section.id, id, ctx, ctx.idx)
            if (!e.ok) return toast(`Not allowed: ${e.reason}`, 'alert')
            for (const ob of bands) {
              if (ob.section.id !== b.section.id && (ob.duty?.inChargeId === id || ob.duty?.qc2Id === id)) {
                return toast(`${ctx.idx.staff.get(id)?.name} already holds a duty on ${ob.section.name}`, 'alert')
              }
            }
          }
          saveDuty(date, b.section.id, { [role]: id || undefined })
        }
        const options = (role: 'inChargeId' | 'qc2Id') => {
          const other = role === 'inChargeId' ? b.duty?.qc2Id : b.duty?.inChargeId
          const eligible = b.working.filter((p) => role !== 'inChargeId' || !ctx.staff.some((s) => s.inChargeEligible) || p.staff.inChargeEligible || p.staff.id === b.duty?.inChargeId)
          return eligible.map((p) => (
            <option key={p.staff.id} value={p.staff.id}>
              {p.staff.name}{p.staff.id === other ? (role === 'inChargeId' ? ' — also QC 2' : ' — also In-Charge') : ''}{p.a?.code === 'Q' && role === 'qc2Id' ? ' · on QC 2' : ''}
            </option>
          ))
        }
        const errs = b.issues.filter((i) => i.level === 'error')
        return (
          <section key={b.section.id} className={cx('card duty-band', `tone-${b.section.tone}`)} aria-label={`${b.section.name} duties`}>
            <div className="band-title">
              <strong>{b.section.name}</strong>
              <span className="hours">{b.section.start} – {b.section.end}</span>
            </div>
            {(['inChargeId', 'qc2Id'] as const).map((role) => {
              const ic = role === 'inChargeId'
              const holder = ic ? b.inCharge : b.qc2
              const id = `duty-${date}-${b.section.id}-${role}`
              return (
                <div className="duty-row" key={role}>
                  <label className={cx('role', ic ? 'ic' : 'qc')} htmlFor={id}>
                    {ic ? <Star /> : <CheckCircle2 />}
                    {ic ? 'In Charge' : 'QC 2 Duty'}
                  </label>
                  {perms.editRota ? (
                    <select
                      id={id}
                      className={cx('select duty-select', holder ? (ic ? 'ic' : 'qc') : 'missing')}
                      value={holder?.id ?? ''}
                      onChange={(e) => choose(role, e.target.value)}
                    >
                      <option value="">{b.working.length ? '— Not assigned —' : '— Nobody rostered —'}</option>
                      {holder && !b.working.some((p) => p.staff.id === holder.id) && <option value={holder.id}>{holder.name} (not rostered)</option>}
                      {options(role)}
                    </select>
                  ) : (
                    <div className={cx('duty-value', holder ? (ic ? 'ic' : 'qc') : 'missing')}>
                      {holder ? holder.name : 'Not assigned'}
                    </div>
                  )}
                </div>
              )
            })}
            {errs.length > 0 && (
              <div className="duty-issues">
                {errs.map((i, k) => <span key={k} className="err">⛔ {i.message}</span>)}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}

function ShiftCard({ p, band, date, me, dim }: { p: Person; band: BandDay; date: ISODate; me: boolean; dim: boolean }) {
  const ctx = useRotaCtx()
  const perms = usePerms()
  const code = p.a ? ctx.idx.codes.get(p.a.code) : undefined
  const home = ctx.sections.find((s) => s.id === p.staff.section)
  const ic = band.inCharge?.id === p.staff.id
  const qc = band.qc2?.id === p.staff.id || p.a?.code === 'Q'
  const hours = hoursOf(ctx.idx, ctx.sections, p.a)
  return (
    <button
      className={cx('shift-card', `tone-${band.section.tone}`, ic && 'ic', qc && 'qc', me && 'me', dim && 'dim')}
      onClick={() => openCellEditor({ staffId: p.staff.id, date })}
      {...cellPressHandlers({ staffId: p.staff.id, date }, perms.editRota)}
      aria-label={`${p.staff.name}, ${code?.label ?? ''}${ic ? ', In Charge' : ''}${qc ? ', QC 2' : ''}`}
    >
      <Avatar name={p.staff.name} tone={home?.tone} />
      <span className="who">
        <span className="name">
          <span className="truncate">{p.staff.preferredName ?? p.staff.name}</span>
          {ic && <Star className="star" fill="currentColor" aria-hidden />}
          {me && <Badge tone="accent">You</Badge>}
        </span>
        <span className="line">
          <span>{home?.name ?? '—'} · <span className="mono">{p.a?.code}</span></span>
        </span>
        {hours && <span className="hours">{hours}</span>}
        <span className="tags">
          {ic && <Badge tone="incharge" caps><Star /> In Charge</Badge>}
          {qc && <Badge tone="qc2" caps><CheckCircle2 /> QC 2</Badge>}
          {code && code.kind !== 'work' && code.kind !== 'duty' && <Badge tone={code.tone}>{code.label}</Badge>}
          {code?.code === 'REM' && <Badge tone="remote">Remote</Badge>}
          {p.a?.inferred && <Badge tone="accent" title={p.a.inferred}>Band inferred</Badge>}
        </span>
      </span>
    </button>
  )
}

export function DayView({ date, filter, meId }: { date: ISODate; filter: RotaFilter; meId?: string }) {
  const ctx = useRotaCtx()
  const perms = usePerms()
  const hasRota = ctx.idx.dates.length > 0
  const bands = dayModel(date, ctx, ctx.idx)
  const visible = bands.filter((b) => filter.sections.length === 0 || filter.sections.includes(b.section.id))
  const warnings = bands.flatMap((b) => b.issues).filter((i) => i.level === 'warn' && i.message.includes('requires'))
  const onDay = (ctx.idx.byDate.get(date)?.length ?? 0) > 0
  const dimOf = (p: Person, b: BandDay) => {
    const st = filter.status
    if (!st) return false
    if (st === 'incharge') return b.inCharge?.id !== p.staff.id
    if (st === 'qc2') return !(b.qc2?.id === p.staff.id || p.a?.code === 'Q')
    return st !== 'working'
  }
  if (!hasRota) {
    return (
      <Empty icon={<CircleAlert />} title="No rota has been imported yet." action={perms.importRota ? <a className="btn btn-primary" href="#/rota/import">Import the official Excel rota</a> : undefined}>
        Import the official Excel file to begin.
      </Empty>
    )
  }
  if (!onDay) {
    return (
      <Empty icon={<CircleAlert />} title="No rota entries for this day" action={perms.editRota ? <button className="btn" onClick={() => openCellEditor({ date })}><UserPlus /> Assign a shift</button> : undefined}>
        The imported rota covers {ctx.idx.dates[0]} to {ctx.idx.dates[ctx.idx.dates.length - 1]}.
      </Empty>
    )
  }
  return (
    <div>
      {warnings.length > 0 && (
        <div className="incomplete-banner">
          <Notice tone="warn" icon={<TriangleAlert />}>
            <strong>Incomplete day.</strong> {warnings.map((w) => w.message).join(' · ')}
          </Notice>
        </div>
      )}
      <DutyBoard date={date} bands={bands} />
      {visible.map((b) => {
        const people = b.working
        const showAbsent = !filter.status || filter.status === 'absent' || filter.status === 'off'
        return (
          <section key={b.section.id} className={cx('band-section', `tone-${b.section.tone}`)} aria-label={`${b.section.name} band`}>
            <div className="band-head">
              <h2>{b.section.name}</h2>
              <span className="meta mono">{b.section.start} – {b.section.end}</span>
              <span className="meta">{people.length} staff{b.absent.length ? ` · ${b.absent.length} absent` : ''}</span>
              <span className="duty-tags">
                {b.section.duties && (b.inCharge ? <Badge tone="incharge"><Star /> In Charge: {b.inCharge.name}</Badge> : <Badge tone="alert"><TriangleAlert /> No In-Charge</Badge>)}
                {b.section.duties && (b.qc2 ? <Badge tone="qc2"><CheckCircle2 /> QC 2: {b.qc2.name}</Badge> : <Badge tone="alert"><TriangleAlert /> No QC 2</Badge>)}
              </span>
            </div>
            {filter.status !== 'absent' && filter.status !== 'off' && (
              <div className="cards">
                {people.map((p) => <ShiftCard key={p.staff.id} p={p} band={b} date={date} me={p.staff.id === meId} dim={dimOf(p, b)} />)}
                {people.length === 0 && <p className="small muted">Nobody rostered on this band.</p>}
              </div>
            )}
            {showAbsent && (b.absent.length > 0 || (filter.status === 'off' && b.off.length > 0)) && (
              <div className="absent-row" aria-label="Absent or off">
                {(filter.status === 'off' ? b.off : b.absent).map((p) => {
                  const code = ctx.idx.codes.get(p.a?.code ?? '')
                  return (
                    <button key={p.staff.id} className={cx('person-chip', `tone-${code?.tone}`)} onClick={() => openCellEditor({ staffId: p.staff.id, date })}>
                      <Avatar name={p.staff.name} size="sm" round tone={code?.tone} />
                      {p.staff.name} <span className="code-pill" style={{ height: 20 }}>{code?.code}</span>
                    </button>
                  )
                })}
                {filter.status !== 'off' && b.off.length > 0 && <span className="small faint" style={{ alignSelf: 'center' }}>{b.off.length} off</span>}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}
