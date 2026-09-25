import { useMemo } from 'react'
import { useHub, usePerms } from '../../data/store'
import { addDays, ago, diffDays, mediumDate, today } from '../../lib/dates'
import { dayIssues, rotaIndex } from '../rota/model'
import { live } from '../../data/merge'

export interface HubNotice {
  id: string
  tone: 'info' | 'warn' | 'alert'
  area: 'rota' | 'staff' | 'blacklist' | 'data' | 'backup'
  text: string
  to?: string
}

export function useNotices(): HubNotice[] {
  const data = useHub((s) => s.data)
  const blacklist = useHub((s) => s.blacklist)
  const sheets = useHub((s) => s.sheets)
  const local = useHub((s) => s.local)
  const perms = usePerms()
  return useMemo(() => {
    const out: HubNotice[] = []
    const t = today()
    const ctx = { staff: data.staff, codes: data.shiftCodes, sections: data.sections, rota: data.rota, duties: data.duties }
    const idx = rotaIndex(ctx)
    const last = idx.dates[idx.dates.length - 1]

    // an administrator's changes reach other devices only when published (automatically once connected)
    if (perms.admin && local.editedAt && local.editedAt > (local.publishedAt ?? 0)) {
      if (!local.publisher) out.push({ id: `unpublished-${local.editedAt}`, tone: 'alert', area: 'data', text: 'Changes on this device are not on other devices yet — connect automatic publishing', to: '/admin/backup#publish' })
      else if (Date.now() - local.editedAt > 3 * 60_000) out.push({ id: `unsent-${local.editedAt}`, tone: 'alert', area: 'data', text: 'Changes on this device haven’t reached other devices yet — check the connection', to: '/admin/backup#publish' })
    }

    const lastImport = live(data.imports).filter((i) => i.kind === 'rota' && !i.rolledBack).sort((a, b) => b.importedAt - a.importedAt)[0]
    if (lastImport) out.push({ id: `imp-${lastImport.id}`, tone: 'info', area: 'data', text: `Rota imported ${ago(lastImport.importedAt)} — ${lastImport.fileName}`, to: '/admin/imports' })

    if (!idx.dates.length) out.push({ id: 'no-rota', tone: 'warn', area: 'rota', text: 'No rota has been imported yet', to: perms.importRota ? '/rota/import' : '/rota' })
    else if (!idx.byDate.has(t)) out.push({ id: 'rota-today', tone: 'warn', area: 'rota', text: t > last ? `The rota ends on ${mediumDate(last)} — import the next rota` : 'No rota entries for today', to: perms.importRota ? '/rota/import' : '/rota' })
    else if (diffDays(last, t) <= 3) out.push({ id: 'rota-ending', tone: 'warn', area: 'rota', text: `Rota ends ${mediumDate(last)} — next rota needed soon`, to: perms.importRota ? '/rota/import' : '/rota' })

    for (const d of [t, addDays(t, 1)]) {
      if (!idx.byDate.has(d)) continue
      const issues = dayIssues(d, ctx, idx)
      const errors = issues.filter((i) => i.level === 'error')
      const missing = issues.filter((i) => i.level === 'warn' && i.message.includes('requires'))
      const when = d === t ? 'Today' : 'Tomorrow'
      if (errors.length) out.push({ id: `duty-err-${d}`, tone: 'alert', area: 'rota', text: `${when}: ${errors[0].message}${errors.length > 1 ? ` (+${errors.length - 1} more)` : ''}`, to: `/rota?date=${d}` })
      if (missing.length) {
        const bands = [...new Set(missing.map((m) => data.sections.find((s) => s.id === m.band)?.name ?? m.band))]
        out.push({ id: `duty-miss-${d}`, tone: 'warn', area: 'rota', text: `${when}: duty assignment incomplete — ${bands.join(', ')}`, to: `/rota?date=${d}` })
      }
    }

    const review = live(data.staff).filter((s) => s.active && (s.review || (!s.email && !s.extension)))
    if (review.length && perms.editStaff) out.push({ id: 'staff-review', tone: 'warn', area: 'staff', text: `${review.length} staff record${review.length === 1 ? '' : 's'} require review`, to: '/admin/staff' })

    if (perms.viewBlacklist && !local.hideBlacklist) {
      const recent = live(blacklist).filter((b) => Date.now() - b.updatedAt < 7 * 86_400_000 && b.dateAdded && diffDays(t, b.dateAdded) <= 7)
      if (recent.length) out.push({ id: `bl-new-${recent.length}`, tone: 'alert', area: 'blacklist', text: `${recent.length} new blacklist entr${recent.length === 1 ? 'y' : 'ies'} this week`, to: '/blacklist' })
      const fresh = live(sheets).filter((sh) => Date.now() - sh.updatedAt < 7 * 86_400_000)
      if (fresh.length) out.push({ id: `bl-sheet-${fresh[0].id}-${fresh[0].updatedAt}`, tone: 'alert', area: 'blacklist', text: `Blacklist image updated ${ago(fresh[0].updatedAt)}`, to: '/blacklist' })
      const overdue = live(blacklist).filter((b) => b.active && b.reviewDue && b.reviewDue < t)
      if (overdue.length) out.push({ id: 'bl-overdue', tone: 'warn', area: 'blacklist', text: `${overdue.length} blacklist review${overdue.length === 1 ? '' : 's'} overdue`, to: '/blacklist?filter=overdue' })
    }

    if (perms.exportBackup) {
      const lb = local.lastBackupAt
      if (!lb || Date.now() - lb > 30 * 86_400_000) out.push({ id: 'backup', tone: 'info', area: 'backup', text: lb ? `Last backup ${ago(lb)}` : 'No backup exported from this device yet', to: '/admin/backup' })
    }
    return out.filter((n) => !local.dismissed.includes(n.id))
  }, [data, blacklist, sheets, local.dismissed, local.hideBlacklist, local.lastBackupAt, local.editedAt, local.publishedAt, local.publisher, perms])
}
