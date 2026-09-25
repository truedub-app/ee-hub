/**
 * ROTA spreadsheet interpretation — pure functions shared by the in-app import wizard
 * and the offline pack builder.
 *
 * Supported layouts
 *  - wide:  one or more blocks. Each block has a header row whose cells are dates
 *           ("Sun 13 /09/2026", 22/09/2026, Excel serial dates …) plus optional
 *           attribute columns (name, section, suite, duty, employee id). The block label
 *           ("Morning shift") maps to a section; rows below hold one staff member each.
 *  - long:  one row per staff/day with columns such as Name | Date | Shift code | Section.
 */
import type { DutyAssignment, ISODate, RotaAssignment, Section, ShiftCode, Staff } from '../../../data/types'
import { isValidDate, toISO, ymd, addDays, diffDays } from '../../../lib/dates'
import { cleanSpaces, displayName, levenshtein, nameKey } from '../../../lib/text'

export type Cell = string | number | boolean | Date | null | undefined

export interface Grid {
  sheet: string
  rows: Cell[][]
  /** Solid fill colour per cell ('RRGGBB'), aligned with rows. */
  fills?: (string | null | undefined)[][]
  rowOffset: number // absolute row index of rows[0] (0-based)
  colOffset: number
}

export type ColumnRole = 'name' | 'employeeId' | 'section' | 'suite' | 'duty' | 'date' | 'code' | 'hours' | 'ignore'

export interface ColumnMap {
  col: number
  header: string
  role: ColumnRole
  date?: ISODate
}

export interface WideBlock {
  headerRow: number
  label: string
  section: string // section id, '' = infer from shifts
  rowStart: number
  rowEnd: number // exclusive
  columns: ColumnMap[]
}

export type Layout =
  | { kind: 'wide'; blocks: WideBlock[] }
  | { kind: 'long'; headerRow: number; columns: ColumnMap[] }

export interface Warning {
  level: 'info' | 'warn' | 'error'
  message: string
  where?: string
}

// ---------------------------------------------------------------------------------------
// Cells & dates
// ---------------------------------------------------------------------------------------

export function cellText(v: Cell): string {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return toISO(v)
  return cleanSpaces(String(v))
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
}

export function colName(col: number): string {
  let s = ''
  let n = col + 1
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

/** Parse a header cell as a calendar date; returns null when the cell is not a date. */
export function parseDateCell(v: Cell, fallbackYear?: number): ISODate | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return toISO(v)
  if (typeof v === 'number') {
    // Excel serial date (1900 system). 36526 = 2000-01-01, 73051 = 2100-01-01
    if (v >= 36526 && v < 73051) {
      const ms = Math.round((Math.floor(v) - 25569) * 86_400_000)
      const d = new Date(ms)
      return ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
    }
    return null
  }
  if (typeof v !== 'string') return null
  const s = cleanSpaces(v)
  if (!s || s.length > 40) return null
  let m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m && isValidDate(+m[1], +m[2], +m[3])) return ymd(+m[1], +m[2], +m[3])
  m = s.match(/(\d{1,2})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(\d{2,4})/)
  if (m) {
    const y = +m[3] < 100 ? 2000 + +m[3] : +m[3]
    if (isValidDate(y, +m[2], +m[1])) return ymd(y, +m[2], +m[1]) // day/month/year
    return null
  }
  m = s.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s*[\s\-/]\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:[\s,\-/]+(\d{4}))?/i)
  if (m) {
    const y = m[3] ? +m[3] : fallbackYear
    const mo = MONTHS[m[2].toLowerCase()]
    if (y && isValidDate(y, mo, +m[1])) return ymd(y, mo, +m[1])
  }
  m = s.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:[\s,]+(\d{4}))?\b/i)
  if (m) {
    const y = m[3] ? +m[3] : fallbackYear
    const mo = MONTHS[m[1].toLowerCase()]
    if (y && isValidDate(y, mo, +m[2])) return ymd(y, mo, +m[2])
  }
  return null
}

// ---------------------------------------------------------------------------------------
// Layout detection
// ---------------------------------------------------------------------------------------

const ROLE_WORDS: [ColumnRole, RegExp][] = [
  ['employeeId', /\b(emp(loyee)?\s*(id|no|number|#)|staff\s*(id|no)|id)\b/i],
  ['suite', /\b(suite|bay|room|edit\s*suite)\b/i],
  ['duty', /\b(duty|role|in\s*charge|qc\s*2?)\b/i],
  ['section', /\b(section|department|dept|team|band|shift\s*group)\b/i],
  ['hours', /\b(hours|time)\b/i],
  ['code', /\b(shift|code|assignment|status)\b/i],
  ['date', /\b(date|day)\b/i],
  ['name', /\b(name|employee|staff|editor)\b/i],
]

export function guessRole(header: string): ColumnRole {
  for (const [role, rx] of ROLE_WORDS) if (rx.test(header)) return role
  return 'ignore'
}

export function matchSection(label: string, sections: Section[]): string {
  const l = label.toLowerCase()
  for (const s of sections) {
    if (l.includes(s.name.toLowerCase())) return s.id
  }
  if (/\bam\b|early/.test(l)) return sections.find((s) => s.id === 'morning')?.id ?? ''
  if (/\bpm\b|late|evening/.test(l)) return sections.find((s) => s.id === 'afternoon')?.id ?? ''
  if (/overnight/.test(l)) return sections.find((s) => s.id === 'night')?.id ?? ''
  return ''
}

function dateCellsInRow(row: Cell[], fallbackYear?: number): { col: number; date: ISODate }[] {
  const out: { col: number; date: ISODate }[] = []
  row.forEach((v, col) => {
    const d = parseDateCell(v, fallbackYear)
    if (d) out.push({ col, date: d })
  })
  return out
}

function guessYear(rows: Cell[][]): number | undefined {
  for (const row of rows.slice(0, 60)) {
    for (const v of row) {
      const s = typeof v === 'string' ? v : ''
      const m = s.match(/\b(20\d{2})\b/)
      if (m) return +m[1]
    }
  }
  return undefined
}

export function detectLayout(grid: Grid, sections: Section[]): Layout | null {
  const year = guessYear(grid.rows)
  const headers: { row: number; dates: { col: number; date: ISODate }[] }[] = []
  grid.rows.forEach((row, r) => {
    const dates = dateCellsInRow(row, year)
    if (dates.length >= 3) headers.push({ row: r, dates })
  })

  if (headers.length) {
    const blocks: WideBlock[] = headers.map((h, i) => {
      const row = grid.rows[h.row]
      const dateCols = new Map(h.dates.map((d) => [d.col, d.date]))
      const columns: ColumnMap[] = []
      let nameAssigned = false
      let label = ''
      const width = Math.max(row.length, ...grid.rows.slice(h.row + 1, headers[i + 1]?.row ?? grid.rows.length).map((r) => r.length))
      for (let col = 0; col < width; col++) {
        const header = cellText(row[col])
        if (dateCols.has(col)) {
          columns.push({ col, header, role: 'date', date: dateCols.get(col) })
          continue
        }
        let role = header ? guessRole(header) : 'ignore'
        const attributeRole = role === 'employeeId' || role === 'suite' || role === 'duty'
        if (!nameAssigned && !attributeRole && col < (h.dates[0]?.col ?? 99)) {
          // first text column left of the dates holds the names; its header is the block label
          const hasNames = grid.rows
            .slice(h.row + 1, headers[i + 1]?.row ?? grid.rows.length)
            .some((r) => cellText(r[col]).length > 1)
          if (hasNames) {
            role = 'name'
            nameAssigned = true
            label = header
          }
        }
        columns.push({ col, header, role: role === 'date' || role === 'code' ? 'ignore' : role })
      }
      return {
        headerRow: h.row,
        label: label || `Block ${i + 1}`,
        section: matchSection(label, sections),
        rowStart: h.row + 1,
        rowEnd: headers[i + 1]?.row ?? grid.rows.length,
        columns,
      }
    })
    return { kind: 'wide', blocks }
  }

  // long layout: a header row with at least name + date + code-like columns
  for (let r = 0; r < Math.min(grid.rows.length, 25); r++) {
    const columns = grid.rows[r].map((v, col) => {
      const header = cellText(v)
      return { col, header, role: header ? guessRole(header) : ('ignore' as ColumnRole) }
    })
    const roles = new Set(columns.map((c) => c.role))
    if (roles.has('name') && roles.has('date') && (roles.has('code') || roles.has('hours'))) {
      return { kind: 'long', headerRow: r, columns }
    }
  }
  return null
}

// ---------------------------------------------------------------------------------------
// Code resolution
// ---------------------------------------------------------------------------------------

export interface ResolvedCode {
  code: string
  band?: string
  hours?: string
  inCharge?: boolean
}

const minutes = (hm: string) => +hm.slice(0, 2) * 60 + +hm.slice(3, 5)

/**
 * The section a written time range belongs to: an exact match, else the one it overlaps most
 * (e.g. "07 till 15" → Morning). Ranges past midnight such as 16:00–00:00 are handled.
 */
export function sectionForHours(sections: Section[], start: string, end: string): Section | undefined {
  const exact = sections.find((s) => s.start === start && s.end === end)
  if (exact) return exact
  const span = (a: string, b: string): [number, number] => {
    const x = minutes(a)
    let y = minutes(b)
    if (y <= x) y += 1440
    return [x, y]
  }
  const [a, b] = span(start, end)
  let best: Section | undefined
  let bestOverlap = 0
  for (const s of sections) {
    const [c, d] = span(s.start, s.end)
    const overlap = Math.max(...[-1440, 0, 1440].map((k) => Math.min(b, d + k) - Math.max(a, c + k)), 0)
    if (overlap > bestOverlap) {
      best = s
      bestOverlap = overlap
    }
  }
  return best
}

function toHM(h: string, m?: string): string {
  const hh = Math.min(24, +h) % 24
  return `${String(hh).padStart(2, '0')}:${(m ?? '00').padStart(2, '0')}`
}

const IN_CHARGE_RX = /(\(?\bi\/?c\b\)?|in\s*-?\s*charge|★|\*)/i

export function resolveCode(raw: string, codes: ShiftCode[], sections: Section[], extra: Record<string, string> = {}): ResolvedCode | null {
  let t = cleanSpaces(raw).toLowerCase()
  let inCharge = false
  if (IN_CHARGE_RX.test(t)) {
    inCharge = true
    t = cleanSpaces(t.replace(IN_CHARGE_RX, ' '))
  }
  if (!t) return inCharge ? null : { code: 'U' }
  if (extra[t]) {
    const c = codes.find((x) => x.code === extra[t])
    if (c) return { code: c.code, band: c.band, inCharge }
  }
  for (const c of codes) if (t === c.code.toLowerCase()) return { code: c.code, band: c.band, inCharge }

  const tm = t.match(/(\d{1,2})(?:\s*[:.h]?\s*(\d{2}))?\s*(?:till|until|to|-|–|—)\s*(\d{1,2})(?:\s*[:.h]?\s*(\d{2}))?/)
  if (tm) {
    const start = toHM(tm[1], tm[2])
    const end = toHM(tm[3], tm[4])
    const section = sectionForHours(sections, start, end)
    if (section) {
      const code = codes.find((c) => c.kind === 'work' && c.band === section.id)
      // keep the written hours when they differ from the section's standard ones
      const own = start !== section.start || end !== section.end ? `${start}–${end}` : undefined
      if (code) return { code: code.code, band: section.id, hours: own, inCharge }
    }
    return { code: 'X', hours: `${start}–${end}`, inCharge }
  }
  for (const c of codes) {
    for (const rx of c.match ?? []) {
      try {
        if (new RegExp(rx, 'i').test(t)) return { code: c.code, band: c.band, inCharge }
      } catch {
        /* ignore invalid admin regex */
      }
    }
  }
  return null
}

// ---------------------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------------------

export interface RawCell {
  name: string
  date: ISODate
  text: string
  section: string // '' = infer
  blockLabel: string
  employeeId?: string
  suite?: string
  duty?: string
  fill?: string // cell fill colour 'RRGGBB'
  row: number // absolute, 0-based
  col: number
}

export function extractCells(grid: Grid, layout: Layout): RawCell[] {
  const out: RawCell[] = []
  const abs = (r: number) => r + grid.rowOffset
  const absC = (c: number) => c + grid.colOffset
  if (layout.kind === 'wide') {
    for (const b of layout.blocks) {
      const nameCol = b.columns.find((c) => c.role === 'name')?.col
      if (nameCol === undefined) continue
      const attr = (role: ColumnRole, row: Cell[]) => {
        const c = b.columns.find((x) => x.role === role)
        return c ? cellText(row[c.col]) || undefined : undefined
      }
      for (let r = b.rowStart; r < b.rowEnd; r++) {
        const row = grid.rows[r] ?? []
        const name = cellText(row[nameCol])
        if (!name || /^(total|headcount|count|sum)\b/i.test(name)) continue
        const dates = b.columns.filter((c) => c.role === 'date' && c.date)
        if (!dates.some((c) => cellText(row[c.col]))) continue // entirely empty row
        const section = attr('section', row)
        for (const c of dates) {
          out.push({
            name,
            date: c.date!,
            text: cellText(row[c.col]),
            section: b.section,
            blockLabel: section || b.label,
            employeeId: attr('employeeId', row),
            suite: attr('suite', row),
            duty: attr('duty', row),
            fill: grid.fills?.[r]?.[c.col] ?? undefined,
            row: abs(r),
            col: absC(c.col),
          })
        }
      }
    }
  } else {
    const col = (role: ColumnRole) => layout.columns.find((c) => c.role === role)?.col
    const [nameC, dateC, codeC, hoursC, secC, suiteC, dutyC, idC] = (
      ['name', 'date', 'code', 'hours', 'section', 'suite', 'duty', 'employeeId'] as ColumnRole[]
    ).map(col)
    const year = guessYear(grid.rows)
    for (let r = layout.headerRow + 1; r < grid.rows.length; r++) {
      const row = grid.rows[r] ?? []
      const name = nameC !== undefined ? cellText(row[nameC]) : ''
      const date = dateC !== undefined ? parseDateCell(row[dateC], year) : null
      if (!name || !date) continue
      const code = codeC !== undefined ? cellText(row[codeC]) : ''
      const hours = hoursC !== undefined ? cellText(row[hoursC]) : ''
      out.push({
        name,
        date,
        text: code || hours,
        section: '',
        blockLabel: secC !== undefined ? cellText(row[secC]) : '',
        employeeId: idC !== undefined ? cellText(row[idC]) || undefined : undefined,
        suite: suiteC !== undefined ? cellText(row[suiteC]) || undefined : undefined,
        duty: dutyC !== undefined ? cellText(row[dutyC]) || undefined : undefined,
        fill: grid.fills?.[r]?.[codeC ?? hoursC ?? 0] ?? undefined,
        row: abs(r),
        col: absC(codeC ?? hoursC ?? 0),
      })
    }
  }
  return out
}

export type NameStatus = 'matched' | 'suggested' | 'new'

export interface NameMatch {
  key: string
  raw: string
  display: string
  status: NameStatus
  staffId?: string // matched / chosen staff
  suggestion?: { staffId: string; name: string }
  section: string // resolved home section
  sectionInferred: boolean
  suspicious?: string
  cells: number
}

export interface PlannedCell {
  key: string // name key
  date: ISODate
  code: string
  band?: string
  hours?: string // written hours when they differ from the band's standard hours
  raw: string
  inferred?: string
  suite?: string
  inCharge?: boolean
  where: string // "Sep!K5"
}

export interface ImportPlan {
  sheet: string
  period: { from: ISODate; to: ISODate }
  names: NameMatch[]
  cells: PlannedCell[]
  unknown: { text: string; count: number; where: string[] }[]
  warnings: Warning[]
  stats: { staff: number; days: number; cells: number; blanks: number; unknown: number; duplicates: number; qc2: number; inCharge: number; newStaff: number }
}

export interface PlanContext {
  sections: Section[]
  codes: ShiftCode[]
  staff: Staff[]
  /** Extra text → code mappings chosen in the wizard for unrecognised entries. */
  mappings?: Record<string, string>
  /** Display names for spellings used in the spreadsheet, keyed by nameKey (e.g. sam → Samantha). */
  renames?: Record<string, string>
  /** Fill colour that marks the In-Charge (default: yellow). */
  isInChargeFill?: (rgb: string) => boolean
}

/** The department marks the In-Charge of each band in yellow (FFFF00 and close shades, not orange/amber). */
export function isYellow(rgb: string): boolean {
  const n = parseInt(rgb.slice(-6), 16)
  if (Number.isNaN(n)) return false
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return r >= 230 && g >= 215 && b <= 140
}

function suspiciousName(display: string): string | undefined {
  const letters = display.replace(/[^\p{L}]/gu, '')
  if (letters.length < 3) return `“${display}” is very short — check it is a real name`
  if (/\d/.test(display)) return `“${display}” contains digits`
  return undefined
}

function findStaff(key: string, staff: Staff[]): Staff | undefined {
  return staff.find((s) => !s.deleted && (nameKey(s.name) === key || s.aliases.some((a) => nameKey(a) === key)))
}

function suggestStaff(key: string, staff: Staff[]): Staff | undefined {
  let best: { s: Staff; d: number } | undefined
  for (const s of staff) {
    if (s.deleted) continue
    for (const k of [nameKey(s.name), ...s.aliases.map(nameKey)]) {
      const d = levenshtein(k, key)
      const limit = Math.max(1, Math.floor(Math.min(k.length, key.length) / 5))
      const contains = key.length >= 5 && k.length >= 5 && (k.includes(key) || key.includes(k))
      if ((d <= limit || contains) && (!best || d < best.d)) best = { s, d }
    }
  }
  return best?.s
}

export function buildPlan(grid: Grid, layout: Layout, ctx: PlanContext): ImportPlan {
  const raw = extractCells(grid, layout)
  const warnings: Warning[] = []
  const where = (c: RawCell) => `${grid.sheet.trim()}!${colName(c.col)}${c.row + 1}`

  // Duplicate date columns inside a block
  let duplicates = 0
  if (layout.kind === 'wide') {
    for (const b of layout.blocks) {
      const seen = new Map<string, number>()
      for (const c of b.columns.filter((x) => x.role === 'date')) {
        if (seen.has(c.date!)) {
          duplicates++
          warnings.push({ level: 'warn', message: `Duplicate date ${c.date} in “${b.label}” (columns ${colName(seen.get(c.date!)! + grid.colOffset)} and ${colName(c.col + grid.colOffset)}) — the later column is used`, where: b.label })
        } else seen.set(c.date!, c.col)
      }
    }
  }

  // Resolve every cell
  const cellsByKey = new Map<string, PlannedCell[]>()
  const unknown = new Map<string, { text: string; count: number; where: string[] }>()
  const rawByKey = new Map<string, RawCell[]>()
  let blanks = 0
  for (const c of raw) {
    const key = nameKey(c.name)
    if (!key) continue
    const r = resolveCode(c.text, ctx.codes, ctx.sections, ctx.mappings)
    let code = r?.code ?? 'X'
    if (!r) {
      const k = c.text.toLowerCase()
      const u = unknown.get(k) ?? { text: c.text, count: 0, where: [] }
      u.count++
      if (u.where.length < 5) u.where.push(where(c))
      unknown.set(k, u)
    }
    if (code === 'U') blanks++
    let inCharge = r?.inCharge || (!!c.fill && (ctx.isInChargeFill ?? isYellow)(c.fill))
    if (c.duty) {
      if (/in\s*charge|^ic$|★|\*/i.test(c.duty)) inCharge = true
      if (/qc\s*2|missing/i.test(c.duty) && ctx.codes.some((x) => x.code === 'Q')) code = 'Q'
    }
    const list = cellsByKey.get(key) ?? []
    const existing = list.findIndex((x) => x.date === c.date)
    const planned: PlannedCell = { key, date: c.date, code, band: r?.band, hours: r?.band ? r.hours : undefined, raw: c.text, suite: c.suite, inCharge, where: where(c) }
    if (existing >= 0) {
      const prev = list[existing]
      if (prev.code !== code) {
        duplicates++
        warnings.push({ level: 'warn', message: `${displayName(c.name)} appears twice on ${c.date} (${prev.where}: “${prev.raw || 'blank'}”, ${planned.where}: “${c.text || 'blank'}”) — the later entry is used` })
      }
      list[existing] = planned
    } else list.push(planned)
    cellsByKey.set(key, list)
    rawByKey.set(key, [...(rawByKey.get(key) ?? []), c])
  }

  // Names → staff, home sections
  const names: NameMatch[] = []
  const sectionName = (id: string) => ctx.sections.find((s) => s.id === id)?.name ?? id
  for (const [key, cells] of cellsByKey) {
    const raws = rawByKey.get(key)!
    const rawName = raws[0].name
    const display = ctx.renames?.[key] ?? displayName(rawName)
    const matched = findStaff(key, ctx.staff) ?? (ctx.renames?.[key] ? findStaff(nameKey(ctx.renames[key]), ctx.staff) : undefined)
    const suggestion = matched ? undefined : suggestStaff(key, ctx.staff)
    // home section: the shift the cells show most often (the time written in each cell decides),
    // else the section column / block the person is listed under
    const blockSection = raws.find((x) => x.section)?.section || (raws[0].blockLabel ? matchSection(raws[0].blockLabel, ctx.sections) : undefined) || ''
    const counts = new Map<string, number>()
    for (const c of cells) if (c.band && ctx.codes.find((x) => x.code === c.code)?.kind === 'work') counts.set(c.band, (counts.get(c.band) ?? 0) + 1)
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || Number(b[0] === blockSection) - Number(a[0] === blockSection))
    const majority = ranked[0]?.[0]
    const section = majority || blockSection || matched?.section || ctx.sections[0]?.id || ''
    const sectionInferred = !blockSection // the file lists no section for this person
    names.push({
      key,
      raw: rawName,
      display,
      status: matched ? 'matched' : suggestion ? 'suggested' : 'new',
      staffId: matched?.id,
      suggestion: suggestion ? { staffId: suggestion.id, name: suggestion.name } : undefined,
      section,
      sectionInferred,
      suspicious: suspiciousName(display),
      cells: cells.length,
    })
  }

  // Infer band for duty / remote cells from the nearest worked shift of the same person
  for (const [key, cells] of cellsByKey) {
    const home = names.find((n) => n.key === key)!.section
    const worked = cells.filter((c) => c.band && ctx.codes.find((x) => x.code === c.code)?.kind === 'work')
    for (const c of cells) {
      const kind = ctx.codes.find((x) => x.code === c.code)?.kind
      if (c.band || !(kind === 'duty' || kind === 'work')) continue
      let best: PlannedCell | undefined
      let bestD = Infinity
      for (const w of worked) {
        const d = Math.abs(diffDays(w.date, c.date))
        const penalty = w.date > c.date ? 0.5 : 0 // prefer the previous day on ties
        if (d > 0 && d <= 4 && d + penalty < bestD) {
          best = w
          bestD = d + penalty
        }
      }
      c.band = best?.band ?? home
      if (best && best.band !== home) {
        c.inferred = `Band inferred from ${best.date} (${sectionName(best.band!)}) — listed under ${sectionName(home)}`
      }
    }
  }

  const all = [...cellsByKey.values()].flat()
  const dates = [...new Set(all.map((c) => c.date))].sort()

  // QC 2 duty holders per band/day
  let qc2 = 0
  const qcByBandDay = new Map<string, PlannedCell[]>()
  for (const c of all) {
    if (c.code !== 'Q' || !c.band) continue
    qc2++
    const k = `${c.date}|${c.band}`
    qcByBandDay.set(k, [...(qcByBandDay.get(k) ?? []), c])
  }
  for (const [k, list] of qcByBandDay) {
    if (list.length > 1) {
      const [date, band] = k.split('|')
      const who = list.map((c) => names.find((n) => n.key === c.key)?.display).join(', ')
      warnings.push({ level: 'warn', message: `${list.length} QC 2 holders on ${date} ${sectionName(band)}: ${who} — the first is set as duty holder` })
    }
  }

  // In-Charge per band/day (yellow cells or explicit markers)
  let inChargeCount = 0
  const icByBandDay = new Map<string, PlannedCell[]>()
  for (const c of all) {
    if (!c.inCharge || !c.band) continue
    inChargeCount++
    const k = `${c.date}|${c.band}`
    icByBandDay.set(k, [...(icByBandDay.get(k) ?? []), c])
  }
  const who = (c: PlannedCell) => names.find((n) => n.key === c.key)?.display ?? c.key
  for (const [k, list] of icByBandDay) {
    const [date, band] = k.split('|')
    if (list.length > 1) {
      warnings.push({ level: 'warn', message: `${list.length} In-Charge cells on ${date} ${sectionName(band)}: ${list.map(who).join(', ')} — the first is used` })
    }
  }
  if (all.length && inChargeCount === 0) {
    warnings.push({ level: 'info', message: 'No In-Charge cells (yellow) found — assign In-Charge on the duty board' })
  }

  // Info / warnings summary
  const inferredCells = all.filter((c) => c.inferred)
  const inferredPeople = [...new Set(inferredCells.map((c) => c.key))]
  for (const key of inferredPeople) {
    const n = names.find((x) => x.key === key)!
    const cs = inferredCells.filter((c) => c.key === key)
    warnings.push({ level: 'info', message: `${n.display}: QC 2 band inferred for ${cs.map((c) => c.date.slice(8)).join(', ')} — ${cs[0].inferred}` })
  }
  const missingSection = names.filter((n) => n.sectionInferred)
  if (missingSection.length) {
    warnings.push({
      level: 'warn',
      message: `${missingSection.length} staff have no section in the file (${missingSection.map((n) => `${n.display} → ${sectionName(n.section)}`).join(', ')}) — inferred from their shifts`,
    })
  }
  for (const n of names) if (n.suspicious) warnings.push({ level: 'warn', message: n.suspicious })
  if (blanks) warnings.push({ level: 'info', message: `${blanks} blank cell${blanks === 1 ? '' : 's'} imported as “Unassigned”` })
  for (const u of unknown.values()) {
    warnings.push({ level: 'warn', message: `Unrecognised entry “${u.text}” ×${u.count} (${u.where.join(', ')})` })
  }
  const unknownNames = names.filter((n) => n.status !== 'matched')
  if (ctx.staff.length && unknownNames.length) {
    warnings.push({ level: 'warn', message: `${unknownNames.length} name${unknownNames.length === 1 ? '' : 's'} not in the staff list: ${unknownNames.map((n) => n.display).join(', ')}` })
  }

  return {
    sheet: grid.sheet,
    period: { from: dates[0] ?? '', to: dates[dates.length - 1] ?? '' },
    names,
    cells: all,
    unknown: [...unknown.values()],
    warnings,
    stats: {
      staff: names.length,
      days: dates.length,
      cells: all.length,
      blanks,
      unknown: [...unknown.values()].reduce((a, u) => a + u.count, 0),
      duplicates,
      qc2,
      inCharge: inChargeCount,
      newStaff: names.filter((n) => n.status !== 'matched').length,
    },
  }
}

// ---------------------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------------------

export interface NameDecision {
  action: 'map' | 'create' | 'skip'
  staffId?: string // for 'map'
}

/** What the wizard pre-selects: existing match → map, close suggestion → map to it, otherwise create. */
export function defaultDecision(n: NameMatch): NameDecision {
  if (n.status === 'matched') return { action: 'map', staffId: n.staffId }
  if (n.status === 'suggested' && n.suggestion) return { action: 'map', staffId: n.suggestion.staffId }
  return { action: 'create' }
}

export interface ApplyResult {
  staff: Staff[] // new or updated staff records
  rota: RotaAssignment[]
  duties: DutyAssignment[]
  before: Record<string, RotaAssignment | null>
  beforeDuties: Record<string, DutyAssignment | null>
  counts: { created: number; updated: number; unchanged: number; skipped: number; newStaff: number }
}

export function staffIdFor(display: string, taken: Set<string>): string {
  const base = 'st-' + nameKey(display).slice(0, 32)
  let id = base
  let i = 2
  while (taken.has(id)) id = `${base}-${i++}`
  return id
}

export function applyPlan(
  plan: ImportPlan,
  decisions: Record<string, NameDecision>,
  data: { staff: Staff[]; rota: RotaAssignment[]; duties: DutyAssignment[] },
  opts: { importId: string; actor: string; now: number },
): ApplyResult {
  const staffById = new Map(data.staff.map((s) => [s.id, s]))
  const rotaById = new Map(data.rota.map((r) => [r.id, r]))
  const dutyById = new Map(data.duties.map((d) => [d.id, d]))
  const taken = new Set(staffById.keys())
  const outStaff: Staff[] = []
  const keyToStaff = new Map<string, string>()
  let newStaff = 0

  for (const n of plan.names) {
    const d = decisions[n.key] ?? defaultDecision(n)
    if (d.action === 'skip') continue
    if (d.action === 'map' && d.staffId && staffById.has(d.staffId)) {
      const s = staffById.get(d.staffId)!
      keyToStaff.set(n.key, s.id)
      if (!s.aliases.some((a) => nameKey(a) === n.key) && nameKey(s.name) !== n.key) {
        outStaff.push({ ...s, aliases: [...s.aliases, n.raw.trim()], updatedAt: opts.now, updatedBy: opts.actor })
      }
      continue
    }
    const id = staffIdFor(n.display, taken)
    taken.add(id)
    const review = [n.suspicious, n.sectionInferred ? 'Section inferred from shifts' : undefined, 'Added by rota import — add contact details'].filter(Boolean).join(' · ')
    outStaff.push({
      id,
      name: n.display,
      initials: n.display.split(' ').length > 1 ? (n.display.split(' ')[0][0] + n.display.split(' ').slice(-1)[0][0]).toUpperCase() : n.display.slice(0, 2).toUpperCase(),
      aliases: [n.raw.trim()],
      section: n.section,
      active: true,
      review,
      updatedAt: opts.now,
      updatedBy: opts.actor,
    })
    keyToStaff.set(n.key, id)
    newStaff++
  }

  const before: Record<string, RotaAssignment | null> = {}
  const rota: RotaAssignment[] = []
  let created = 0
  let updated = 0
  let unchanged = 0
  let skipped = 0
  for (const c of plan.cells) {
    const staffId = keyToStaff.get(c.key)
    if (!staffId) {
      skipped++
      continue
    }
    const id = `${staffId}|${c.date}`
    const prev = rotaById.get(id)
    const next: RotaAssignment = {
      id,
      staffId,
      date: c.date,
      code: c.code,
      band: c.band,
      hours: c.hours,
      suite: c.suite ?? prev?.suite,
      raw: c.raw,
      inferred: c.inferred,
      sourceImportId: opts.importId,
      updatedAt: opts.now,
      updatedBy: opts.actor,
    }
    if (prev && !prev.deleted && prev.code === next.code && prev.band === next.band && (prev.hours ?? '') === (next.hours ?? '') && (prev.suite ?? '') === (next.suite ?? '')) {
      unchanged++
      continue
    }
    before[id] = prev ?? null
    if (prev && !prev.deleted) updated++
    else created++
    rota.push(next)
  }

  // Duties: QC 2 from 'Q' cells, In-Charge from markers. Existing manual choices for other roles are kept.
  const beforeDuties: Record<string, DutyAssignment | null> = {}
  const duties = new Map<string, DutyAssignment>()
  const touch = (date: ISODate, band: string) => {
    const id = `${date}|${band}`
    if (!duties.has(id)) {
      const prev = dutyById.get(id)
      beforeDuties[id] = prev ?? null
      duties.set(id, { ...(prev ?? { id, date, band }), deleted: false, updatedAt: opts.now, updatedBy: opts.actor })
    }
    return duties.get(id)!
  }
  const firstQc = new Set<string>()
  const firstIc = new Set<string>()
  for (const c of plan.cells) {
    const staffId = keyToStaff.get(c.key)
    if (!staffId || !c.band) continue
    if (c.code === 'Q' && !firstQc.has(`${c.date}|${c.band}`)) {
      firstQc.add(`${c.date}|${c.band}`)
      touch(c.date, c.band).qc2Id = staffId
    }
    if (c.inCharge && !firstIc.has(`${c.date}|${c.band}`)) {
      firstIc.add(`${c.date}|${c.band}`)
      touch(c.date, c.band).inChargeId = staffId
    }
  }
  // drop duty records that did not change
  const outDuties = [...duties.values()].filter((d) => {
    const prev = beforeDuties[d.id]
    const same = prev && prev.inChargeId === d.inChargeId && prev.qc2Id === d.qc2Id && !prev.deleted
    if (same) delete beforeDuties[d.id]
    return !same
  })

  return { staff: outStaff, rota, duties: outDuties, before, beforeDuties, counts: { created, updated, unchanged, skipped, newStaff } }
}

/** Dates covered by a plan, inclusive range helper for UI. */
export function planDays(plan: ImportPlan): ISODate[] {
  if (!plan.period.from) return []
  const n = diffDays(plan.period.to, plan.period.from) + 1
  return Array.from({ length: n }, (_, i) => addDays(plan.period.from, i))
}
