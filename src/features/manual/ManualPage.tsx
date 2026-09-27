import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { BookOpen, FileText, Play, Scissors, Layers } from 'lucide-react'
import { useHub } from '../../data/store'
import { useFileUrl } from '../../data/sync'
import type { DocCategory, ManualDoc } from '../../data/types'
import { formatDuration } from '../../lib/dates'
import { formatBytes } from '../../lib/text'
import { Badge, Chip, Empty, Glyph, SearchInput, Highlight, cx } from '../../ui/primitives'
import { runSearch, snippet } from '../search/searchIndex'
import { useSearchIndex } from '../search/SearchPalette'
import { Reader } from './Reader'
import { useDocVideos } from './videos'
import './manual.css'

type Kind = 'all' | 'documents' | 'videos' | 'procedures'

export function docMeta(d: ManualDoc): string {
  if (d.kind === 'video') return `Video · ${d.duration ? formatDuration(d.duration) : ''}`
  if (d.kind === 'pdf') return `PDF · ${d.pageCount ?? '?'} pages${d.fileSize ? ` · ${formatBytes(d.fileSize)}` : ''}`
  if (d.kind === 'guide') return `Guide${d.pageCount ? ` · ${d.pageCount} pages` : ''}`
  if (d.kind === 'segmentation') return 'Live tables + A3 map'
  return `Procedure · ${d.reference ?? ''}`
}

/** "6:49" for one video, "3 videos" for several. */
function videosLabel(videos: ManualDoc[]): string {
  if (videos.length === 1) return videos[0].duration ? formatDuration(videos[0].duration) : 'Video'
  return `${videos.length} videos`
}

function Thumb({ d, videos }: { d: ManualDoc; videos?: ManualDoc[] }) {
  const { url } = useFileUrl(d.posterId)
  const Icon = d.kind === 'video' ? Play : d.kind === 'segmentation' ? Scissors : d.kind === 'guide' ? BookOpen : d.kind === 'procedure' ? Layers : FileText
  return (
    <div className={cx('doc-thumb', d.kind)}>
      {url ? <img src={url} alt="" loading="lazy" /> : <Icon />}
      {d.kind === 'video' && <span className="thumb-play" aria-hidden>▶</span>}
      {d.kind === 'video' && d.duration && <span className="thumb-dur">{formatDuration(d.duration)}</span>}
      {!!videos?.length && <span className="thumb-dur"><Play width={10} height={10} fill="currentColor" style={{ verticalAlign: -1 }} /> {videosLabel(videos)}</span>}
    </div>
  )
}

export function DocCard({ d, cat, snip, videos, onOpen }: { d: ManualDoc; cat?: DocCategory; snip?: { text: string; marks: [number, number][] }; videos?: ManualDoc[]; onOpen: () => void }) {
  return (
    <button className={cx('doc-card', `tone-${cat?.tone ?? 'accent'}`)} onClick={onOpen} aria-label={`${d.title}, ${cat?.name}`}>
      <Thumb d={d} videos={videos} />
      <div className="doc-card-body">
        <span className="doc-cat"><Glyph name={cat?.glyph ?? 'file'} size={13} /> {cat?.name}</span>
        <strong className="doc-title" dir="auto">{d.title}</strong>
        {(d.reference || d.version) && <span className="mono tiny faint">{[d.reference, d.version].filter(Boolean).join(' ')}</span>}
        <p className="doc-desc">{snip ? <Highlight text={snip.text} marks={snip.marks} /> : d.description}</p>
        <div className="doc-foot">
          <span className="tiny faint">{docMeta(d)}{videos?.length ? ` · ${videos.length === 1 ? 'with video' : `with ${videos.length} videos`}` : ''}</span>
          {d.owner && <span className="tiny faint truncate">Owned by: {d.owner}</span>}
        </div>
      </div>
    </button>
  )
}

export function ManualPage() {
  const { docId } = useParams()
  const [sp, setSp] = useSearchParams()
  const navigate = useNavigate()
  const docs = useHub((s) => s.data.docs)
  const categories = useHub((s) => s.data.categories)
  const index = useSearchIndex()
  const [q, setQ] = useState(sp.get('q') ?? '')
  const cat = sp.get('cat') ?? ''
  const kind = (sp.get('kind') as Kind) || 'all'

  useEffect(() => {
    const t = setTimeout(() => {
      const n = new URLSearchParams(sp)
      if (q) n.set('q', q)
      else n.delete('q')
      if (n.toString() !== sp.toString()) setSp(n, { replace: true })
    }, 250)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])

  const { homeOf, videosOf } = useDocVideos()
  const allDocs = useMemo(() => docs.filter((d) => !d.deleted), [docs])
  // videos that belong to a document are shown inside it, not as separate cards
  const liveDocs = useMemo(() => allDocs.filter((d) => !homeOf.has(d.id)), [allDocs, homeOf])

  // an old link or search hit for such a video opens its document with that video selected
  useEffect(() => {
    const id = docId && decodeURIComponent(docId)
    const home = id ? homeOf.get(id) : undefined
    if (!home) return
    const n = new URLSearchParams(sp)
    n.set('video', id!)
    navigate({ pathname: `/manual/${encodeURIComponent(home)}`, search: n.toString() }, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, homeOf])
  const cats = useMemo(() => categories.filter((c) => !c.deleted).sort((a, b) => a.order - b.order), [categories])
  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const d of liveDocs) m.set(d.category, (m.get(d.category) ?? 0) + 1)
    return m
  }, [liveDocs])

  const results = useMemo(() => {
    const byKind = (d: ManualDoc) =>
      kind === 'all' || (kind === 'videos' ? d.kind === 'video' || videosOf.has(d.id) : kind === 'procedures' ? d.kind === 'procedure' : d.kind !== 'video' && d.kind !== 'procedure')
    if (!q.trim()) {
      const list = liveDocs.filter((d) => (!cat || d.category === cat) && byKind(d))
      const order: Record<string, number> = { guide: 0, segmentation: 1, pdf: 2, procedure: 3, video: 4 }
      return list
        .sort((a, b) => (cats.findIndex((c) => c.id === a.category) - cats.findIndex((c) => c.id === b.category)) || order[a.kind] - order[b.kind] || (a.reference ?? '').localeCompare(b.reference ?? '', undefined, { numeric: true }) || a.title.localeCompare(b.title))
        .map((d) => ({ d, snip: undefined as ReturnType<typeof snippet> }))
    }
    const hits = runSearch(index, q, { kinds: ['doc', 'section', 'page', 'glossary'] })
    const seen = new Map<string, ReturnType<typeof snippet>>()
    for (const h of hits) {
      const id = homeOf.get(h.doc.refId) ?? h.doc.refId // a video hit shows its document
      if (!seen.has(id)) seen.set(id, snippet(h.doc.body, h.terms))
    }
    return [...seen.entries()]
      .map(([id, snip]) => ({ d: liveDocs.find((x) => x.id === id)!, snip }))
      .filter((x) => x.d && (!cat || x.d.category === cat) && byKind(x.d))
  }, [q, cat, kind, liveDocs, cats, index, homeOf, videosOf])

  const setParam = (k: string, v?: string) => {
    const n = new URLSearchParams(sp)
    if (v) n.set(k, v)
    else n.delete(k)
    setSp(n, { replace: true })
  }

  const open = (id: string) => navigate({ pathname: `/manual/${encodeURIComponent(id)}` })

  return (
    <div>
      <div className="manual-head">
        <div className="grow" style={{ maxWidth: 640 }}>
          <SearchInput value={q} onChange={setQ} placeholder="Search titles, procedures, references, extracted text and tables…" label="Search the work manual" />
        </div>
        <div className="segmented" role="group" aria-label="Type">
          {(['all', 'documents', 'procedures', 'videos'] as Kind[]).map((k) => (
            <button key={k} aria-pressed={kind === k} onClick={() => setParam('kind', k === 'all' ? undefined : k)}>{k[0].toUpperCase() + k.slice(1)}</button>
          ))}
        </div>
      </div>
      <div className="chips scroll" style={{ margin: '14px 0 18px' }} role="group" aria-label="Categories">
        <Chip pressed={!cat} onClick={() => setParam('cat')} count={liveDocs.length}>All</Chip>
        {cats.filter((c) => counts.get(c.id) || cat === c.id).map((c) => (
          <Chip key={c.id} tone={c.tone} icon={<Glyph name={c.glyph} size={15} />} pressed={cat === c.id} onClick={() => setParam('cat', cat === c.id ? undefined : c.id)} count={counts.get(c.id) ?? 0}>
            {c.name}
          </Chip>
        ))}
      </div>
      {q.trim() && <p className="small muted" style={{ marginBottom: 12 }}>{results.length} result{results.length === 1 ? '' : 's'} for “{q.trim()}”</p>}
      {results.length === 0 ? (
        <Empty icon={<FileText />} title="No documents found.">Try another keyword or category.</Empty>
      ) : (
        <div className="doc-grid">
          {results.map(({ d, snip }) => <DocCard key={d.id} d={d} cat={cats.find((c) => c.id === d.category)} snip={snip} videos={videosOf.get(d.id)} onOpen={() => open(d.id)} />)}
        </div>
      )}
      {docId && !homeOf.has(decodeURIComponent(docId)) && <Reader docId={decodeURIComponent(docId)} onClose={() => navigate({ pathname: '/manual', search: sp.toString().replace(/(^|&)(page|tab|section|t|video)=[^&]*/g, '') })} />}
      <div className="row" style={{ marginTop: 18 }}><Badge tone="muted">{liveDocs.filter((d) => d.kind === 'procedure').length} procedure cards · {liveDocs.filter((d) => d.kind === 'pdf' || d.kind === 'guide' || d.kind === 'segmentation').length} documents · {allDocs.filter((d) => d.kind === 'video').length} videos</Badge></div>
    </div>
  )
}
