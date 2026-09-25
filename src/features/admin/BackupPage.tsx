import { useRef, useState } from 'react'
import { Download, FolderOpen, PackageCheck, ShieldCheck, Upload } from 'lucide-react'
import { useHub, usePerms } from '../../data/store'
import { backupFileName, decodeBackup, downloadBytes, encodeBackup, type BackupPayload } from '../../data/backup'
import { mergeBlacklist, mergeData, mergeList, emptyData, live } from '../../data/merge'
import { carryFiles, referencedLocalFileIds, restoreFiles } from '../../data/localFiles'
import { PublishCard } from './PublishPanel'
import { dateTime } from '../../lib/dates'
import { formatBytes, plural } from '../../lib/text'
import { Empty, Field, Notice, Segmented, Switch } from '../../ui/primitives'
import { confirmDialog, toast } from '../../ui/toast'
import { PageHead } from '../shell/Shell'

function strength(p: string): { ok: boolean; label: string } {
  if (p.length < 10) return { ok: false, label: 'At least 10 characters' }
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^\w]/].filter((r) => r.test(p)).length
  return classes >= 2 || p.length >= 16 ? { ok: true, label: p.length >= 16 ? 'Strong' : 'Good' } : { ok: false, label: 'Mix letters, numbers or symbols' }
}

export function BackupPage() {
  const perms = usePerms()
  const s = useHub()
  const [pass, setPass] = useState('')
  const [pass2, setPass2] = useState('')
  const [includeBl, setIncludeBl] = useState(true)
  const [includeAudit, setIncludeAudit] = useState(false)
  const [busy, setBusy] = useState(false)
  const [file, setFile] = useState<File>()
  const [rpass, setRpass] = useState('')
  const [preview, setPreview] = useState<BackupPayload>()
  const [mode, setMode] = useState<'merge' | 'replace'>('merge')
  const [err, setErr] = useState<string>()
  const inputRef = useRef<HTMLInputElement>(null)
  const canBl = !!s.session?.keys.restricted && perms.viewBlacklist
  if (!perms.exportBackup) return <Empty icon={<ShieldCheck />} title="Restricted">Backups are available to managers and administrators.</Empty>

  const doExport = async () => {
    const st = strength(pass)
    if (!st.ok || pass !== pass2) return
    if (includeBl && canBl && !(await confirmDialog({ title: 'Include the blacklist?', body: 'The backup is encrypted with your passphrase. Anyone with the file and the passphrase can read the blacklist.', confirm: 'Include blacklist' }))) return
    setBusy(true)
    try {
      const withBl = includeBl && canBl
      const fileIds = referencedLocalFileIds().filter((id) => withBl || s.localFiles[id].key !== 'restricted')
      const payload: BackupPayload = {
        format: 'eeh-backup/1', createdAt: Date.now(), createdBy: s.local.userName ?? s.session!.label, role: s.session!.role,
        packVersion: s.local.packVersion, redacted: !(includeBl && canBl), data: s.data,
        blacklist: withBl ? s.blacklist : undefined, sheets: withBl ? s.sheets : undefined,
        audit: includeAudit ? s.local.audit : undefined, files: await carryFiles(fileIds),
      }
      const bytes = await encodeBackup(payload, pass)
      downloadBytes(bytes, backupFileName())
      s.setLocal({ lastBackupAt: Date.now() })
      s.audit('backup.export', backupFileName(), `${formatBytes(bytes.length)}${payload.redacted ? ' · blacklist excluded' : ''}`)
      toast('Encrypted backup exported')
      setPass('')
      setPass2('')
    } finally {
      setBusy(false)
    }
  }

  const doOpen = async () => {
    if (!file) return
    setErr(undefined)
    setBusy(true)
    try {
      const p = await decodeBackup(new Uint8Array(await file.arrayBuffer()), rpass)
      setPreview(p)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const doApply = async () => {
    if (!preview) return
    if (mode === 'replace' && !(await confirmDialog({ title: 'Replace all data on this device?', body: 'Every rota cell, staff profile, contact and document record on this device is replaced by the backup. Unpublished changes made here will be lost.', confirm: 'Replace', danger: true, typeToConfirm: 'REPLACE' }))) return
    const base = mode === 'replace' ? emptyData() : s.data
    const merged = mergeData(base, preview.data)
    s.setData(merged.data, `Backup ${file?.name}`)
    s.setLocal({ editedAt: Date.now() })
    if (preview.blacklist && s.session?.keys.restricted) {
      s.setBlacklistAll(mode === 'replace' ? preview.blacklist : mergeBlacklist(s.blacklist, preview.blacklist).list)
      if (preview.sheets) s.setSheetsAll(mode === 'replace' ? preview.sheets : mergeList(s.sheets, preview.sheets))
    }
    if (preview.files) {
      const allowed = Object.fromEntries(Object.entries(preview.files).filter(([, f]) => f.entry.key !== 'restricted' || s.session?.keys.restricted))
      await restoreFiles(allowed)
    }
    s.audit(mode === 'replace' ? 'backup.restore' : 'backup.merge', file?.name, `${merged.stats.added} added, ${merged.stats.updated} updated`)
    toast(`${mode === 'replace' ? 'Restored' : 'Merged'} — ${merged.stats.added} added, ${merged.stats.updated} updated`)
    setPreview(undefined)
    setFile(undefined)
    setRpass('')
  }

  const st = strength(pass)
  return (
    <div className="col" style={{ gap: 18, maxWidth: 900 }}>
      <PageHead title="Backup, restore & publish" sub="Publish this device’s data to every device, or move data between devices without the internet." />

      <section className="card">
        <div className="card-head"><Download width={18} style={{ color: 'var(--accent-2)' }} /><h2>Export encrypted backup</h2><span className="spacer" />{s.local.lastBackupAt && <span className="small muted">Last: {dateTime(s.local.lastBackupAt)}</span>}</div>
        <div className="card-body col" style={{ gap: 14 }}>
          <p className="small muted">Creates <span className="mono">{backupFileName()}</span> — an AES-256 encrypted package you can move by USB, AirDrop, Nearby Share or a shared drive. Tell the recipient the passphrase separately.</p>
          <div className="form-grid">
            <Field label="Passphrase" htmlFor="bp1" hint={pass ? st.label : 'At least 10 characters'} error={pass && !st.ok ? st.label : undefined}><input id="bp1" type="password" className="input" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="new-password" /></Field>
            <Field label="Repeat passphrase" htmlFor="bp2" error={pass2 && pass2 !== pass ? 'Does not match' : undefined}><input id="bp2" type="password" className="input" value={pass2} onChange={(e) => setPass2(e.target.value)} autoComplete="new-password" /></Field>
          </div>
          {canBl && <Switch checked={includeBl} onChange={setIncludeBl} label="Include the blacklist" hint="Turn off for a redacted backup" />}
          {perms.viewAudit && <Switch checked={includeAudit} onChange={setIncludeAudit} label="Include this device’s audit log" />}
          <div><button className="btn btn-primary" disabled={!st.ok || pass !== pass2 || busy} onClick={() => void doExport()}><Download /> Export backup</button></div>
          <p className="tiny faint">No automatic cloud backup is ever made. Files you export are your responsibility to store securely.</p>
        </div>
      </section>

      <section className="card">
        <div className="card-head"><Upload width={18} style={{ color: 'var(--accent-2)' }} /><h2>Import a backup package</h2></div>
        <div className="card-body col" style={{ gap: 14 }}>
          <div className="row-wrap">
            <button className="btn" onClick={() => inputRef.current?.click()}><FolderOpen /> Choose .hub file</button>
            <input ref={inputRef} type="file" accept=".hub" className="sr-only" onChange={(e) => { setFile(e.target.files?.[0]); setPreview(undefined); setErr(undefined) }} />
            {file && <span className="small">{file.name} · {formatBytes(file.size)}</span>}
          </div>
          {file && !preview && (
            <form className="row-wrap" onSubmit={(e) => { e.preventDefault(); void doOpen() }}>
              <input type="password" className="input" style={{ maxWidth: 320 }} placeholder="Passphrase" value={rpass} onChange={(e) => setRpass(e.target.value)} aria-label="Backup passphrase" />
              <button className="btn btn-primary" disabled={!rpass || busy}>Open</button>
            </form>
          )}
          {err && <Notice tone="alert">{err}</Notice>}
          {preview && (
            <div className="col" style={{ gap: 12 }}>
              <Notice tone="accent" icon={<PackageCheck />}>
                Backup from <strong>{preview.createdBy}</strong> ({preview.role}) · {dateTime(preview.createdAt)} · data version {preview.packVersion ?? '—'}
                <div className="small muted" style={{ marginTop: 4 }}>
                  {plural(live(preview.data.staff).length, 'staff')} · {plural(live(preview.data.rota).length, 'rota cell')} · {plural(live(preview.data.contacts).length, 'contact')} · {plural(live(preview.data.docs).length, 'document')}
                  {preview.blacklist ? ` · ${plural(live(preview.blacklist).length, 'blacklist entry', 'blacklist entries')}${preview.sheets?.length ? ` + ${plural(live(preview.sheets).length, 'blacklist image')}` : ''}` : ' · blacklist not included'}
                </div>
              </Notice>
              <Segmented label="Import mode" value={mode} onChange={setMode} options={[{ value: 'merge', label: 'Merge (newest wins)' }, ...(perms.restoreBackup ? [{ value: 'replace' as const, label: 'Replace (restore)' }] : [])]} />
              <p className="small muted">{mode === 'merge' ? 'Each record keeps whichever version was changed most recently — safe for combining devices.' : 'Everything on this device is replaced by the backup.'}</p>
              <div className="row"><button className="btn" onClick={() => setPreview(undefined)}>Cancel</button><button className={mode === 'replace' ? 'btn btn-danger' : 'btn btn-primary'} onClick={() => void doApply()}>{mode === 'merge' ? 'Merge into this device' : 'Restore backup'}</button></div>
            </div>
          )}
        </div>
      </section>

      {perms.admin && <PublishCard />}
    </div>
  )
}
