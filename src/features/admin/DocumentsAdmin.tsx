import { useMemo, useRef, useState } from 'react'
import { FilePlus2, FileText, Pencil, Trash2, Upload, Video } from 'lucide-react'
import * as pdfjs from 'pdfjs-dist'
import { useHub, usePerms } from '../../data/store'
import type { Block, DocContent, DocKind, ManualDoc } from '../../data/types'
import { sealLocalFile } from '../../data/localFiles'
import { formatBytes, slug, uid } from '../../lib/text'
import { formatDuration, today } from '../../lib/dates'
import { Badge, Empty, Field, Modal, Progress, Segmented, SearchInput } from '../../ui/primitives'
import { confirmDialog, toast } from '../../ui/toast'
import { PageHead } from '../shell/Shell'
import { docMeta } from '../manual/ManualPage'
import { live } from '../../data/merge'
import '../manual/PdfViewer' // registers the pdf.js worker

const sealFile = (id: string, bytes: Uint8Array<ArrayBuffer>, mime: string, name?: string) => sealLocalFile(id, bytes, mime, { name })

function canvasBlob(c: HTMLCanvasElement, type = 'image/webp'): Promise<Uint8Array<ArrayBuffer>> {
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? b.arrayBuffer().then((a) => resolve(new Uint8Array(a))) : reject(new Error('Could not render image'))), type, 0.8))
}

async function processPdf(bytes: Uint8Array<ArrayBuffer>) {
  const pdf = await pdfjs.getDocument({ data: bytes.slice() }).promise
  const pages: { n: number; text: string }[] = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const p = await pdf.getPage(i)
    const tc = await p.getTextContent()
    pages.push({ n: i, text: tc.items.map((it) => ('str' in it ? it.str + (it.hasEOL ? '\n' : ' ') : '')).join('').replace(/[ \t]+/g, ' ').trim() })
  }
  const first = await pdf.getPage(1)
  const vp = first.getViewport({ scale: 0.4 })
  const c = document.createElement('canvas')
  c.width = vp.width
  c.height = vp.height
  await first.render({ canvas: c, viewport: vp }).promise
  const cover = await canvasBlob(c)
  const count = pdf.numPages
  await pdf.loadingTask.destroy()
  return { pages, cover, count }
}

function processVideo(file: File): Promise<{ poster: Uint8Array<ArrayBuffer>; duration: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const v = document.createElement('video')
    v.muted = true
    v.preload = 'metadata'
    v.src = url
    v.onloadedmetadata = () => {
      v.currentTime = Math.min(8, v.duration / 3)
    }
    v.onseeked = async () => {
      const c = document.createElement('canvas')
      c.width = 640
      c.height = Math.round((640 * v.videoHeight) / v.videoWidth) || 360
      c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height)
      try {
        resolve({ poster: await canvasBlob(c, 'image/jpeg'), duration: v.duration })
      } catch (e) {
        reject(e)
      } finally {
        URL.revokeObjectURL(url)
      }
    }
    v.onerror = () => reject(new Error('This video format cannot be played in the browser — use MP4 (H.264)'))
  })
}

/** Plain text → blocks: "# Heading", "- bullet", "1. step", "! note", blank line = paragraph break. */
function textToBlocks(text: string): Block[] {
  const blocks: Block[] = []
  let list = 0
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) {
      list++
      continue
    }
    let m
    if ((m = line.match(/^#{1,3}\s+(.*)/))) blocks.push({ t: 'h', level: 2, text: m[1] })
    else if ((m = line.match(/^!\s*(.*)/))) blocks.push({ t: 'note', text: m[1] || 'NOTE' })
    else if ((m = line.match(/^[-*•]\s+(.*)/))) blocks.push({ t: 'li', runs: [{ x: m[1] }], level: 0, list, ordered: false })
    else if ((m = line.match(/^\d+[.)]\s+(.*)/))) blocks.push({ t: 'li', runs: [{ x: m[1] }], level: 0, list, ordered: true })
    else blocks.push({ t: 'p', runs: [{ x: line }] })
  }
  return blocks
}

function AddDoc({ initial, onClose }: { initial?: ManualDoc; onClose: () => void }) {
  const categories = live(useHub((s) => s.data.categories)).sort((a, b) => a.order - b.order)
  const upsert = useHub((s) => s.upsert)
  const audit = useHub((s) => s.audit)
  const setContent = useHub((s) => s.setContent)
  const [kind, setKind] = useState<'pdf' | 'video' | 'procedure'>(initial?.kind === 'video' ? 'video' : initial?.kind === 'procedure' ? 'procedure' : 'pdf')
  const [file, setFile] = useState<File>()
  const [d, setD] = useState<Partial<ManualDoc>>(initial ?? { category: kind === 'video' ? 'walkthroughs' : 'workflow', owner: 'Editing & Editorial', updated: today() })
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState<string>()
  const [p, setP] = useState(0)
  const ref = useRef<HTMLInputElement>(null)
  const set = (x: Partial<ManualDoc>) => setD({ ...d, ...x })

  const save = async () => {
    const id = initial?.id ?? `${kind === 'video' ? 'vid' : kind === 'pdf' ? 'doc' : 'proc'}-${slug(d.title ?? 'doc')}-${uid().slice(0, 4)}`
    const now = Date.now()
    let rec: ManualDoc = { ...(initial ?? {}), ...d, id, kind: kind as DocKind, title: d.title!.trim(), description: d.description ?? '', category: d.category!, updatedAt: now } as ManualDoc
    try {
      if (!initial && kind !== 'procedure' && file) {
        setBusy('Reading file…')
        const bytes = new Uint8Array(await file.arrayBuffer())
        if (kind === 'pdf') {
          setBusy('Extracting text…')
          const r = await processPdf(bytes)
          setBusy('Encrypting…')
          await sealFile(`file:${id}`, bytes, 'application/pdf', file.name)
          await sealFile(`poster:${id}`, r.cover, 'image/webp')
          const content: DocContent = { kind: 'pages', pages: r.pages }
          await sealFile(`content:${id}`, new TextEncoder().encode(JSON.stringify(content)), 'application/json')
          setContent(`content:${id}`, content)
          rec = { ...rec, fileId: `file:${id}`, posterId: `poster:${id}`, contentId: `content:${id}`, fileName: file.name, fileSize: file.size, mime: 'application/pdf', pageCount: r.count }
          if (r.pages.every((x) => !x.text)) toast('This PDF has no text layer (scanned). It is viewable, but only its title and description are searchable.', 'warn', 8000)
        } else {
          setBusy('Capturing poster…')
          const v = await processVideo(file)
          setBusy('Encrypting video…')
          setP(0.1)
          await sealFile(`file:${id}`, bytes, file.type || 'video/mp4', file.name)
          setP(0.9)
          await sealFile(`poster:${id}`, v.poster, 'image/jpeg')
          rec = { ...rec, fileId: `file:${id}`, posterId: `poster:${id}`, fileName: file.name, fileSize: file.size, mime: file.type || 'video/mp4', duration: Math.round(v.duration) }
        }
      }
      if (kind === 'procedure' && body.trim()) {
        const content: DocContent = { kind: 'guide', sections: [{ id: 'main', title: d.title!, number: 0, blocks: textToBlocks(body) }] }
        await sealFile(`content:${id}`, new TextEncoder().encode(JSON.stringify(content)), 'application/json')
        setContent(`content:${id}`, content)
        rec = { ...rec, contentId: `content:${id}`, sectionId: 'main' }
      }
      upsert('docs', [rec])
      audit(initial ? 'docs.edit' : 'docs.import', rec.title, kind)
      toast(initial ? 'Document updated' : 'Document added — publish to share it with every device')
      onClose()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'alert')
    } finally {
      setBusy(undefined)
    }
  }

  const valid = !!d.title?.trim() && !!d.category && (initial || kind === 'procedure' ? true : !!file)
  return (
    <Modal open onClose={onClose} size="wide" title={initial ? `Edit — ${initial.title}` : 'Add to the Work Manual'} footer={
      <>
        {busy && <span className="small muted" style={{ marginRight: 'auto' }}>{busy}</span>}
        <button className="btn" onClick={onClose} disabled={!!busy}>Cancel</button>
        <button className="btn btn-primary" onClick={() => void save()} disabled={!valid || !!busy}>{busy ? <span className="spinner" /> : 'Save'}</button>
      </>
    }>
      <div className="col" style={{ gap: 14 }}>
        {!initial && <Segmented label="Type" value={kind} onChange={(k) => { setKind(k); setFile(undefined) }} options={[{ value: 'pdf', label: 'PDF document' }, { value: 'video', label: 'Video walkthrough' }, { value: 'procedure', label: 'Procedure card' }]} />}
        {!initial && kind !== 'procedure' && (
          <div className="row-wrap">
            <button className="btn" onClick={() => ref.current?.click()}><Upload /> Choose {kind === 'pdf' ? 'PDF' : 'MP4 video'}</button>
            <input ref={ref} type="file" className="sr-only" accept={kind === 'pdf' ? 'application/pdf' : 'video/mp4,video/webm'} onChange={(e) => {
              const f = e.target.files?.[0]
              setFile(f)
              if (f && !d.title) set({ title: f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ') })
            }} />
            {file && <span className="small">{file.name} · {formatBytes(file.size)}</span>}
            {kind === 'video' && file && file.size > 300 * 1024 * 1024 && <Badge tone="warn">Large file — compress to 1080p/15 fps first</Badge>}
          </div>
        )}
        {busy && p > 0 && <Progress value={p} />}
        <div className="form-grid">
          <Field label="Title" htmlFor="ad-t"><input id="ad-t" className="input" value={d.title ?? ''} onChange={(e) => set({ title: e.target.value })} dir="auto" /></Field>
          <Field label="Category" htmlFor="ad-c"><select id="ad-c" className="select" value={d.category} onChange={(e) => set({ category: e.target.value })}>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
          <Field label="Reference" htmlFor="ad-r"><input id="ad-r" className="input" value={d.reference ?? ''} onChange={(e) => set({ reference: e.target.value || undefined })} placeholder="e.g. P009" /></Field>
          <Field label="Version" htmlFor="ad-v"><input id="ad-v" className="input" value={d.version ?? ''} onChange={(e) => set({ version: e.target.value || undefined })} placeholder="e.g. V5" /></Field>
          <Field label="Owned by" htmlFor="ad-o"><input id="ad-o" className="input" value={d.owner ?? ''} onChange={(e) => set({ owner: e.target.value || undefined })} /></Field>
          <Field label="Revision date" htmlFor="ad-u"><input id="ad-u" type="date" className="input" value={d.updated ?? ''} onChange={(e) => set({ updated: e.target.value || undefined })} /></Field>
        </div>
        <Field label="Description" htmlFor="ad-d"><textarea id="ad-d" className="textarea" value={d.description ?? ''} onChange={(e) => set({ description: e.target.value })} dir="auto" /></Field>
        {kind === 'procedure' && !initial && (
          <Field label="Procedure steps" htmlFor="ad-b" hint="Use “# ” for headings, “- ” for bullets, “1. ” for numbered steps and “! ” for a NOTE call-out.">
            <textarea id="ad-b" className="textarea" style={{ minHeight: 220 }} value={body} onChange={(e) => setBody(e.target.value)} dir="auto" />
          </Field>
        )}
      </div>
    </Modal>
  )
}

export function DocumentsAdmin() {
  const perms = usePerms()
  const docs = useHub((s) => s.data.docs)
  const localFiles = useHub((s) => s.localFiles)
  const categories = useHub((s) => s.data.categories)
  const remove = useHub((s) => s.remove)
  const audit = useHub((s) => s.audit)
  const [q, setQ] = useState('')
  const [edit, setEdit] = useState<ManualDoc | 'new'>()
  const list = useMemo(() => live(docs).filter((d) => !q || d.title.toLowerCase().includes(q.toLowerCase())).sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title)), [docs, q])
  if (!perms.editDocs) return <Empty icon={<FileText />} title="Administrators only" />
  return (
    <div className="col" style={{ gap: 16 }}>
      <PageHead title="Documents" sub="Import PDFs and videos or write procedure cards. New items live on this device until you publish." actions={<button className="btn btn-primary" onClick={() => setEdit('new')}><FilePlus2 /> Add document</button>} />
      <div style={{ maxWidth: 460 }}><SearchInput value={q} onChange={setQ} placeholder="Filter documents" /></div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Title</th><th>Category</th><th>Type</th><th>Status</th><th aria-label="Actions" /></tr></thead>
          <tbody>
            {list.map((d) => {
              const isLocal = [d.fileId, d.contentId].some((f) => f && localFiles[f])
              return (
                <tr key={d.id}>
                  <td><div className="row" style={{ gap: 8 }}>{d.kind === 'video' ? <Video width={16} className="faint" /> : <FileText width={16} className="faint" />}<span>{d.title}</span></div></td>
                  <td>{categories.find((c) => c.id === d.category)?.name}</td>
                  <td className="small muted">{d.kind === 'video' && d.duration ? `Video · ${formatDuration(d.duration)}` : docMeta(d)}</td>
                  <td>{isLocal ? <Badge tone="warn">This device — not published</Badge> : <Badge tone="qc2">Published</Badge>}</td>
                  <td className="nowrap">
                    <button className="icon-btn sm" aria-label={`Edit ${d.title}`} onClick={() => setEdit(d)}><Pencil /></button>
                    <button className="icon-btn sm" aria-label={`Remove ${d.title}`} onClick={async () => {
                      if (await confirmDialog({ title: `Remove “${d.title}”?`, body: 'It disappears from the manual on this device and, once published, on every device.', confirm: 'Remove', danger: true })) {
                        remove('docs', [d.id])
                        audit('docs.remove', d.title)
                      }
                    }}><Trash2 /></button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {edit && <AddDoc initial={edit === 'new' ? undefined : edit} onClose={() => setEdit(undefined)} />}
    </div>
  )
}
