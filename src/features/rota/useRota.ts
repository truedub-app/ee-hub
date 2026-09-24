import { useMemo } from 'react'
import { useHub } from '../../data/store'
import type { DutyAssignment, ISODate, RotaAssignment, Section, ShiftCode } from '../../data/types'
import { activeSections, rotaIndex, type RotaCtx } from './model'
import { OPTIONAL_SECTIONS } from '../../data/defaults'

export function useRotaCtx(): RotaCtx & { idx: ReturnType<typeof rotaIndex> } {
  const staff = useHub((s) => s.data.staff)
  const codes = useHub((s) => s.data.shiftCodes)
  const sections = useHub((s) => s.data.sections)
  const rota = useHub((s) => s.data.rota)
  const duties = useHub((s) => s.data.duties)
  const graphics = useHub((s) => s.local.graphicsSection)
  return useMemo(() => {
    let secs = sections.filter((s) => !s.deleted)
    if (graphics && !secs.some((s) => s.id === 'graphics')) secs = [...secs, ...OPTIONAL_SECTIONS]
    if (!graphics) secs = secs.filter((s) => s.id !== 'graphics' || staff.some((st) => st.section === 'graphics' && !st.deleted))
    const ctx: RotaCtx = { staff, codes, sections: activeSections(secs), rota, duties }
    return { ...ctx, idx: rotaIndex(ctx) }
  }, [staff, codes, sections, rota, duties, graphics])
}

export function codeTone(codes: ShiftCode[] | Map<string, ShiftCode>, code?: string): string {
  if (!code) return 'unassigned'
  const c = codes instanceof Map ? codes.get(code) : codes.find((x) => x.code === code)
  return c?.tone ?? 'muted'
}

export function sectionOf(sections: Section[], id?: string): Section | undefined {
  return sections.find((s) => s.id === id)
}

/** Write a rota cell (+ audit). */
export function saveCell(next: Omit<RotaAssignment, 'updatedAt' | 'id'> & { id?: string }, prev?: RotaAssignment) {
  const st = useHub.getState()
  const id = next.id ?? `${next.staffId}|${next.date}`
  st.upsert('rota', [{ ...next, id, updatedAt: Date.now(), sourceImportId: undefined, inferred: undefined, raw: undefined }])
  const name = st.data.staff.find((s) => s.id === next.staffId)?.name ?? next.staffId
  st.audit('rota.edit', `${name} ${next.date}`, `${prev?.code ?? '—'} → ${next.code}${next.band ? ` (${next.band})` : ''}`)
}

export function saveDuty(date: ISODate, band: string, patch: Partial<Pick<DutyAssignment, 'inChargeId' | 'qc2Id'>>) {
  const st = useHub.getState()
  const id = `${date}|${band}`
  const prev = st.data.duties.find((d) => d.id === id && !d.deleted)
  const next: DutyAssignment = { ...(prev ?? { id, date, band }), ...patch, deleted: false, updatedAt: Date.now() }
  st.upsert('duties', [next])
  const nm = (x?: string) => (x ? st.data.staff.find((s) => s.id === x)?.name ?? x : 'none')
  const role = 'inChargeId' in patch ? 'In-Charge' : 'QC 2'
  const val = 'inChargeId' in patch ? patch.inChargeId : patch.qc2Id
  st.audit('rota.duty', `${date} ${band}`, `${role}: ${nm(val)}`)
}
