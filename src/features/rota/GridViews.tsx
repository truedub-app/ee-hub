import { Fragment, useEffect, useMemo, useRef } from 'react'
import { usePerms } from '../../data/store'
import type { ISODate, Staff } from '../../data/types'
import { isWeekend, today, weekdayShort, weekdayNarrow, fromISO } from '../../lib/dates'
import { fold } from '../../lib/text'
import { Avatar, cx } from '../../ui/primitives'
import { bandOf, cellOf, isOnShift, staffBySection } from './model'
import { cellPressHandlers, openCellEditor } from './CellEditor'
import { useRotaCtx } from './useRota'
import type { RotaFilter } from './RotaPage'

interface GridProps {
  days: ISODate[]
  filter: RotaFilter
  compact?: boolean
  meId?: string
  onlyStaff?: string[]
  highlight?: string
  query?: string
}

export function RotaGrid({ days, filter, compact, meId, onlyStaff, highlight, query }: GridProps) {
  const ctx = useRotaCtx()
  const perms = usePerms()
  const t = today()
  const wrapRef = useRef<HTMLDivElement>(null)
  const groups = useMemo(() => {
    const bySec = staffBySection(ctx, days, ctx.idx)
    const q = fold(query ?? '')
    return ctx.sections
      .filter((s) => filter.sections.length === 0 || filter.sections.includes(s.id))
      .map((s) => ({
        section: s,
        staff: (bySec.get(s.id) ?? []).filter((st) => (!onlyStaff || onlyStaff.includes(st.id)) && (!q || fold(st.name).includes(q))),
      }))
      .filter((g) => g.staff.length > 0 || (!onlyStaff && !q))
  }, [ctx, days, filter.sections, onlyStaff, query])

  // scroll today / highlighted row into view
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const col = el.querySelector<HTMLElement>('th.today')
    if (col) el.scrollLeft = Math.max(0, col.offsetLeft - 260)
    if (highlight) el.querySelector<HTMLElement>(`tr[data-staff="${CSS.escape(highlight)}"]`)?.scrollIntoView({ block: 'center' })
  }, [days, highlight])

  const matches = (staff: Staff, d: ISODate): boolean => {
    const st = filter.status
    if (!st) return true
    const a = cellOf(ctx.idx, staff.id, d)
    const kind = ctx.idx.codes.get(a?.code ?? '')?.kind
    const band = bandOf(ctx.idx, a)
    const duty = band ? ctx.idx.duty.get(`${d}|${band}`) : undefined
    if (st === 'working') return kind === 'work' || kind === 'duty'
    if (st === 'off') return kind === 'rest'
    if (st === 'absent') return kind === 'absence'
    if (st === 'incharge') return duty?.inChargeId === staff.id
    if (st === 'qc2') return duty?.qc2Id === staff.id || a?.code === 'Q'
    return true
  }

  const headcount = (sectionId: string, d: ISODate) =>
    (ctx.idx.byDate.get(d) ?? []).filter((a) => isOnShift(ctx.idx, a) && (bandOf(ctx.idx, a) ?? ctx.idx.staff.get(a.staffId)?.section) === sectionId).length

  const avgHead = (sectionId: string) => {
    const counts = days.map((d) => headcount(sectionId, d)).filter((n) => n > 0)
    return counts.length ? counts.reduce((a, b) => a + b, 0) / counts.length : 0
  }

  return (
    <div className={cx('grid-wrap', compact && 'month')} ref={wrapRef} tabIndex={0} aria-label="Rota grid">
      <table className="rgrid">
        <thead>
          <tr>
            <th className="staff-col" scope="col">Staff</th>
            {days.map((d) => (
              <th key={d} scope="col" className={cx(d === t && 'today', isWeekend(d) && 'weekend')} aria-label={d}>
                <span className="dname">{compact ? weekdayNarrow(d) : weekdayShort(d)}</span>
                <span className="dnum">{fromISO(d).getDate()}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => {
            const avg = avgHead(g.section.id)
            return (
              <Fragment key={g.section.id}>
                <tr className={cx('group-row', `tone-${g.section.tone}`)}>
                  <th colSpan={days.length + 1} scope="colgroup">
                    <span className="group-label">{g.section.name} · <span className="mono">{g.section.start}–{g.section.end}</span> · {g.staff.length} staff</span>
                  </th>
                </tr>
                {g.staff.map((s) => (
                  <tr key={s.id} data-staff={s.id} className={cx(s.id === meId && 'me', s.id === highlight && 'highlight')}>
                    <th className="staff-col" scope="row">
                      <div className="staff-cell">
                        <Avatar name={s.name} size="sm" tone={g.section.tone} />
                        <div className="col" style={{ gap: 0, minWidth: 0 }}>
                          <span className="nm">{s.preferredName ?? s.name}{s.id === meId ? ' (you)' : ''}</span>
                          {!compact && <span className="sub">{s.jobTitle ?? g.section.name}</span>}
                        </div>
                      </div>
                    </th>
                    {days.map((d) => {
                      const a = cellOf(ctx.idx, s.id, d)
                      const code = a ? ctx.idx.codes.get(a.code) : undefined
                      const band = bandOf(ctx.idx, a)
                      const duty = band ? ctx.idx.duty.get(`${d}|${band}`) : undefined
                      const ic = duty?.inChargeId === s.id
                      const qc = duty?.qc2Id === s.id || a?.code === 'Q'
                      const otherBand = band && band !== s.section && code && (code.kind === 'work' || code.kind === 'duty')
                      const kindCls = !a ? 'empty' : code?.kind === 'rest' ? 'rest' : code?.kind === 'absence' ? 'absence' : a.code === 'X' || !code ? 'unknown' : ''
                      const tone = qc ? 'qc2' : otherBand ? ctx.sections.find((x) => x.id === band)?.tone ?? code?.tone : code?.tone ?? 'unassigned'
                      const label = `${s.name}, ${d}: ${code ? code.label : a ? a.code : 'no entry'}${ic ? ', In Charge' : ''}${qc ? ', QC 2' : ''}`
                      const noData = !a && !ctx.idx.byDate.has(d)
                      const text = !a ? (noData ? '' : '·') : compact ? code?.glyph ?? a.code : a.code === 'OFF' ? 'OFF' : a.code
                      return (
                        <td key={d} className={cx(d === t && 'today-col')}>
                          <button
                            className={cx('rcell', `tone-${tone}`, kindCls, noData && 'nodata', ic && 'ic', qc && 'qc', a?.inferred && 'inferred', !matches(s, d) && 'dim')}
                            onClick={() => openCellEditor({ staffId: s.id, date: d })}
                            {...cellPressHandlers({ staffId: s.id, date: d }, perms.editRota)}
                            aria-label={label}
                            title={`${label}${a?.inferred ? ` — ${a.inferred}` : ''}${a?.raw ? ` — imported as “${a.raw}”` : ''}`}
                          >
                            <span className="code">{text}</span>
                            {ic && <span className="mark star" aria-hidden>★</span>}
                            {qc && !ic && !compact && <span className="mark check" aria-hidden>✓</span>}
                          </button>
                        </td>
                      )
                    })}
                  </tr>
                ))}
                {!onlyStaff && (
                  <tr className="count-row">
                    <th className="staff-col" scope="row">{g.section.name} headcount</th>
                    {days.map((d) => {
                      const n = headcount(g.section.id, d)
                      return <td key={d} className={cx(n > 0 && n < Math.floor(avg * 0.75) && 'low')}>{n || ''}</td>
                    })}
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export function Legend() {
  const ctx = useRotaCtx()
  return (
    <div className="legend" aria-label="Legend">
      {ctx.codes.filter((c) => !c.deleted && c.code !== 'X').map((c) => (
        <span className="item" key={c.code}>
          <span className={`sw tone-${c.tone}`}>{c.glyph}</span> {c.label}{c.hours ? ` (${c.hours})` : ''}
        </span>
      ))}
      <span className="item"><span className="sw tone-incharge" style={{ background: 'var(--incharge-soft)' }}>★</span> In Charge</span>
      <span className="item"><span className="sw tone-qc2">✓</span> QC 2 & Missing List</span>
      <span className="item"><span className="sw tone-accent">•</span> Band inferred on import</span>
    </div>
  )
}
