import type { BlacklistEntry, DocContent, HubData } from '../../data/types'
import { live } from '../../data/merge'
import { nameKey, levenshtein } from '../../lib/text'
import { today, mediumDate } from '../../lib/dates'
import { dayIssues, rotaIndex } from '../rota/model'

export interface IntegrityIssue {
  id: string
  title: string
  severity: 'alert' | 'warn' | 'info'
  items: { label: string; to?: string }[]
  fix?: { label: string; to: string }
}

export function integrityReport(data: HubData, blacklist: BlacklistEntry[] | undefined, contents: Record<string, DocContent>): IntegrityIssue[] {
  const out: IntegrityIssue[] = []
  const staff = live(data.staff)
  const sections = new Set(live(data.sections).map((s) => s.id))

  // Missing contact details
  const noContact = staff.filter((s) => s.active && !s.extension && !s.email)
  const contactsMissing = live(data.contacts).filter((c) => !c.extension && !c.email)
  if (noContact.length || contactsMissing.length) {
    out.push({
      id: 'contact-details', title: 'Missing contact details', severity: 'warn',
      items: [
        ...noContact.map((s) => ({ label: `${s.name} — no extension or email`, to: `/admin/staff?edit=${encodeURIComponent(s.id)}` })),
        ...contactsMissing.map((c) => ({ label: `${c.name} (${c.team}) — no extension or email`, to: `/contacts?focus=${c.id}` })),
      ],
      fix: { label: 'Edit staff', to: '/admin/staff' },
    })
  }

  // Duplicate staff names
  const dups: string[] = []
  for (let i = 0; i < staff.length; i++) {
    for (let j = i + 1; j < staff.length; j++) {
      const a = nameKey(staff[i].name)
      const b = nameKey(staff[j].name)
      if (a === b || (a.length > 5 && levenshtein(a, b) <= 1)) dups.push(`${staff[i].name} ↔ ${staff[j].name}`)
    }
  }
  if (dups.length) out.push({ id: 'dup-staff', title: 'Duplicate staff names', severity: 'warn', items: dups.map((label) => ({ label, to: '/admin/staff' })), fix: { label: 'Merge in staff editor', to: '/admin/staff' } })

  // Unknown Excel entries
  const unknown = live(data.rota).filter((r) => r.code === 'X' || r.code === 'U')
  if (unknown.length) {
    out.push({
      id: 'unknown-cells', title: 'Unknown or blank rota entries', severity: unknown.some((u) => u.code === 'X') ? 'alert' : 'info',
      items: unknown.slice(0, 50).map((u) => ({ label: `${staff.find((s) => s.id === u.staffId)?.name ?? u.staffId} — ${mediumDate(u.date)}: ${u.code === 'X' ? `unrecognised “${u.raw}”` : 'blank (unassigned)'}`, to: `/rota?view=week&date=${u.date}&staff=${encodeURIComponent(u.staffId)}` })),
    })
  }

  // Staff flagged for review
  const review = staff.filter((s) => s.review)
  if (review.length) out.push({ id: 'staff-review', title: 'Staff records flagged by imports', severity: 'info', items: review.map((s) => ({ label: `${s.name} — ${s.review}`, to: `/admin/staff?edit=${encodeURIComponent(s.id)}` })) })

  // Invalid sections
  const badSection = staff.filter((s) => !sections.has(s.section))
  if (badSection.length) out.push({ id: 'bad-section', title: 'Staff with invalid section assignments', severity: 'alert', items: badSection.map((s) => ({ label: `${s.name} — “${s.section}”`, to: `/admin/staff?edit=${encodeURIComponent(s.id)}` })) })

  // Missing duty holders (from today onwards)
  const ctx = { staff: data.staff, codes: data.shiftCodes, sections: data.sections, rota: data.rota, duties: data.duties }
  const idx = rotaIndex(ctx)
  const t = today()
  const dutyItems: { label: string; to: string }[] = []
  for (const d of idx.dates) {
    if (d < t) continue
    const iss = dayIssues(d, ctx, idx)
    const bad = iss.filter((i) => i.level === 'error' || i.message.includes('requires'))
    if (bad.length) dutyItems.push({ label: `${mediumDate(d)} — ${[...new Set(bad.map((b) => b.message))].join('; ')}`, to: `/rota?date=${d}` })
  }
  if (dutyItems.length) out.push({ id: 'duties', title: 'Missing or invalid duty holders (today onwards)', severity: dutyItems.some((x) => x.label.includes('cannot') || x.label.includes('also holds')) ? 'alert' : 'warn', items: dutyItems })

  // Duplicate documents
  const byTitle = new Map<string, string[]>()
  for (const d of live(data.docs)) {
    const k = nameKey(d.title)
    byTitle.set(k, [...(byTitle.get(k) ?? []), d.title])
  }
  const dupDocs = [...byTitle.values()].filter((v) => v.length > 1)
  if (dupDocs.length) out.push({ id: 'dup-docs', title: 'Duplicate documents', severity: 'warn', items: dupDocs.map((v) => ({ label: `${v[0]} ×${v.length}` })) })

  // Documents without extracted text
  const noText = live(data.docs).filter((d) => {
    if (d.kind === 'video') return false
    if (!d.contentId) return true
    const c = contents[d.contentId]
    if (!c) return false // not loaded yet — cannot judge
    if (c.kind === 'pages') return c.pages.every((p) => !p.text.trim())
    if (c.kind === 'guide') return c.sections.every((s) => s.blocks.length === 0)
    return false
  })
  if (noText.length) out.push({ id: 'no-text', title: 'Documents without extracted text', severity: 'warn', items: noText.map((d) => ({ label: d.title, to: `/manual/${d.id}` })) })

  // Expired blacklist reviews
  if (blacklist) {
    const overdue = live(blacklist).filter((b) => b.active && b.reviewDue && b.reviewDue < t)
    if (overdue.length) out.push({ id: 'bl-review', title: 'Expired blacklist reviews', severity: 'warn', items: overdue.map((b) => ({ label: `${b.name} — due ${mediumDate(b.reviewDue!)}`, to: `/blacklist?focus=${b.id}` })) })
  }
  return out
}
