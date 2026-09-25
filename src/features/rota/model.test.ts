import { describe, expect, it } from 'vitest'
import { dayModel, dutyEligibility, rotaIndex, staffBySection, validateBand } from './model'
import { DEFAULT_CODES, DEFAULT_SECTIONS } from '../../data/defaults'
import type { DutyAssignment, RotaAssignment, Staff } from '../../data/types'

const staff = (id: string, section = 'morning'): Staff => ({ id, name: id.toUpperCase(), initials: id.slice(0, 2), aliases: [], section, active: true, updatedAt: 0 })
const cell = (staffId: string, code: string, band?: string): RotaAssignment => ({ id: `${staffId}|2026-09-22`, staffId, date: '2026-09-22', code, band, updatedAt: 0 })
const D = '2026-09-22'
const morning = DEFAULT_SECTIONS[0]

function ctx(duty?: Partial<DutyAssignment>, extra: RotaAssignment[] = [], extraDuties: DutyAssignment[] = []) {
  return {
    staff: [staff('a'), staff('b'), staff('c'), staff('d'), staff('e', 'afternoon')],
    codes: DEFAULT_CODES,
    sections: DEFAULT_SECTIONS,
    rota: [cell('a', 'M'), cell('b', 'Q', 'morning'), cell('c', 'OFF'), cell('d', 'SICK'), cell('e', 'A'), ...extra],
    duties: [...(duty ? [{ id: `${D}|morning`, date: D, band: 'morning', updatedAt: 0, ...duty }] : []), ...extraDuties],
  }
}

describe('duty rules', () => {
  it('requires one In-Charge and one QC 2 per band', () => {
    const issues = validateBand(D, morning, ctx())
    expect(issues.map((i) => i.role)).toEqual(['inCharge', 'qc2'])
    expect(validateBand(D, morning, ctx({ inChargeId: 'a', qc2Id: 'b' }))).toEqual([])
  })

  it('allows the same person to be In-Charge and QC 2', () => {
    expect(validateBand(D, morning, ctx({ inChargeId: 'b', qc2Id: 'b' }))).toEqual([])
  })

  it('rejects people who are off, absent or on another band', () => {
    expect(dutyEligibility(D, 'morning', 'c', ctx()).ok).toBe(false) // OFF
    expect(dutyEligibility(D, 'morning', 'd', ctx()).reason).toMatch(/Sick/)
    expect(dutyEligibility(D, 'morning', 'e', ctx()).reason).toMatch(/Afternoon/)
    expect(dutyEligibility(D, 'morning', 'a', ctx()).ok).toBe(true)
    const issues = validateBand(D, morning, ctx({ inChargeId: 'c', qc2Id: 'b' }))
    expect(issues.some((i) => i.level === 'error' && i.role === 'inCharge')).toBe(true)
  })

  it('rejects one person holding duties on two bands', () => {
    const other: DutyAssignment = { id: `${D}|afternoon`, date: D, band: 'afternoon', inChargeId: 'a', updatedAt: 0 }
    const issues = validateBand(D, morning, ctx({ inChargeId: 'a', qc2Id: 'b' }, [], [other]))
    expect(issues.some((i) => /also holds/.test(i.message))).toBe(true)
  })

  it('builds the day model with working and absent staff per band', () => {
    const bands = dayModel(D, ctx({ inChargeId: 'a', qc2Id: 'b' }))
    const m = bands.find((b) => b.section.id === 'morning')!
    expect(m.working.map((p) => p.staff.id)).toEqual(['a', 'b']) // In-Charge first, then QC 2
    expect(m.absent.map((p) => p.staff.id)).toEqual(['d'])
    expect(m.off.map((p) => p.staff.id)).toEqual(['c'])
    expect(bands.find((b) => b.section.id === 'afternoon')!.working).toHaveLength(1)
  })
})

describe('rota grid grouping', () => {
  it('groups each person by the shift they work most in the days shown', () => {
    // 'e' has Afternoon as home section; give them two morning shifts in the period
    const base = ctx()
    const c = { ...base, rota: [...base.rota.filter((r) => r.staffId !== 'e'), { ...cell('e', 'M'), id: `e|${D}` }, { id: 'e|2026-09-23', staffId: 'e', date: '2026-09-23', code: 'M', updatedAt: 0 }] }
    const idx = rotaIndex(c)
    const grouped = staffBySection(c, [D, '2026-09-23'], idx)
    expect(grouped.get('morning')!.map((s) => s.id)).toContain('e')
    expect(grouped.get('afternoon')!.map((s) => s.id)).not.toContain('e')
    // without a period, the home section is used
    expect(staffBySection(c).get('afternoon')!.map((s) => s.id)).toContain('e')
  })
})

describe('team members who are not on the rota', () => {
  it('keeps them out of the rota grid', () => {
    const c = { ...ctx(), staff: [...ctx().staff, staff('head', '')] }
    const grouped = [...staffBySection(c).values()].flat().map((s) => s.id)
    expect(grouped).not.toContain('head')
    expect(grouped).toContain('a')
  })
})
