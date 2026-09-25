/** ROTA read model + duty validation rules. Pure functions — easy to test. */
import type { DutyAssignment, ISODate, RotaAssignment, Section, ShiftCode, Staff } from '../../data/types'

export interface RotaCtx {
  staff: Staff[]
  codes: ShiftCode[]
  sections: Section[]
  rota: RotaAssignment[]
  duties: DutyAssignment[]
}

export interface RotaIndex {
  cell: Map<string, RotaAssignment> // `${staffId}|${date}`
  byDate: Map<ISODate, RotaAssignment[]>
  duty: Map<string, DutyAssignment> // `${date}|${band}`
  dates: ISODate[]
  staff: Map<string, Staff>
  codes: Map<string, ShiftCode>
}

let memo: { rota: object; duties: object; staff: object; codes: object; idx: RotaIndex } | undefined

export function rotaIndex(ctx: RotaCtx): RotaIndex {
  if (memo && memo.rota === ctx.rota && memo.duties === ctx.duties && memo.staff === ctx.staff && memo.codes === ctx.codes) return memo.idx
  const cell = new Map<string, RotaAssignment>()
  const byDate = new Map<ISODate, RotaAssignment[]>()
  for (const a of ctx.rota) {
    if (a.deleted) continue
    cell.set(`${a.staffId}|${a.date}`, a)
    const list = byDate.get(a.date)
    if (list) list.push(a)
    else byDate.set(a.date, [a])
  }
  const duty = new Map<string, DutyAssignment>()
  for (const d of ctx.duties) if (!d.deleted) duty.set(`${d.date}|${d.band}`, d)
  const idx: RotaIndex = {
    cell,
    byDate,
    duty,
    dates: [...byDate.keys()].sort(),
    staff: new Map(ctx.staff.filter((s) => !s.deleted).map((s) => [s.id, s])),
    codes: new Map(ctx.codes.filter((c) => !c.deleted).map((c) => [c.code, c])),
  }
  memo = { rota: ctx.rota, duties: ctx.duties, staff: ctx.staff, codes: ctx.codes, idx }
  return idx
}

export function codeKind(idx: RotaIndex, code?: string) {
  return code ? idx.codes.get(code)?.kind : undefined
}

export function isOnShift(idx: RotaIndex, a?: RotaAssignment): boolean {
  const k = codeKind(idx, a?.code)
  return k === 'work' || k === 'duty'
}

export function isAbsence(idx: RotaIndex, a?: RotaAssignment): boolean {
  return codeKind(idx, a?.code) === 'absence'
}

/** Band actually worked for an assignment (explicit band, else the code's band). */
export function bandOf(idx: RotaIndex, a?: RotaAssignment): string | undefined {
  if (!a) return undefined
  return a.band ?? idx.codes.get(a.code)?.band
}

export interface Person {
  staff: Staff
  a?: RotaAssignment
}

export interface BandDay {
  section: Section
  working: Person[]
  absent: Person[] // HOL / TOIL / SICK among the section's own staff
  off: Person[]
  duty?: DutyAssignment
  inCharge?: Staff
  qc2?: Staff
  issues: Issue[]
}

export interface Issue {
  level: 'error' | 'warn'
  band: string
  role?: 'inCharge' | 'qc2'
  message: string
}

export function activeSections(sections: Section[]): Section[] {
  return sections.filter((s) => !s.deleted).sort((a, b) => a.order - b.order)
}

export function dayModel(date: ISODate, ctx: RotaCtx, idx = rotaIndex(ctx)): BandDay[] {
  const sections = activeSections(ctx.sections)
  const cells = idx.byDate.get(date) ?? []
  const bands = sections.map<BandDay>((section) => ({ section, working: [], absent: [], off: [], issues: [] }))
  const byId = new Map(bands.map((b) => [b.section.id, b]))
  const seen = new Set<string>()
  for (const a of cells) {
    const staff = idx.staff.get(a.staffId)
    if (!staff || !staff.active) continue
    seen.add(staff.id)
    if (isOnShift(idx, a)) {
      const b = byId.get(bandOf(idx, a) ?? staff.section)
      b?.working.push({ staff, a })
    } else {
      const b = byId.get(staff.section)
      if (!b) continue
      if (isAbsence(idx, a)) b.absent.push({ staff, a })
      else b.off.push({ staff, a })
    }
  }
  for (const b of bands) {
    const duty = idx.duty.get(`${date}|${b.section.id}`)
    b.duty = duty
    b.inCharge = duty?.inChargeId ? idx.staff.get(duty.inChargeId) : undefined
    b.qc2 = duty?.qc2Id ? idx.staff.get(duty.qc2Id) : undefined
    const name = (p: Person) => p.staff.preferredName ?? p.staff.name
    b.working.sort((x, y) => {
      const rank = (p: Person) => (p.staff.id === b.inCharge?.id ? 0 : p.staff.id === b.qc2?.id ? 1 : 2)
      return rank(x) - rank(y) || name(x).localeCompare(name(y))
    })
    b.absent.sort((x, y) => name(x).localeCompare(name(y)))
    b.issues = validateBand(date, b.section, ctx, idx)
  }
  return bands
}

/** Why a person can / cannot hold a duty on this band and day. */
export function dutyEligibility(date: ISODate, band: string, staffId: string, ctx: RotaCtx, idx = rotaIndex(ctx)): { ok: boolean; reason?: string } {
  const staff = idx.staff.get(staffId)
  if (!staff) return { ok: false, reason: 'Unknown staff member' }
  if (!staff.active) return { ok: false, reason: 'Inactive' }
  const a = idx.cell.get(`${staffId}|${date}`)
  if (!a) return { ok: false, reason: 'Not on the rota this day' }
  const code = idx.codes.get(a.code)
  if (!code) return { ok: false, reason: `Unknown code ${a.code}` }
  if (code.kind === 'absence') return { ok: false, reason: `${code.label} (${code.code})` }
  if (code.kind === 'rest') return { ok: false, reason: 'OFF' }
  if (code.kind === 'other') return { ok: false, reason: code.label }
  const worked = bandOf(idx, a)
  if (worked && worked !== band) {
    const s = ctx.sections.find((x) => x.id === worked)
    return { ok: false, reason: `Rostered on ${s?.name ?? worked}` }
  }
  return { ok: true }
}

export function validateBand(date: ISODate, section: Section, ctx: RotaCtx, idx = rotaIndex(ctx)): Issue[] {
  const issues: Issue[] = []
  if (!section.duties) return issues
  const band = section.id
  const d = idx.duty.get(`${date}|${band}`)
  const hasCells = (idx.byDate.get(date)?.length ?? 0) > 0
  if (!hasCells) return issues
  const nm = (id?: string) => (id ? idx.staff.get(id)?.name ?? 'Unknown' : '')
  if (!d?.inChargeId) issues.push({ level: 'warn', band, role: 'inCharge', message: `${section.name} band requires an In-Charge` })
  if (!d?.qc2Id) issues.push({ level: 'warn', band, role: 'qc2', message: `${section.name} band requires a QC 2 duty holder` })
  // The same person may hold both In-Charge and QC 2 (department practice).
  for (const [role, id] of [['inCharge', d?.inChargeId], ['qc2', d?.qc2Id]] as const) {
    if (!id) continue
    const e = dutyEligibility(date, band, id, ctx, idx)
    if (!e.ok) issues.push({ level: 'error', band, role, message: `${nm(id)} — ${e.reason}; cannot be ${role === 'inCharge' ? 'In-Charge' : 'QC 2'} on ${section.name}` })
    // same person holding a duty in another band that day
    for (const other of ctx.sections) {
      if (other.id === band || other.deleted) continue
      const od = idx.duty.get(`${date}|${other.id}`)
      if (od && (od.inChargeId === id || od.qc2Id === id)) {
        issues.push({ level: 'error', band, role, message: `${nm(id)} also holds a duty on ${other.name} the same day` })
      }
    }
  }
  // someone on the QC 2 code who is not the duty holder
  for (const a of idx.byDate.get(date) ?? []) {
    if (a.code === 'Q' && bandOf(idx, a) === band && d?.qc2Id && a.staffId !== d.qc2Id) {
      issues.push({ level: 'warn', band, role: 'qc2', message: `${nm(a.staffId)} is on QC 2 in the rota but ${nm(d.qc2Id)} is the duty holder` })
    }
  }
  return issues
}

export function dayIssues(date: ISODate, ctx: RotaCtx, idx = rotaIndex(ctx)): Issue[] {
  return activeSections(ctx.sections).flatMap((s) => validateBand(date, s, ctx, idx))
}

/** Assignment for a staff member on a date. */
export function cellOf(idx: RotaIndex, staffId: string, date: ISODate): RotaAssignment | undefined {
  return idx.cell.get(`${staffId}|${date}`)
}

export function dutyRoleOf(idx: RotaIndex, staffId: string, date: ISODate): { inCharge: boolean; qc2: boolean; band?: string } {
  for (const [key, d] of idx.duty) {
    if (!key.startsWith(date)) continue
    if (d.inChargeId === staffId || d.qc2Id === staffId) return { inCharge: d.inChargeId === staffId, qc2: d.qc2Id === staffId, band: d.band }
  }
  return { inCharge: false, qc2: false }
}

/**
 * Staff grouped for the rota grid. With `days`, each person sits under the shift they work most on
 * those days (taken from the cells), so someone listed under Night who works mornings that week shows
 * under Morning. Without shifts in the period, their home section is used.
 */
export function staffBySection(ctx: RotaCtx, days?: ISODate[], idx?: RotaIndex): Map<string, Staff[]> {
  const out = new Map<string, Staff[]>()
  for (const s of activeSections(ctx.sections)) out.set(s.id, [])
  for (const st of ctx.staff) {
    // people who are not on the rota (no home section) stay out of the rota grid
    if (st.deleted || !st.active || !st.section) continue
    let group = st.section
    if (days && idx) {
      const counts = new Map<string, number>()
      for (const d of days) {
        const a = idx.cell.get(`${st.id}|${d}`)
        const band = a && idx.codes.get(a.code)?.kind === 'work' ? bandOf(idx, a) : undefined
        if (band) counts.set(band, (counts.get(band) ?? 0) + 1)
      }
      const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || Number(b[0] === st.section) - Number(a[0] === st.section))[0]
      if (top && out.has(top[0])) group = top[0]
    }
    const list = out.get(group) ?? out.get([...out.keys()][0] ?? '')
    list?.push(st)
  }
  for (const list of out.values()) list.sort((a, b) => a.name.localeCompare(b.name))
  return out
}

/** Hours label for an assignment, e.g. '08:00 – 16:00'. */
export function hoursOf(idx: RotaIndex, sections: Section[], a?: RotaAssignment): string | undefined {
  if (!a) return undefined
  const code = idx.codes.get(a.code)
  if (!code || (code.kind !== 'work' && code.kind !== 'duty')) return undefined
  if (a.hours) return a.hours.replace('–', ' – ')
  const s = sections.find((x) => x.id === bandOf(idx, a))
  return s ? `${s.start} – ${s.end}` : code.hours
}
