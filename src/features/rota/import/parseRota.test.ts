import { describe, expect, it } from 'vitest'
import { applyPlan, buildPlan, detectLayout, isYellow, parseDateCell, resolveCode, sectionForHours, type Grid } from './parseRota'
import { DEFAULT_CODES, DEFAULT_SECTIONS } from '../../../data/defaults'

const M = '08 till 16 00'
const A = '16 00 till 00 00  '
const N = '00 00 till 08 00  '
const Q = 'missing list &\nQC 2 '
const OFF = '   OFF'
const header = (label: string) => [label, 'Sun 13 /09/2026', 'Mon  14 /09 /2026', 'Tue 15 /09/2026', 'We16/09/2026']

const Y = 'FFFF00' // In-Charge
const B = '00B0F0' // morning blue
const G = '92D050' // QC 2 green

/** Mirrors the department's block layout: Morning / Afternoon / Night / holidays blocks. */
function sampleGrid(): Grid {
  const rows: Grid['rows'] = [
      header('Morning shift  '),
      ['alpha one   ', M, M, OFF, Q],
      ['bravo', Q, M, M, M],
      [null, null, null, null, null],
      header('Afternoon shift'),
      ['charlie two', A, Q, OFF, A],
      // listed under Afternoon but working mornings: QC 2 band must be inferred from neighbours
      ['delta', M, M, Q, M],
      header('Night shift'),
      ['echo', N, N, Q, OFF],
      header('Staff on holidays '),
      ['foxtrot', 'Holiday ', 'Holiday ', M, 'toil '],
      [' Sep', OFF, 'Holiday ', A, '      '],
    ]
  const fills: Grid['fills'] = rows.map(() => [])
  // alpha one is In-Charge on the 13th and 14th, bravo (on QC 2) covers the 15th and 16th
  fills[1] = [null, Y, Y, null, G]
  fills[2] = [null, G, B, Y, Y]
  return { sheet: 'Sep ', rowOffset: 0, colOffset: 0, rows, fills }
}

const ctx = { sections: DEFAULT_SECTIONS, codes: DEFAULT_CODES, staff: [] }

describe('date and code parsing', () => {
  it('parses the header formats found in the rota', () => {
    expect(parseDateCell('Sun 13 /09/2026')).toBe('2026-09-13')
    expect(parseDateCell('We30/09/2026')).toBe('2026-09-30')
    expect(parseDateCell('Fri 25  /09 /2026')).toBe('2026-09-25')
    expect(parseDateCell('22 Sep', 2026)).toBe('2026-09-22')
    expect(parseDateCell(46287)).toBe('2026-09-22') // Excel serial
    expect(parseDateCell('08 till 16 00')).toBeNull()
    expect(parseDateCell('Morning shift')).toBeNull()
  })

  it('resolves spreadsheet text to codes', () => {
    const r = (t: string) => resolveCode(t, DEFAULT_CODES, DEFAULT_SECTIONS)?.code
    expect(r(M)).toBe('M')
    expect(r(A)).toBe('A')
    expect(r(N)).toBe('N')
    expect(r(Q)).toBe('Q')
    expect(r(OFF)).toBe('OFF')
    expect(r('Holiday ')).toBe('HOL')
    expect(r('toil ')).toBe('TOIL')
    expect(r('   ')).toBe('U')
    expect(r('08:00-16:00 (IC)')).toBe('M')
    expect(resolveCode('08:00-16:00 ★', DEFAULT_CODES, DEFAULT_SECTIONS)?.inCharge).toBe(true)
    // hours that match no section exactly go to the section they overlap most, keeping the written hours
    expect(resolveCode('10 till 18 00', DEFAULT_CODES, DEFAULT_SECTIONS)).toMatchObject({ code: 'M', band: 'morning', hours: '10:00–18:00' })
    expect(resolveCode(M, DEFAULT_CODES, DEFAULT_SECTIONS)?.hours).toBeUndefined()
    expect(resolveCode('banana', DEFAULT_CODES, DEFAULT_SECTIONS)).toBeNull()
  })
})

describe('sectionForHours', () => {
  const s = (a: string, b: string) => sectionForHours(DEFAULT_SECTIONS, a, b)?.id
  it('matches the standard shifts exactly', () => {
    expect(s('08:00', '16:00')).toBe('morning')
    expect(s('16:00', '00:00')).toBe('afternoon')
    expect(s('00:00', '08:00')).toBe('night')
  })
  it('puts other hours in the shift they overlap most, across midnight too', () => {
    expect(s('07:00', '15:00')).toBe('morning')
    expect(s('14:00', '22:00')).toBe('afternoon')
    expect(s('22:00', '06:00')).toBe('night')
    expect(s('18:00', '02:00')).toBe('afternoon')
  })
})

describe('buildPlan', () => {
  const grid = sampleGrid()
  const layout = detectLayout(grid, DEFAULT_SECTIONS)!
  const plan = buildPlan(grid, layout, ctx)

  it('detects the four blocks and maps their sections', () => {
    expect(layout.kind).toBe('wide')
    if (layout.kind !== 'wide') return
    expect(layout.blocks.map((b) => b.section)).toEqual(['morning', 'afternoon', 'night', ''])
  })

  it('counts staff, days and cells', () => {
    expect(plan.stats.staff).toBe(7)
    expect(plan.stats.days).toBe(4)
    expect(plan.stats.cells).toBe(28)
    expect(plan.stats.blanks).toBe(1)
    expect(plan.period).toEqual({ from: '2026-09-13', to: '2026-09-16' })
  })

  it('infers the QC 2 band from neighbouring shifts', () => {
    const delta = plan.cells.find((c) => c.key === 'delta' && c.date === '2026-09-15')!
    expect(delta.code).toBe('Q')
    expect(delta.band).toBe('morning')
    const charlie = plan.cells.find((c) => c.key === 'charlietwo' && c.date === '2026-09-14')!
    expect(charlie.band).toBe('afternoon')
  })

  it('takes each shift from the time written in the cell, not the block', () => {
    // delta is listed under Afternoon but every written time is 08–16
    const delta = plan.names.find((n) => n.key === 'delta')!
    expect(delta.section).toBe('morning')
    expect(plan.cells.filter((c) => c.key === 'delta' && c.code === 'M').every((c) => c.band === 'morning')).toBe(true)
    // charlie is listed under Afternoon and works afternoons: unchanged
    expect(plan.names.find((n) => n.key === 'charlietwo')!.section).toBe('afternoon')
  })

  it('infers home sections for the holidays block', () => {
    const fox = plan.names.find((n) => n.key === 'foxtrot')!
    expect(fox.section).toBe('morning')
    expect(fox.sectionInferred).toBe(true)
    const sep = plan.names.find((n) => n.key === 'sep')!
    expect(sep.section).toBe('afternoon')
    expect(sep.suspicious).toBeUndefined()
  })

  it('reads yellow cells as In-Charge', () => {
    expect(isYellow('FFFF00')).toBe(true)
    expect(isYellow('FFC000')).toBe(false) // night orange
    expect(isYellow('92D050')).toBe(false)
    expect(plan.stats.inCharge).toBe(4)
    const res = applyPlan(plan, {}, { staff: [], rota: [], duties: [] }, { importId: 'i', actor: 't', now: 1 })
    const ic = (d: string) => res.staff.find((s) => s.id === res.duties.find((x) => x.id === `${d}|morning`)?.inChargeId)?.name
    expect([ic('2026-09-13'), ic('2026-09-14'), ic('2026-09-15'), ic('2026-09-16')]).toEqual(['Alpha One', 'Alpha One', 'Bravo', 'Bravo'])
  })

  it('applies configured renames (Sep → Sephora)', () => {
    const p = buildPlan(grid, layout, { ...ctx, renames: { sep: 'Sephora' } })
    const res = applyPlan(p, {}, { staff: [], rota: [], duties: [] }, { importId: 'i', actor: 't', now: 1 })
    const s = res.staff.find((x) => x.name === 'Sephora')!
    expect(s.aliases).toContain('Sep')
    // a later import with the short spelling maps to the same person
    const again = buildPlan(grid, layout, { ...ctx, staff: res.staff })
    expect(again.names.find((n) => n.key === 'sep')!.staffId).toBe(s.id)
  })

  it('applies idempotently and records rollback snapshots', () => {
    const data = { staff: [], rota: [], duties: [] }
    const first = applyPlan(plan, {}, data, { importId: 'i1', actor: 't', now: 1 })
    expect(first.counts.created).toBe(28)
    expect(first.staff).toHaveLength(7)
    // QC 2 duty holders come from the Q cells
    const d = first.duties.find((x) => x.id === '2026-09-15|morning')!
    expect(first.staff.find((s) => s.id === d.qc2Id)?.name).toBe('Delta')
    expect(Object.values(first.before).every((v) => v === null)).toBe(true)

    const again = buildPlan(grid, layout, { ...ctx, staff: first.staff })
    expect(again.names.every((n) => n.status === 'matched')).toBe(true)
    const second = applyPlan(again, {}, { staff: first.staff, rota: first.rota, duties: first.duties }, { importId: 'i2', actor: 't', now: 2 })
    expect(second.counts.unchanged).toBe(28)
    expect(second.rota).toHaveLength(0)
    expect(second.duties).toHaveLength(0)
  })

  it('maps a changed spelling to the existing person via suggestion', () => {
    const data = applyPlan(plan, {}, { staff: [], rota: [], duties: [] }, { importId: 'i1', actor: 't', now: 1 })
    const g2 = sampleGrid()
    g2.rows[1][0] = 'alpha onee'
    const p2 = buildPlan(g2, detectLayout(g2, DEFAULT_SECTIONS)!, { ...ctx, staff: data.staff })
    const n = p2.names.find((x) => x.key === 'alphaonee')!
    expect(n.status).toBe('suggested')
    const res = applyPlan(p2, {}, { staff: data.staff, rota: data.rota, duties: data.duties }, { importId: 'i2', actor: 't', now: 2 })
    expect(res.counts.newStaff).toBe(0)
    expect(res.staff[0].aliases).toContain('alpha onee')
  })
})
