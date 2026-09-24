import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, FileSpreadsheet, Printer, Star, UserPlus, Download } from 'lucide-react'
import { useHub, usePerms } from '../../data/store'
import type { ISODate } from '../../data/types'
import { addDays, addMonths, fromISO, isValidDate, longDate, monthDays, monthLabel, range, shortDay, startOfWeek, today, mediumDate } from '../../lib/dates'
import { Chip, Empty, Segmented, SearchInput, cx } from '../../ui/primitives'
import { downloadBytes } from '../../data/backup'
import { DayView } from './DayView'
import { Legend, RotaGrid } from './GridViews'
import { openCellEditor } from './CellEditor'
import { bandOf, cellOf, dutyRoleOf, hoursOf } from './model'
import { useRotaCtx } from './useRota'
import './rota.css'

export type View = 'day' | 'week' | 'month'
export type StatusFilter = '' | 'working' | 'off' | 'absent' | 'incharge' | 'qc2'
export interface RotaFilter {
  sections: string[]
  status: StatusFilter
}

function validDate(s: string | null): ISODate | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const [y, m, d] = s.split('-').map(Number)
  return isValidDate(y, m, d) ? s : null
}

export function RotaPage() {
  const [sp, setSp] = useSearchParams()
  const perms = usePerms()
  const navigate = useNavigate()
  const ctx = useRotaCtx()
  const meId = useHub((s) => s.local.staffId)
  const weekStart = useHub((s) => s.local.weekStart)
  const [query, setQuery] = useState('')

  const isMobile = typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches
  const view = (sp.get('view') as View) || 'day'
  const scope = sp.get('scope') === 'me' && meId ? 'me' : 'team'
  const date = validDate(sp.get('date')) ?? today()
  const filter: RotaFilter = {
    sections: (sp.get('sec') ?? '').split(',').filter(Boolean),
    status: (sp.get('st') as StatusFilter) || '',
  }
  const highlight = sp.get('staff') ?? undefined

  const set = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(sp)
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === '') next.delete(k)
      else next.set(k, v)
    }
    setSp(next, { replace: true })
  }

  const step = (dir: -1 | 1) => {
    if (view === 'day') set({ date: addDays(date, dir) })
    else if (view === 'week') set({ date: addDays(date, 7 * dir) })
    else set({ date: addMonths(date, dir) })
  }

  const days = useMemo(() => {
    if (view === 'week') return range(startOfWeek(date, weekStart), 7)
    if (view === 'month') return monthDays(date)
    return [date]
  }, [view, date, weekStart])

  const label =
    view === 'day' ? (isMobile ? mediumDate(date) : longDate(date))
      : view === 'week' ? `${shortDay(days[0])} – ${shortDay(days[6])} ${monthLabel(days[6])}`
        : monthLabel(date)

  const toggleSection = (id: string) => {
    const s = new Set(filter.sections)
    if (s.has(id)) s.delete(id)
    else s.add(id)
    set({ sec: [...s].join(',') })
  }

  const exportCsv = () => {
    const rows = [['Staff', 'Section', ...days]]
    for (const s of ctx.staff.filter((x) => !x.deleted && x.active)) {
      rows.push([s.name, ctx.sections.find((x) => x.id === s.section)?.name ?? s.section, ...days.map((d) => {
        const a = cellOf(ctx.idx, s.id, d)
        if (!a) return ''
        const r = dutyRoleOf(ctx.idx, s.id, d)
        return `${a.code}${r.inCharge ? ' (IC)' : ''}${r.qc2 && a.code !== 'Q' ? ' (QC2)' : ''}`
      })])
    }
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n')
    downloadBytes(new TextEncoder().encode('﻿' + csv), `ROTA_${days[0]}_${days[days.length - 1]}.csv`, 'text/csv')
    useHub.getState().audit('rota.export', `${days[0]} → ${days[days.length - 1]}`, 'CSV')
  }

  const hasRota = ctx.idx.dates.length > 0

  return (
    <div>
      <div className="rota-toolbar no-print">
        <div className="date-nav">
          <button className="icon-btn bordered" onClick={() => step(-1)} aria-label="Previous"><ChevronLeft /></button>
          <button className="btn btn-sm" onClick={() => set({ date: undefined })} aria-label="Go to today">Today</button>
          <button className="icon-btn bordered" onClick={() => step(1)} aria-label="Next"><ChevronRight /></button>
          <label className="label" htmlFor="rota-date" style={{ cursor: 'pointer' }}>{label}</label>
          <input
            id="rota-date"
            type="date"
            value={date}
            onChange={(e) => validDate(e.target.value) && set({ date: e.target.value })}
            className="sr-only"
            aria-label="Pick a date"
          />
        </div>
        <div className="spacer" />
        <Segmented<View>
          label="View"
          value={view}
          onChange={(v) => set({ view: v === 'day' ? undefined : v })}
          options={[{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }]}
        />
        {meId && (
          <Segmented
            label="Scope"
            value={scope}
            onChange={(v) => set({ scope: v === 'me' ? 'me' : undefined })}
            options={[{ value: 'me', label: 'My Schedule' }, { value: 'team', label: 'Full Team' }]}
          />
        )}
        <div className="row">
          {perms.editRota && <button className="btn" onClick={() => openCellEditor({ date })}><UserPlus /> <span className="desktop-only">Assign</span></button>}
          {perms.importRota && <button className="btn" onClick={() => navigate('/rota/import')}><FileSpreadsheet /> <span className="desktop-only">Import</span></button>}
          {view !== 'day' && hasRota && (
            <>
              <button className="icon-btn bordered" onClick={exportCsv} aria-label="Export CSV" title="Export to CSV (Excel)"><Download /></button>
              <button className="icon-btn bordered" onClick={() => window.print()} aria-label="Print or save as PDF" title="Print / save as PDF"><Printer /></button>
            </>
          )}
        </div>
      </div>

      <div className="print-only" style={{ marginBottom: 8 }}>
        <strong>Editing &amp; Editorial — Shift ROTA · {label}</strong>
      </div>

      {scope === 'team' && (
        <div className="rota-filters no-print">
          <div className="chips scroll" role="group" aria-label="Filters">
            <Chip pressed={filter.sections.length === 0 && !filter.status} onClick={() => set({ sec: undefined, st: undefined })}>All sections</Chip>
            {ctx.sections.map((s) => (
              <Chip key={s.id} tone={s.tone} dot pressed={filter.sections.includes(s.id)} onClick={() => toggleSection(s.id)}>{s.name}</Chip>
            ))}
            <span style={{ width: 1, background: 'var(--line-2)', margin: '4px 4px' }} aria-hidden />
            <Chip tone="qc2" pressed={filter.status === 'working'} onClick={() => set({ st: filter.status === 'working' ? undefined : 'working' })}>Working</Chip>
            <Chip tone="off" pressed={filter.status === 'off'} onClick={() => set({ st: filter.status === 'off' ? undefined : 'off' })}>Off</Chip>
            <Chip tone="hol" pressed={filter.status === 'absent'} onClick={() => set({ st: filter.status === 'absent' ? undefined : 'absent' })}>Absent</Chip>
            <Chip tone="incharge" icon={<Star />} pressed={filter.status === 'incharge'} onClick={() => set({ st: filter.status === 'incharge' ? undefined : 'incharge' })}>In Charge</Chip>
            <Chip tone="qc2" icon={<CheckCircle2 />} pressed={filter.status === 'qc2'} onClick={() => set({ st: filter.status === 'qc2' ? undefined : 'qc2' })}>QC 2</Chip>
          </div>
        </div>
      )}

      {scope === 'me' && meId ? (
        <MySchedule staffId={meId} days={view === 'day' ? range(date, 14) : days} view={view} />
      ) : view === 'day' ? (
        <DayView date={date} filter={filter} meId={meId} />
      ) : !hasRota ? (
        <Empty icon={<CalendarDays />} title="No rota has been imported yet." action={perms.importRota ? <button className="btn btn-primary" onClick={() => navigate('/rota/import')}>Import the official Excel rota</button> : undefined}>
          Import the official Excel file to begin.
        </Empty>
      ) : (
        <>
          {view === 'month' && (
            <div className="row no-print" style={{ marginBottom: 12, maxWidth: 360 }}>
              <div className="grow"><SearchInput value={query} onChange={setQuery} placeholder="Search staff member" /></div>
            </div>
          )}
          <RotaGrid days={days} filter={filter} compact={view === 'month'} meId={meId} highlight={highlight} query={query} />
          <Legend />
        </>
      )}
    </div>
  )
}

function MySchedule({ staffId, days, view }: { staffId: string; days: ISODate[]; view: View }) {
  const ctx = useRotaCtx()
  const staff = ctx.idx.staff.get(staffId)
  const t = today()
  if (!staff) return <Empty icon={<CalendarDays />} title="Your profile isn’t on the rota">Pick your name in Settings → Profile.</Empty>
  if (view !== 'day') {
    return (
      <>
        <RotaGrid days={days} filter={{ sections: [], status: '' }} compact={view === 'month'} meId={staffId} onlyStaff={[staffId]} />
        <Legend />
      </>
    )
  }
  return (
    <div className="my-days">
      {days.map((d) => {
        const a = cellOf(ctx.idx, staffId, d)
        const code = a ? ctx.idx.codes.get(a.code) : undefined
        const band = bandOf(ctx.idx, a)
        const sec = ctx.sections.find((s) => s.id === band)
        const role = dutyRoleOf(ctx.idx, staffId, d)
        const tone = a?.code === 'Q' ? 'qc2' : code?.kind === 'work' ? sec?.tone ?? code.tone : code?.tone ?? 'unassigned'
        return (
          <button key={d} className={cx('my-day', `tone-${tone}`, d === t && 'today')} onClick={() => openCellEditor({ staffId, date: d })} style={{ textAlign: 'left', color: 'var(--text)' }}>
            <span className="d">{d === t ? 'Today' : shortDay(d)} · {fromISO(d).toLocaleDateString('en-GB', { month: 'short' })}</span>
            <span className="c">{code ? (code.kind === 'work' || code.kind === 'duty' ? `${sec?.name ?? ''}${code.code === 'Q' ? ' · QC 2' : ''}` : code.label) : 'No entry'}</span>
            {hoursOf(ctx.idx, ctx.sections, a) && <span className="h">{hoursOf(ctx.idx, ctx.sections, a)}</span>}
            <span className="row" style={{ gap: 6 }}>
              {role.inCharge && <span className="badge tone-incharge">★ In Charge</span>}
              {(role.qc2 || a?.code === 'Q') && <span className="badge tone-qc2">✓ QC 2</span>}
            </span>
          </button>
        )
      })}
    </div>
  )
}
