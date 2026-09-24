import { useEffect, useMemo, useRef, useState } from 'react'
import { ImagePlus, ListPlus, Maximize2, RefreshCw, Trash2, ZoomIn, ZoomOut } from 'lucide-react'
import { useHub, usePerms } from '../../data/store'
import type { BlacklistSheet } from '../../data/types'
import { useFileUrl } from '../../data/sync'
import { prepareImage, sealLocalFile } from '../../data/localFiles'
import { dateTime, mediumDate } from '../../lib/dates'
import { formatBytes, plural, uid } from '../../lib/text'
import { Badge, Field, Modal, Notice, cx } from '../../ui/primitives'
import { confirmDialog, toast } from '../../ui/toast'

function SheetImage({ sheet, className, onClick }: { sheet: BlacklistSheet; className?: string; onClick?: () => void }) {
  const { url, error, progress } = useFileUrl(sheet.fileId)
  if (error) return <div className={cx('sheet-img missing', className)}>Image not available on this device yet — connect once to download it.</div>
  return (
    <button type="button" className={cx('sheet-img', className)} onClick={onClick} disabled={!onClick} aria-label={`Open ${sheet.title}`} style={sheet.width && sheet.height ? { aspectRatio: `${sheet.width} / ${sheet.height}` } : undefined}>
      {url ? <img src={url} alt={sheet.title} draggable={false} /> : <span className="small muted">Decrypting… {Math.round((progress ?? 0) * 100)}%</span>}
    </button>
  )
}

function Viewer({ sheet, onClose }: { sheet: BlacklistSheet; onClose: () => void }) {
  const { url } = useFileUrl(sheet.fileId)
  const [zoom, setZoom] = useState<number>(0) // 0 = fit
  const who = useHub((s) => s.local.userName ?? s.session?.label ?? '')
  const stamp = `${who} · ${dateTime(Date.now())}`
  return (
    <Modal
      open
      onClose={onClose}
      size="full"
      mobile="full"
      title={sheet.title}
      headExtra={
        <div className="row" style={{ gap: 4 }}>
          <button className="icon-btn sm" aria-label="Zoom out" onClick={() => setZoom((z) => (z <= 1 ? 0 : z - 0.5))}><ZoomOut /></button>
          <button className="btn btn-sm" onClick={() => setZoom(0)} aria-pressed={zoom === 0}>{zoom === 0 ? 'Fit' : `${zoom * 100}%`}</button>
          <button className="icon-btn sm" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(4, (z || 1) + 0.5))}><ZoomIn /></button>
        </div>
      }
    >
      <div className={cx('sheet-viewer', zoom === 0 && 'fit')}>
        {url && (
          <div className="sheet-canvas" style={zoom ? { width: (sheet.width ?? 1600) * zoom } : undefined}>
            <img src={url} alt={sheet.title} draggable={false} />
            <div className="sheet-watermark" aria-hidden>{Array.from({ length: 24 }, (_, i) => <span key={i}>{stamp}</span>)}</div>
          </div>
        )}
      </div>
      {sheet.names.length > 0 && (
        <div className="sheet-names" aria-label="Names on this sheet">
          {sheet.names.map((n) => <span key={n} className="badge tone-alert" dir="auto">{n}</span>)}
        </div>
      )}
    </Modal>
  )
}

function NamesEditor({ sheet, onClose }: { sheet: BlacklistSheet; onClose: () => void }) {
  const upsert = useHub((s) => s.upsertSheets)
  const audit = useHub((s) => s.audit)
  const me = useHub((s) => s.local.userName ?? s.session?.label ?? '')
  const [text, setText] = useState(sheet.names.join('\n'))
  const [title, setTitle] = useState(sheet.title)
  const names = [...new Set(text.split(/\r?\n/).map((n) => n.trim()).filter(Boolean))]
  const save = () => {
    upsert([{ ...sheet, title: title.trim() || sheet.title, names, updatedAt: Date.now(), updatedBy: me }])
    audit('blacklist.sheet.names', sheet.title, plural(names.length, 'name'))
    toast('Names saved — they are now searchable')
    onClose()
  }
  return (
    <Modal open onClose={onClose} size="full" title="Names on the blacklist image" footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-danger" onClick={save}>Save {plural(names.length, 'name')}</button></>}>
      <div className="names-editor">
        <SheetImage sheet={sheet} className="names-editor-img" />
        <div className="col" style={{ gap: 12 }}>
          <Field label="Title" htmlFor="sh-title"><input id="sh-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          <Field label="Names — one per line" htmlFor="sh-names" hint="Type the names shown on the image (Arabic or English, add both spellings if known). They power “Check a name” and search; the image itself stays the official list.">
            <textarea id="sh-names" className="textarea" style={{ minHeight: 360 }} value={text} onChange={(e) => setText(e.target.value)} dir="auto" autoFocus />
          </Field>
        </div>
      </div>
    </Modal>
  )
}

function Upload({ sheet, onClose, onDone }: { sheet?: BlacklistSheet; onClose: () => void; onDone: (s: BlacklistSheet) => void }) {
  const upsert = useHub((s) => s.upsertSheets)
  const audit = useHub((s) => s.audit)
  const me = useHub((s) => s.local.userName ?? s.session?.label ?? '')
  const [file, setFile] = useState<File>()
  const [title, setTitle] = useState(sheet?.title ?? 'Blacklist')
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLInputElement>(null)
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : undefined), [file])
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview)
  }, [preview])
  const save = async () => {
    if (!file) return
    setBusy(true)
    try {
      const img = await prepareImage(file)
      const id = sheet?.id ?? uid('sheet-')
      const fileId = `bl-img:${id}:${Date.now()}`
      await sealLocalFile(fileId, img.bytes, img.mime, { name: file.name, key: 'restricted' })
      const now = Date.now()
      const rec: BlacklistSheet = {
        ...(sheet ?? { names: [], addedAt: now, addedBy: me }),
        id, title: title.trim() || 'Blacklist', fileId, mime: img.mime, width: img.width, height: img.height, size: img.bytes.length,
        updatedAt: now, updatedBy: me,
      }
      upsert([rec])
      audit(sheet ? 'blacklist.sheet.replace' : 'blacklist.sheet.add', rec.title, `${img.width}×${img.height}`)
      toast(sheet ? 'Image replaced' : 'Blacklist image added — publish to share it with every device')
      onDone(rec)
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'alert')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open onClose={onClose} title={sheet ? 'Replace the blacklist image' : 'Add the blacklist image'} footer={<><button className="btn" onClick={onClose} disabled={busy}>Cancel</button><button className="btn btn-danger" onClick={() => void save()} disabled={!file || busy}>{busy ? <span className="spinner" /> : sheet ? 'Replace image' : 'Add image'}</button></>}>
      <div className="col" style={{ gap: 14 }}>
        <Notice tone="alert">The image is encrypted on this device with the blacklist key. Guests never receive it. Publish to share it with every device.</Notice>
        <Field label="Title" htmlFor="up-title"><input id="up-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <div className="row-wrap">
          <button className="btn" onClick={() => ref.current?.click()}><ImagePlus /> Choose image</button>
          <input ref={ref} type="file" accept="image/*" className="sr-only" onChange={(e) => setFile(e.target.files?.[0])} />
          {file && <span className="small">{file.name} · {formatBytes(file.size)}</span>}
        </div>
        {preview && <img src={preview} alt="Preview" style={{ maxHeight: 300, objectFit: 'contain', borderRadius: 8, border: '1px solid var(--line-2)' }} />}
      </div>
    </Modal>
  )
}

export function SheetsPanel() {
  const perms = usePerms()
  const sheets = useHub((s) => s.sheets).filter((s) => !s.deleted).sort((a, b) => b.addedAt - a.addedAt)
  const upsert = useHub((s) => s.upsertSheets)
  const audit = useHub((s) => s.audit)
  const me = useHub((s) => s.local.userName ?? s.session?.label ?? '')
  const [view, setView] = useState<BlacklistSheet>()
  const [names, setNames] = useState<BlacklistSheet>()
  const [upload, setUpload] = useState<{ sheet?: BlacklistSheet } | undefined>()

  const open = (s: BlacklistSheet) => {
    audit('blacklist.sheet.view', s.title)
    setView(s)
  }
  const remove = async (s: BlacklistSheet) => {
    if (!(await confirmDialog({ title: `Remove “${s.title}”?`, body: 'The image is removed from this device and, once published, from every device.', confirm: 'Remove', danger: true }))) return
    upsert([{ ...s, deleted: true, updatedAt: Date.now(), updatedBy: me }])
    audit('blacklist.sheet.delete', s.title)
  }

  if (!sheets.length && !perms.editBlacklist) return null
  return (
    <section className="sheets" aria-label="Blacklist image">
      {sheets.length === 0 ? (
        <div className="card card-pad sheet-empty">
          <ImagePlus />
          <div className="col grow" style={{ gap: 4 }}>
            <strong>Add the blacklist image</strong>
            <span className="small muted">Upload the official blacklist (one image with everyone on it). It stays encrypted and is never shown to guest codes.</span>
          </div>
          <button className="btn btn-danger" onClick={() => setUpload({})}><ImagePlus /> Upload image</button>
        </div>
      ) : (
        sheets.map((s) => (
          <article key={s.id} className="card sheet-card">
            <SheetImage sheet={s} className="sheet-thumb" onClick={() => open(s)} />
            <div className="col grow" style={{ gap: 8, minWidth: 0 }}>
              <div className="row-wrap" style={{ gap: 8 }}>
                <strong>{s.title}</strong>
                <Badge tone="alert" caps>Official list</Badge>
                {s.names.length > 0 ? <Badge tone="muted">{plural(s.names.length, 'name')} searchable</Badge> : <Badge tone="warn">Names not typed yet</Badge>}
              </div>
              <span className="small muted">Added {mediumDate(new Date(s.addedAt).toISOString().slice(0, 10))}{s.addedBy ? ` by ${s.addedBy}` : ''}{s.updatedAt !== s.addedAt ? ` · updated ${dateTime(s.updatedAt)}` : ''}</span>
              <div className="row-wrap">
                <button className="btn btn-sm" onClick={() => open(s)}><Maximize2 /> Open full screen</button>
                {perms.editBlacklist && <button className="btn btn-sm" onClick={() => setNames(s)}><ListPlus /> {s.names.length ? 'Edit names' : 'Type the names'}</button>}
                {perms.editBlacklist && <button className="btn btn-sm" onClick={() => setUpload({ sheet: s })}><RefreshCw /> Replace image</button>}
                {perms.editBlacklist && <button className="icon-btn sm" aria-label="Remove image" onClick={() => void remove(s)}><Trash2 /></button>}
              </div>
            </div>
          </article>
        ))
      )}
      {view && <Viewer sheet={view} onClose={() => setView(undefined)} />}
      {names && <NamesEditor sheet={names} onClose={() => setNames(undefined)} />}
      {upload && <Upload sheet={upload.sheet} onClose={() => setUpload(undefined)} onDone={(s) => { setUpload(undefined); if (!upload.sheet) setNames(s) }} />}
    </section>
  )
}
