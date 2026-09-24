import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Download, Search, ZoomIn, ZoomOut, Maximize } from 'lucide-react'
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { useHub } from '../../data/store'
import { entryFor } from '../../data/sync'
import { readFile } from '../../lib/pack'
import { Progress } from '../../ui/primitives'
import type { PagesContent } from '../../data/types'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

function PdfPage({ pdf, n, scale, onVisible }: { pdf: PDFDocumentProxy; n: number; scale: number; onVisible: (n: number) => void }) {
  const holder = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState<{ w: number; h: number }>()
  const [show, setShow] = useState(n <= 2)

  useEffect(() => {
    let alive = true
    void pdf.getPage(n).then((p) => {
      const vp = p.getViewport({ scale })
      if (alive) setSize({ w: vp.width, h: vp.height })
    })
    return () => {
      alive = false
    }
  }, [pdf, n, scale])

  useEffect(() => {
    const el = holder.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setShow(true)
            if (e.intersectionRatio > 0.4) onVisible(n)
          }
        }
      },
      { rootMargin: '600px 0px', threshold: [0, 0.4] },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [n, onVisible])

  useEffect(() => {
    if (!show || !canvas.current) return
    let task: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | undefined
    let alive = true
    void pdf.getPage(n).then((p) => {
      if (!alive || !canvas.current) return
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const vp = p.getViewport({ scale: scale * dpr })
      const c = canvas.current
      c.width = vp.width
      c.height = vp.height
      task = p.render({ canvas: c, viewport: vp })
      task.promise.catch(() => {})
    })
    return () => {
      alive = false
      task?.cancel()
    }
  }, [pdf, n, scale, show])

  return (
    <div ref={holder} className="pdf-page" data-page={n} style={size ? { width: size.w, height: size.h } : { width: 595 * scale, height: 842 * scale }}>
      {show && <canvas ref={canvas} style={{ width: '100%', height: '100%' }} aria-label={`Page ${n}`} />}
      <span className="pdf-page-no">{n}</span>
    </div>
  )
}

export function PdfViewer({ fileId, pages, initialPage, fileName, onDownload }: { fileId: string; pages?: PagesContent; initialPage?: number; fileName?: string; onDownload: () => void }) {
  const session = useHub((s) => s.session)
  const [pdf, setPdf] = useState<PDFDocumentProxy>()
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string>()
  const [scale, setScale] = useState(1)
  const [page, setPage] = useState(initialPage ?? 1)
  const [q, setQ] = useState('')
  const scroller = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const entry = entryFor(fileId)
    if (!entry || !session) return
    let alive = true
    let doc: PDFDocumentProxy | undefined
    readFile(entry, session.keys, (d, t) => alive && setProgress(d / t))
      .then((bytes) => pdfjs.getDocument({ data: bytes }).promise)
      .then((d) => {
        doc = d
        if (!alive) return void d.loadingTask.destroy()
        setPdf(d)
        // fit width on first load
        const w = scroller.current?.clientWidth ?? 800
        setScale(Math.max(0.5, Math.min(1.6, (w - 32) / 595)))
      })
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      alive = false
      void doc?.loadingTask.destroy()
    }
  }, [fileId, session])

  const go = (n: number) => {
    if (!pdf) return
    const target = Math.max(1, Math.min(pdf.numPages, n))
    scroller.current?.querySelector<HTMLElement>(`[data-page="${target}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    setPage(target)
  }

  useEffect(() => {
    if (pdf && initialPage && initialPage > 1) setTimeout(() => go(initialPage), 250)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdf, initialPage])

  const hits = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!pages || needle.length < 2) return []
    return pages.pages.filter((p) => p.text.toLowerCase().includes(needle)).map((p) => p.n)
  }, [pages, q])

  const fit = () => {
    const w = scroller.current?.clientWidth ?? 800
    setScale(Math.max(0.5, Math.min(2.5, (w - 32) / 595)))
  }

  return (
    <div className="pdf-viewer">
      <div className="pdf-toolbar">
        <button className="icon-btn sm" onClick={() => go(page - 1)} aria-label="Previous page" disabled={!pdf || page <= 1}><ChevronLeft /></button>
        <span className="small num">
          <input className="input page-input" value={page} onChange={(e) => setPage(Number(e.target.value.replace(/\D/g, '')) || 1)} onKeyDown={(e) => e.key === 'Enter' && go(page)} aria-label="Page number" /> / {pdf?.numPages ?? '…'}
        </span>
        <button className="icon-btn sm" onClick={() => go(page + 1)} aria-label="Next page" disabled={!pdf || page >= (pdf?.numPages ?? 1)}><ChevronRight /></button>
        <span className="sep" />
        <button className="icon-btn sm" onClick={() => setScale((s) => Math.max(0.4, +(s - 0.15).toFixed(2)))} aria-label="Zoom out"><ZoomOut /></button>
        <span className="small num" style={{ minWidth: 44, textAlign: 'center' }}>{Math.round(scale * 100)}%</span>
        <button className="icon-btn sm" onClick={() => setScale((s) => Math.min(3, +(s + 0.15).toFixed(2)))} aria-label="Zoom in"><ZoomIn /></button>
        <button className="icon-btn sm" onClick={fit} aria-label="Fit width"><Maximize /></button>
        <span className="spacer" />
        {pages && (
          <div className="pdf-search">
            <Search width={15} />
            <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search in document" aria-label="Search in document" dir="auto" />
            {q.trim().length >= 2 && <span className="tiny faint nowrap">{hits.length ? `${hits.length} page${hits.length === 1 ? '' : 's'}` : 'No match'}</span>}
          </div>
        )}
        <button className="btn btn-sm" onClick={onDownload} title={fileName}><Download /> <span className="desktop-only">Download original</span></button>
      </div>
      {hits.length > 0 && (
        <div className="pdf-hits">
          {hits.map((n) => <button key={n} className="chip" aria-pressed={n === page} onClick={() => go(n)}>p. {n}</button>)}
        </div>
      )}
      <div className="pdf-scroll" ref={scroller}>
        {error && <p style={{ color: 'var(--alert)', padding: 20 }}>{error}</p>}
        {!pdf && !error && (
          <div className="col" style={{ padding: 40, alignItems: 'center', gap: 12 }}>
            <span className="spinner lg" />
            <span className="small muted">Decrypting document… {Math.round(progress * 100)}%</span>
            <div style={{ width: 220 }}><Progress value={progress} /></div>
          </div>
        )}
        {pdf && Array.from({ length: pdf.numPages }, (_, i) => <PdfPage key={i} pdf={pdf} n={i + 1} scale={scale} onVisible={setPage} />)}
      </div>
    </div>
  )
}
