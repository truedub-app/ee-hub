import { useHub } from '../../../data/store'
import type { DutyAssignment, RotaAssignment } from '../../../data/types'
import { confirmDialog } from '../../../ui/toast'

/** Restore every rota cell and duty an import touched to its previous state. */
export async function rollbackImport(importId: string): Promise<boolean> {
  const st = useHub.getState()
  const rec = st.data.imports.find((i) => i.id === importId)
  if (!rec || rec.rolledBack || !rec.before) return false
  const cells = Object.keys(rec.before).length
  const ok = await confirmDialog({
    title: 'Roll back this import?',
    body: `${cells} rota cells and ${Object.keys(rec.beforeDuties ?? {}).length} duty records from “${rec.fileName}” will be restored to their previous values. Changes made after the import to the same cells will also be reverted.`,
    confirm: 'Roll back',
    danger: true,
  })
  if (!ok) return false
  const now = Date.now()
  const rota: RotaAssignment[] = []
  for (const [id, prev] of Object.entries(rec.before)) {
    const cur = st.data.rota.find((r) => r.id === id)
    if (prev) rota.push({ ...prev, updatedAt: now })
    else if (cur) rota.push({ ...cur, deleted: true, updatedAt: now })
  }
  const duties: DutyAssignment[] = []
  for (const [id, prev] of Object.entries(rec.beforeDuties ?? {})) {
    const cur = st.data.duties.find((d) => d.id === id)
    if (prev) duties.push({ ...prev, updatedAt: now })
    else if (cur) duties.push({ ...cur, deleted: true, updatedAt: now })
  }
  st.upsert('rota', rota)
  st.upsert('duties', duties)
  st.upsert('imports', [{ ...rec, rolledBack: true, updatedAt: now }])
  st.audit('rota.rollback', rec.fileName, `${rota.length} cells restored`)
  return true
}
