import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ChevronLeft, ChevronRight, Copy, Download, FileText, List, Search } from 'lucide-react'
import { useHub } from '../../data/store'
import { entryFor, getContent } from '../../data/sync'
import type { DocContent, GuideContent, ManualDoc } from '../../data/types'
import { readFile } from '../../lib/pack'
import { downloadBytes } from '../../data/backup'
import { Badge, Empty, Glyph, Modal, cx } from '../../ui/primitives'
import { toast } from '../../ui/toast'
import { mediumDate } from '../../lib/dates'
import { DocBlocks } from './DocBlocks'
import { PdfViewer } from './PdfViewer'
import { VideoPlayer } from './VideoPlayer'
import { SegmentationView } from './SegmentationView'
import { docMeta } from './ManualPage'

async function downloadOriginal(d: ManualDoc) {
  const s = useHub.getState()
  const entry = entryFor(d.fileId)
  if (!entry || !s.session) return toast('Original file is not available', 'alert')
  toast('Preparing download…', 'info', 2000)
  const bytes = await readFile(entry, s.session.keys)
  downloadBytes(bytes, entry.name ?? d.fileName ?? `${d.title}`, entry.mime)
  s.audit('manual.export', d.title)
}

function GuideView({ doc, content }: { doc: ManualDoc; content: GuideContent }) {
  const [sp, setSp] = useSearchParams()
  const navigate = useNavigate()
  const isProcedure = doc.kind === 'procedure'
  const sections = isProcedure ? content.sections.filter((s) => s.id === doc.sectionId) : content.sections
  const current = sp.get('section') ?? sections[0]?.id
  const idx = Math.max(0, sections.findIndex((s) => s.id === current))
  const section = sections[idx]
  const [q, setQ] = useState('')
  const [toc, setToc] = useState(false)
  const docs = useHub((s) => s.data.docs)
  const procFor = (sid: string) => docs.find((d) => d.parentId === doc.id && d.sectionId === sid && !d.deleted)
  const go = (id: string) => {
    const n = new URLSearchParams(sp)
    n.set('section', id)
    setSp(n, { replace: true })
    setToc(false)
    document.querySelector('.reader-scroll')?.scrollTo({ top: 0 })
  }
  const hits = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (needle.length < 2) return new Map<string, number>()
    const m = new Map<string, number>()
    for (const s of sections) {
      const text = s.blocks.map((b) => (b.t === 'p' || b.t === 'li' ? b.runs.map((r) => r.x).join('') : b.t === 'h' || b.t === 'note' ? b.text : b.t === 'table' ? b.rows.flat().join(' ') : '')).join(' ').toLowerCase()
      let n = 0
      let i = text.indexOf(needle)
      while (i >= 0) {
        n++
        i = text.indexOf(needle, i + needle.length)
      }
      if (n) m.set(s.id, n)
    }
    return m
  }, [q, sections])

  if (!section) return <Empty icon={<FileText />} title="Section not found" />
  return (
    <div className={cx('guide', isProcedure && 'single')}>
      {!isProcedure && (
        <nav className={cx('guide-toc', toc && 'open')} aria-label="Contents">
          <div className="eyebrow" style={{ padding: '4px 10px 8px' }}>Contents</div>
          {sections.map((s) => (
            <button key={s.id} className={cx('toc-item', s.id === section.id && 'active')} onClick={() => go(s.id)}>
              <span className="mono tiny faint">{s.number ? String(s.number).padStart(2, '0') : '—'}</span>
              <span className="grow">{s.title}</span>
              {hits.get(s.id) ? <Badge tone="incharge">{hits.get(s.id)}</Badge> : null}
            </button>
          ))}
        </nav>
      )}
      <article className="guide-main">
        <div className="guide-tools">
          {!isProcedure && <button className="btn btn-sm mobile-only" onClick={() => setToc(!toc)}><List /> Contents</button>}
          <div className="pdf-search grow" style={{ maxWidth: 360 }}>
            <Search width={15} />
            <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={isProcedure ? 'Find in this procedure' : 'Find in guide'} aria-label="Find in document" />
            {q.trim().length >= 2 && <span className="tiny faint nowrap">{[...hits.values()].reduce((a, b) => a + b, 0)} matches</span>}
          </div>
          <button className="icon-btn sm" title="Copy section text" aria-label="Copy section text" onClick={() => {
            const text = section.blocks.map((b) => (b.t === 'p' || b.t === 'li' ? b.runs.map((r) => r.x).join('') : b.t === 'h' || b.t === 'note' ? b.text : b.t === 'table' ? b.rows.map((r) => r.join('\t')).join('\n') : '')).filter(Boolean).join('\n')
            void navigator.clipboard?.writeText(`${section.title}\n\n${text}`).then(() => toast('Section copied'))
          }}><Copy /></button>
        </div>
        <header className="guide-head">
          {section.number > 0 && <span className="eyebrow">Module {section.number}</span>}
          <h2>{section.title}</h2>
          {!isProcedure && procFor(section.id) && (
            <button className="btn btn-sm btn-ghost" onClick={() => navigate(`/manual/${procFor(section.id)!.id}`)}>Open as procedure card</button>
          )}
          {isProcedure && doc.parentId && (
            <button className="btn btn-sm btn-ghost" onClick={() => navigate(`/manual/${doc.parentId}?section=${doc.sectionId}`)}>Open in the full User Guide</button>
          )}
        </header>
        <DocBlocks blocks={section.blocks} q={q.trim()} title={doc.title} />
        {!isProcedure && (
          <div className="row" style={{ marginTop: 28, gap: 10 }}>
            {idx > 0 && <button className="btn" onClick={() => go(sections[idx - 1].id)}><ChevronLeft /> {sections[idx - 1].title}</button>}
            <span className="spacer" />
            {idx < sections.length - 1 && <button className="btn" onClick={() => go(sections[idx + 1].id)}>{sections[idx + 1].title} <ChevronRight /></button>}
          </div>
        )}
      </article>
    </div>
  )
}

function PagesText({ content, lang }: { content: DocContent; lang?: string }) {
  if (content.kind !== 'pages') return null
  return (
    <section className="doc-text" aria-label="Document text">
      <div className="row" style={{ marginBottom: 10 }}>
        <h3>Document text</h3>
        <span className="tiny faint">Extracted by OCR from the scanned original — check the page image for exact wording.</span>
      </div>
      {content.pages.map((p) => (
        <div key={p.n} className="page-text" id={`page-text-${p.n}`}>
          <div className="eyebrow">Page {p.n}</div>
          <p dir={lang === 'ar' ? 'rtl' : 'auto'} lang={lang}>{p.text}</p>
        </div>
      ))}
    </section>
  )
}

export function Reader({ docId, onClose }: { docId: string; onClose: () => void }) {
  const doc = useHub((s) => s.data.docs.find((d) => d.id === docId && !d.deleted))
  const categories = useHub((s) => s.data.categories)
  const docs = useHub((s) => s.data.docs)
  const touchRecent = useHub((s) => s.touchRecent)
  const indexReady = useHub((s) => !!s.index)
  const [sp] = useSearchParams()
  const navigate = useNavigate()
  const [content, setContent] = useState<DocContent>()
  const [error, setError] = useState<string>()
  const cat = categories.find((c) => c.id === doc?.category)

  useEffect(() => {
    if (!doc) return
    touchRecent(doc.id)
    setContent(undefined)
    setError(undefined)
    if (doc.contentId && indexReady) getContent(doc.contentId).then(setContent).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.id, indexReady])

  if (!doc) {
    return (
      <Modal open onClose={onClose} title="Document not found">
        <Empty icon={<FileText />} title="This document is not in the library">It may have been removed in a newer data version.</Empty>
      </Modal>
    )
  }
  const related = (doc.related ?? []).map((id) => docs.find((d) => d.id === id && !d.deleted)).filter(Boolean) as ManualDoc[]
  const page = Number(sp.get('page')) || undefined

  return (
    <Modal
      open
      onClose={onClose}
      size="full"
      mobile="full"
      title={
        <span className="reader-title">
          <button className="icon-btn sm mobile-only" onClick={onClose} aria-label="Back"><ArrowLeft /></button>
          <span className={cx('doc-cat', `tone-${cat?.tone}`)}><Glyph name={cat?.glyph ?? 'file'} size={13} /> {cat?.name}</span>
          <span className="truncate" dir="auto">{doc.title}</span>
          {(doc.reference || doc.version) && <Badge tone="muted">{[doc.reference, doc.version].filter(Boolean).join(' ')}</Badge>}
        </span>
      }
      headExtra={doc.fileId && doc.kind !== 'video' && doc.kind !== 'pdf' ? <button className="btn btn-sm desktop-only" onClick={() => void downloadOriginal(doc)}><Download /> Original</button> : undefined}
    >
      <div className="reader-scroll">
        <div className="reader-meta small muted">
          <span>{docMeta(doc)}</span>
          {doc.owner && <span>· Owned by {doc.owner}</span>}
          {doc.updated && <span>· Updated {mediumDate(doc.updated)}</span>}
        </div>
        {doc.kind !== 'procedure' && doc.kind !== 'guide' && <p className="reader-desc">{doc.description}</p>}
        {error && <Empty icon={<FileText />} title="Not available offline yet">{error} — connect to the network once and open it again.</Empty>}

        {doc.kind === 'pdf' && doc.fileId && (
          <>
            <PdfViewer fileId={doc.fileId} pages={content?.kind === 'pages' ? content : undefined} initialPage={page} fileName={doc.fileName} onDownload={() => void downloadOriginal(doc)} />
            {content && <PagesText content={content} lang={doc.lang} />}
          </>
        )}
        {doc.kind === 'video' && doc.fileId && (
          <>
            <VideoPlayer fileId={doc.fileId} posterId={doc.posterId} docId={doc.id} startAt={Number(sp.get('t')) || undefined} onDownload={() => void downloadOriginal(doc)} />
            <section className="doc-text">
              <h3>About this walkthrough</h3>
              <p>{doc.description}</p>
              {doc.tags?.length ? <div className="row-wrap" style={{ marginTop: 10 }}>{doc.tags.map((t) => <Badge key={t} tone="muted">{t}</Badge>)}</div> : null}
            </section>
          </>
        )}
        {(doc.kind === 'guide' || doc.kind === 'procedure') && content?.kind === 'guide' && <GuideView doc={doc} content={content} />}
        {doc.kind === 'segmentation' && content?.kind === 'segmentation' && <SegmentationView content={content} />}
        {!content && !error && doc.contentId && doc.kind !== 'video' && doc.kind !== 'pdf' && <div className="row" style={{ padding: 30, justifyContent: 'center' }}><span className="spinner lg" /></div>}

        {related.length > 0 && (
          <section className="related" aria-label="Related">
            <h3>Related</h3>
            <div className="row-wrap">
              {related.map((r) => {
                const rc = categories.find((c) => c.id === r.category)
                return (
                  <button key={r.id} className={cx('chip', `tone-${rc?.tone}`)} onClick={() => navigate(`/manual/${r.id}`)}>
                    <Glyph name={r.kind === 'video' ? 'play' : rc?.glyph ?? 'file'} size={14} /> {r.title}
                  </button>
                )
              })}
            </div>
          </section>
        )}
      </div>
    </Modal>
  )
}
