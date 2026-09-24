import { useMemo, useState } from 'react'
import { ClipboardList, Download, FileSpreadsheet, History as HistoryIcon, Undo2 } from 'lucide-react'
import { useHub, usePerms } from '../../data/store'
import type { ImportRecord } from '../../data/types'
import { dateTime, mediumDate } from '../../lib/dates'
import { Badge, Empty, Modal, SearchInput } from '../../ui/primitives'
import { toast } from '../../ui/toast'
import { downloadBytes } from '../../data/backup'
import { PageHead } from '../shell/Shell'
import { rollbackImport } from '../rota/import/rollback'
import { live } from '../../data/merge'
import { fold } from '../../lib/text'

function ImportDetail({ rec, onClose }: { rec: ImportRecord; onClose: () => void }) {
  const data = useHub((s) => s.data)
  const perms = usePerms()
  const name = (id: string) => data.staff.find((s) => s.id === id)?.name ?? id
  const changes = Object.entries(rec.before ?? {}).map(([id, prev]) => {
    const cur = data.rota.find((r) => r.id === id)
    const [staffId, date] = id.split('|')
    return { id, staff: name(staffId), date, before: prev && !prev.deleted ? prev.code : '—', after: cur && !cur.deleted ? cur.code : '—' }
  }).sort((a, b) => a.date.localeCompare(b.date) || a.staff.localeCompare(b.staff))
  return (
    <Modal open onClose={onClose} size="wide" title={rec.fileName} footer={
      <>
        {perms.importRota && rec.before && !rec.rolledBack && <button className="btn btn-danger" style={{ marginRight: 'auto' }} onClick={async () => { if (await rollbackImport(rec.id)) { toast('Import rolled back'); onClose() } }}><Undo2 /> Roll back</button>}
        <button className="btn" onClick={onClose}>Close</button>
      </>
    }>
      <div className="col" style={{ gap: 14 }}>
        <dl className="kv">
          <dt>Imported</dt><dd>{dateTime(rec.importedAt)} by {rec.importedBy}</dd>
          {rec.period && <><dt>Period</dt><dd>{mediumDate(rec.period.from)} – {mediumDate(rec.period.to)}</dd></>}
          <dt>Result</dt><dd>{Object.entries(rec.stats).map(([k, v]) => `${k}: ${v}`).join(' · ')}</dd>
          <dt>Rollback</dt><dd>{rec.rolledBack ? 'Rolled back' : rec.before ? 'Available' : 'Not available (initial pack data)'}</dd>
        </dl>
        {rec.warnings.length > 0 && (
          <div>
            <div className="eyebrow" style={{ marginBottom: 6 }}>Warnings & notes</div>
            <ul className="small" style={{ margin: 0, paddingLeft: 18, color: 'var(--text-2)' }}>{rec.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
          </div>
        )}
        {changes.length > 0 && (
          <div>
            <div className="eyebrow" style={{ marginBottom: 6 }}>Changed cells — before → now ({changes.length})</div>
            <div className="table-wrap" style={{ maxHeight: 360 }}>
              <table className="table">
                <thead><tr><th>Date</th><th>Staff</th><th>Before</th><th>Now</th></tr></thead>
                <tbody>{changes.slice(0, 500).map((c) => <tr key={c.id}><td className="mono small">{c.date}</td><td>{c.staff}</td><td className="mono">{c.before}</td><td className="mono">{c.after}</td></tr>)}</tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}

export function ImportHistory() {
  const imports = useHub((s) => s.data.imports)
  const [open, setOpen] = useState<ImportRecord>()
  const list = useMemo(() => live(imports).sort((a, b) => b.importedAt - a.importedAt), [imports])
  return (
    <div className="col" style={{ gap: 16 }}>
      <PageHead title="Import history" sub="Every import is recorded. Review what changed and roll back when needed." />
      {list.length === 0 ? <Empty icon={<HistoryIcon />} title="No imports yet" /> : (
        <div className="col" style={{ gap: 8 }}>
          {list.map((r) => (
            <button key={r.id} className="card row" style={{ padding: '14px 16px', gap: 14, textAlign: 'left', color: 'var(--text)' }} onClick={() => setOpen(r)}>
              <FileSpreadsheet style={{ color: r.kind === 'rota' ? 'var(--qc2)' : 'var(--accent-2)', flex: 'none' }} />
              <span className="col grow" style={{ gap: 2, minWidth: 0 }}>
                <strong className="truncate">{r.fileName}</strong>
                <span className="small muted">{dateTime(r.importedAt)} · Imported by: {r.importedBy}</span>
              </span>
              <span className="col" style={{ gap: 4, alignItems: 'flex-end' }}>
                <span className="small num">{r.kind === 'rota' ? `${(r.stats.created ?? 0) + (r.stats.updated ?? 0)} cells updated` : r.kind === 'contacts' ? `${r.stats.contacts} contacts` : r.kind}</span>
                {r.rolledBack ? <Badge tone="muted">Rolled back</Badge> : r.warnings.length ? <Badge tone="warn">{r.warnings.length} notes</Badge> : <Badge tone="qc2">Clean</Badge>}
              </span>
            </button>
          ))}
        </div>
      )}
      {open && <ImportDetail rec={list.find((x) => x.id === open.id) ?? open} onClose={() => setOpen(undefined)} />}
    </div>
  )
}

export function AuditLog() {
  const perms = usePerms()
  const audit = useHub((s) => s.local.audit)
  const [q, setQ] = useState('')
  const list = audit.filter((e) => !q || fold(`${e.action} ${e.actor} ${e.target ?? ''} ${e.detail ?? ''}`).includes(fold(q)))
  if (!perms.viewAudit) return <Empty icon={<ClipboardList />} title="Restricted" />
  const exportCsv = () => {
    const rows = [['Time', 'Actor', 'Role', 'Action', 'Target', 'Detail'], ...list.map((e) => [new Date(e.at).toISOString(), e.actor, e.role, e.action, e.target ?? '', e.detail ?? ''])]
    downloadBytes(new TextEncoder().encode('﻿' + rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\r\n')), 'hub-audit-log.csv', 'text/csv')
  }
  return (
    <div className="col" style={{ gap: 16 }}>
      <PageHead title="Audit log" sub="Unlocks, blacklist views and searches, edits, imports and exports on this device." actions={<button className="btn" onClick={exportCsv}><Download /> Export CSV</button>} />
      <div style={{ maxWidth: 460 }}><SearchInput value={q} onChange={setQ} placeholder="Filter by action, person or target" /></div>
      {list.length === 0 ? <Empty icon={<ClipboardList />} title="No events" /> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Time</th><th>Who</th><th>Action</th><th>Target</th><th>Detail</th></tr></thead>
            <tbody>
              {list.slice(0, 1000).map((e) => (
                <tr key={e.id}>
                  <td className="nowrap small">{dateTime(e.at)}</td>
                  <td>{e.actor} <span className="tiny faint">({e.role})</span></td>
                  <td><Badge tone={e.action.startsWith('blacklist') ? 'alert' : e.action.includes('import') || e.action.includes('backup') ? 'accent' : 'muted'}>{e.action}</Badge></td>
                  <td>{e.target}</td>
                  <td className="small muted">{e.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
