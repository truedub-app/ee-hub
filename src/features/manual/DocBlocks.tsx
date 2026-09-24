import { useState, type ReactNode } from 'react'
import { ImageOff, Maximize2 } from 'lucide-react'
import type { Block, Run } from '../../data/types'
import { useFileUrl } from '../../data/sync'
import { Modal } from '../../ui/primitives'
import { isArabic } from '../../lib/text'

function mark(text: string, q?: string): ReactNode {
  if (!q || q.length < 2) return text
  const lower = text.toLowerCase()
  const needle = q.toLowerCase()
  const out: ReactNode[] = []
  let at = 0
  let i = lower.indexOf(needle)
  while (i >= 0) {
    out.push(text.slice(at, i), <mark key={i}>{text.slice(i, i + needle.length)}</mark>)
    at = i + needle.length
    i = lower.indexOf(needle, at)
  }
  out.push(text.slice(at))
  return out
}

function Runs({ runs, q }: { runs: Run[]; q?: string }) {
  return (
    <>
      {runs.map((r, i) => {
        let node: ReactNode = mark(r.x, q)
        if (r.b) node = <strong>{node}</strong>
        if (r.i) node = <em>{node}</em>
        if (r.alert) node = <span className="run-alert">{node}</span>
        return <span key={i}>{node}</span>
      })}
    </>
  )
}

export function PackImage({ fileId, w, h, alt }: { fileId?: string; w: number; h: number; alt: string }) {
  const { url, error } = useFileUrl(fileId)
  const [zoom, setZoom] = useState(false)
  if (error || !fileId) {
    return <div className="doc-img missing" style={{ aspectRatio: `${w} / ${h}` }}><ImageOff /> <span className="small">Image not available offline yet</span></div>
  }
  return (
    <>
      <button className="doc-img" onClick={() => url && setZoom(true)} style={{ aspectRatio: `${w} / ${h}`, maxWidth: Math.min(w, 900) }} aria-label="Enlarge screenshot">
        {url ? <img src={url} alt={alt} loading="lazy" width={w} height={h} /> : <span className="skeleton" style={{ position: 'absolute', inset: 0 }} />}
        {url && <span className="zoom-hint"><Maximize2 /></span>}
      </button>
      {zoom && url && (
        <Modal open onClose={() => setZoom(false)} title="Screenshot" size="full" mobile="full">
          <img src={url} alt={alt} style={{ width: '100%', height: 'auto', borderRadius: 8, background: '#fff' }} />
        </Modal>
      )}
    </>
  )
}

/** Render extracted Word content. Consecutive list items become real lists. */
export function DocBlocks({ blocks, q, title }: { blocks: Block[]; q?: string; title?: string }) {
  const out: ReactNode[] = []
  // Word keeps counting a numbered list across interruptions (notes, screenshots): continue per list id
  const counters = new Map<number, number>()
  let i = 0
  while (i < blocks.length) {
    const b = blocks[i]
    if (b.t === 'li') {
      const items: Extract<Block, { t: 'li' }>[] = []
      while (i < blocks.length && blocks[i].t === 'li') {
        items.push(blocks[i] as Extract<Block, { t: 'li' }>)
        i++
      }
      const ordered = items[0].ordered
      const List = ordered ? 'ol' : 'ul'
      const start = (counters.get(items[0].list) ?? 0) + 1
      if (ordered) counters.set(items[0].list, start - 1 + items.filter((it) => it.level === 0).length)
      out.push(
        <List key={`l${i}`} className="doc-list" start={ordered && start > 1 ? start : undefined}>
          {items.map((it, k) => (
            <li key={k} style={{ marginInlineStart: it.level * 20 }} dir="auto">
              <Runs runs={it.runs} q={q} />
            </li>
          ))}
        </List>,
      )
      continue
    }
    const k = `b${i}`
    if (b.t === 'h') {
      const H = b.level <= 1 ? 'h2' : b.level === 2 ? 'h3' : 'h4'
      out.push(<H key={k} className="doc-h" dir="auto">{mark(b.text, q)}</H>)
    } else if (b.t === 'p') {
      const text = b.runs.map((r) => r.x).join('')
      out.push(<p key={k} className="doc-p" dir={isArabic(text) ? 'rtl' : 'auto'}><Runs runs={b.runs} q={q} /></p>)
    } else if (b.t === 'note') {
      out.push(<div key={k} className="doc-note" role="note">{mark(b.text, q)}</div>)
    } else if (b.t === 'img') {
      out.push(<PackImage key={k} fileId={b.fileId} w={b.w} h={b.h} alt={`Screenshot from ${title ?? 'the manual'}`} />)
    } else if (b.t === 'table') {
      out.push(
        <div key={k} className="table-wrap doc-table">
          <table className="table">
            <tbody>
              {b.rows.map((r, ri) => (
                <tr key={ri}>{r.map((c, ci) => (ri === 0 ? <th key={ci}>{c}</th> : <td key={ci} dir="auto" style={{ whiteSpace: 'pre-line' }}>{mark(c, q)}</td>))}</tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
    }
    i++
  }
  return <div className="doc-body">{out}</div>
}
