import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ClipboardList, Database, Download, FileSpreadsheet, History, ListChecks, ShieldCheck, SlidersHorizontal, Upload, Users, CircleAlert, TriangleAlert, Info, ChevronDown } from 'lucide-react'
import { canSeeBlacklist, useHub, usePerms } from '../../data/store'
import { relativeDateTime } from '../../lib/dates'
import { Badge, Empty, cx } from '../../ui/primitives'
import { PageHead } from '../shell/Shell'
import { integrityReport } from './integrity'
import { live } from '../../data/merge'

export function AdminHome() {
  const perms = usePerms()
  const navigate = useNavigate()
  const data = useHub((s) => s.data)
  const blacklist = useHub((s) => s.blacklist)
  const contents = useHub((s) => s.contents)
  const local = useHub((s) => s.local)
  const showBl = useHub(() => canSeeBlacklist())
  const report = useMemo(() => integrityReport(data, showBl ? blacklist : undefined, contents), [data, blacklist, contents, showBl])
  const [open, setOpen] = useState<string>()

  const tiles = [
    perms.importRota && { to: '/rota/import', icon: <FileSpreadsheet />, title: 'Import ROTA', sub: 'Official Excel rota → app data' },
    perms.importRota && { to: '/admin/imports', icon: <History />, title: 'Import history', sub: `${live(data.imports).length} imports · review & roll back` },
    perms.editStaff && { to: '/admin/staff', icon: <Users />, title: 'Staff', sub: `${live(data.staff).length} profiles · eligibility · details` },
    perms.admin && { to: '/admin/codes', icon: <SlidersHorizontal />, title: 'Shift codes & sections', sub: `${live(data.shiftCodes).length} codes · custom codes` },
    perms.editDocs && { to: '/admin/documents', icon: <Upload />, title: 'Documents', sub: 'Import PDFs & videos · procedure cards' },
    perms.exportBackup && { to: '/admin/backup', icon: <Download />, title: 'Backup, restore & publish', sub: local.lastBackupAt ? `Last backup ${relativeDateTime(local.lastBackupAt)}` : 'No backup yet' },
    perms.viewAudit && { to: '/admin/audit', icon: <ClipboardList />, title: 'Audit log', sub: `${local.audit.length} events on this device` },
  ].filter(Boolean) as { to: string; icon: React.ReactNode; title: string; sub: string }[]

  return (
    <div className="col" style={{ gap: 20 }}>
      <PageHead title="Data management" sub="Imports, backups, integrity checks and configuration for this device’s copy of the Hub." />
      <div className="admin-tiles">
        {tiles.map((t) => (
          <button key={t.to} className="card admin-tile" onClick={() => navigate(t.to)}>
            <span className="t-icon">{t.icon}</span>
            <span className="col" style={{ gap: 2 }}><strong>{t.title}</strong><span className="small muted">{t.sub}</span></span>
          </button>
        ))}
      </div>

      <section className="card" aria-labelledby="int-h">
        <div className="card-head">
          <ListChecks width={18} style={{ color: 'var(--accent-2)' }} />
          <h2 id="int-h">Data integrity</h2>
          <span className="spacer" />
          <Badge tone={report.some((r) => r.severity === 'alert') ? 'alert' : report.length ? 'warn' : 'qc2'}>{report.length ? `${report.length} checks need attention` : 'All checks passed'}</Badge>
        </div>
        {report.length === 0 ? (
          <Empty icon={<ShieldCheck />} title="Everything looks consistent" />
        ) : (
          <div className="col" style={{ padding: 8, gap: 4 }}>
            {report.map((r) => (
              <div key={r.id} className={cx('int-row', `tone-${r.severity === 'info' ? 'accent' : r.severity}`)}>
                <button className="int-head" onClick={() => setOpen(open === r.id ? undefined : r.id)} aria-expanded={open === r.id}>
                  {r.severity === 'alert' ? <CircleAlert /> : r.severity === 'warn' ? <TriangleAlert /> : <Info />}
                  <span className="grow">{r.title}</span>
                  <Badge tone={r.severity === 'info' ? 'accent' : r.severity}>{r.items.length}</Badge>
                  <ChevronDown width={16} style={{ transform: open === r.id ? 'rotate(180deg)' : undefined }} />
                </button>
                {open === r.id && (
                  <ul className="int-items">
                    {r.items.slice(0, 60).map((it, i) => (
                      <li key={i}>{it.to ? <button className="link-btn" onClick={() => navigate(it.to!)}>{it.label}</button> : it.label}</li>
                    ))}
                    {r.items.length > 60 && <li className="faint">…and {r.items.length - 60} more</li>}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
      <p className="tiny faint row" style={{ gap: 6 }}><Database width={14} /> Every device keeps its own encrypted copy. Publish updates so all devices stay on one source of truth.</p>
    </div>
  )
}
