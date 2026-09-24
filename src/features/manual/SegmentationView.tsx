import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ChevronDown, Copy, Download } from 'lucide-react'
import type { SegmentationContent } from '../../data/types'
import { Badge, SearchInput, Segmented, cx } from '../../ui/primitives'
import { toast } from '../../ui/toast'
import { downloadBytes } from '../../data/backup'
import { fold } from '../../lib/text'
import { PackImage } from './DocBlocks'

type Tab = 'categories' | 'groups' | 'glossary' | 'durations' | 'rules' | 'map'
type Platform = 'all' | 'shahid' | 'mbc'

function copy(text: string) {
  void navigator.clipboard?.writeText(text).then(() => toast('Copied'), () => toast('Copy failed', 'alert'))
}

function csv(rows: string[][]) {
  return '﻿' + rows.map((r) => r.map((c) => `"${(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n')
}

export function SegmentationView({ content }: { content: SegmentationContent }) {
  const [sp, setSp] = useSearchParams()
  const tab = (sp.get('tab') as Tab) || 'categories'
  const [q, setQ] = useState(sp.get('q') ?? '')
  const [platform, setPlatform] = useState<Platform>('all')
  const [sortAsc, setSortAsc] = useState(true)
  const [open, setOpen] = useState<string>()
  const setTab = (t: Tab) => {
    const n = new URLSearchParams(sp)
    n.set('tab', t)
    n.delete('q')
    setSp(n, { replace: true })
  }
  const f = fold(q.trim())
  const match = (...xs: (string | undefined)[]) => !f || xs.some((x) => x && fold(x).includes(f))

  const cats = useMemo(() => {
    const list = content.categories.filter((c) =>
      (platform === 'all' || (platform === 'shahid' ? c.shahid : c.mbc)) &&
      match(c.category, c.notes, c.shahid?.parts, c.shahid?.tit, c.shahid?.ec, c.mbc?.parts, c.mbc?.tit, c.mbc?.ec))
    return sortAsc ? list : [...list].reverse()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, platform, f, sortAsc])

  const exportTable = () => {
    let rows: string[][] = []
    let name = 'segmentation'
    if (tab === 'categories') {
      rows = [['Category', 'Shahid parts', 'Shahid TIT', 'Shahid EC', 'MBC parts', 'MBC TIT', 'MBC EC', 'Notes'], ...cats.map((c) => [c.category, c.shahid?.parts ?? '', c.shahid?.tit ?? '', c.shahid?.ec ?? '', c.mbc?.parts ?? '', c.mbc?.tit ?? '', c.mbc?.ec ?? '', c.notes ?? ''])]
      name = 'segmentation-categories'
    } else if (tab === 'groups') {
      rows = [['File group', 'Usage', 'Channel', 'Required treatment', 'Notes'], ...content.groups.map((g) => [g.group, g.usage, g.channel, g.treatment, g.notes])]
      name = 'segmentation-special-groups'
    } else if (tab === 'glossary') {
      rows = [['Term', 'Meaning', 'Example', 'Platform', 'Related procedure'], ...content.glossary.map((g) => [g.term, g.meaning, g.example ?? '', g.platform, g.related ?? ''])]
      name = 'segmentation-comments-glossary'
    } else if (tab === 'durations') {
      rows = [['Content', 'Average duration', 'Segments', '1st segment', 'Other segments'], ...content.durations.map((d) => [d.content, d.average, String(d.segments), d.first, d.others])]
      name = 'segment-durations'
    }
    if (rows.length) downloadBytes(new TextEncoder().encode(csv(rows)), `${name}.csv`, 'text/csv')
  }

  const Cell = ({ v }: { v?: string }) => {
    if (!v) return <span className="faint">—</span>
    const na = /^not applicable$/i.test(v)
    return <span className={cx(na && 'faint')}>{v}</span>
  }

  return (
    <div className="seg">
      <div className="tabs" role="tablist" aria-label="Segmentation tables">
        {([
          ['categories', 'Content categories', content.categories.length],
          ['groups', 'Special file groups', content.groups.length],
          ['glossary', 'Comments glossary', content.glossary.length],
          ['durations', 'Segment durations', content.durations.length],
          ['rules', 'Standards & QC KPIs', content.rules.length + content.kpis.length],
          ['map', 'Original map', undefined],
        ] as [Tab, string, number | undefined][]).map(([t, l, n]) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>{l}{n !== undefined && <span className="count">{n}</span>}</button>
        ))}
      </div>

      {tab !== 'map' && tab !== 'rules' && (
        <div className="row-wrap" style={{ margin: '14px 0' }}>
          <div className="grow" style={{ minWidth: 220, maxWidth: 420 }}><SearchInput value={q} onChange={setQ} placeholder="Search tables" /></div>
          {tab === 'categories' && (
            <Segmented<Platform> label="Filter by channel" value={platform} onChange={setPlatform} options={[{ value: 'all', label: 'All' }, { value: 'shahid', label: 'Shahid' }, { value: 'mbc', label: 'MBC channels' }]} />
          )}
          <span className="spacer" />
          <button className="btn btn-sm" onClick={exportTable}><Download /> Export table</button>
        </div>
      )}

      <div className="notice tone-alert" style={{ margin: tab === 'map' || tab === 'rules' ? '14px 0' : '0 0 14px' }}>
        <strong>EC needs to be segmented all the time with accurate time codes, even if below 5 seconds.</strong>
      </div>

      {tab === 'categories' && (
        <>
          <div className="table-wrap seg-table desktop-table">
            <table className="table">
              <thead>
                <tr>
                  <th rowSpan={2}><button className="sort" onClick={() => setSortAsc(!sortAsc)}>Content category <ChevronDown width={14} style={{ transform: sortAsc ? undefined : 'rotate(180deg)' }} /></button></th>
                  {platform !== 'mbc' && <th colSpan={3} className="plat shahid">Shahid</th>}
                  {platform !== 'shahid' && <th colSpan={3} className="plat mbc">MBC channels</th>}
                  <th rowSpan={2}>Notes</th>
                  <th rowSpan={2} aria-label="Actions" />
                </tr>
                <tr>
                  {platform !== 'mbc' && <><th>Parts</th><th>TIT</th><th>EC</th></>}
                  {platform !== 'shahid' && <><th>Parts</th><th>TIT</th><th>EC</th></>}
                </tr>
              </thead>
              <tbody>
                {cats.map((c) => (
                  <tr key={c.category} className={`tone-${c.tone}`}>
                    <td className="cat-cell"><span className="dot" />{c.category}</td>
                    {platform !== 'mbc' && <><td><Cell v={c.shahid?.parts} /></td><td><Cell v={c.shahid?.tit} /></td><td><Cell v={c.shahid?.ec} /></td></>}
                    {platform !== 'shahid' && <><td><Cell v={c.mbc?.parts} /></td><td><Cell v={c.mbc?.tit} /></td><td><Cell v={c.mbc?.ec} /></td></>}
                    <td className="small muted">{c.notes}</td>
                    <td>
                      <button className="icon-btn sm" aria-label={`Copy ${c.category} row`} onClick={() => copy(`${c.category}\nShahid — Parts: ${c.shahid?.parts ?? '—'}; TIT: ${c.shahid?.tit ?? '—'}; EC: ${c.shahid?.ec ?? '—'}\nMBC — Parts: ${c.mbc?.parts ?? '—'}; TIT: ${c.mbc?.tit ?? '—'}; EC: ${c.mbc?.ec ?? '—'}`)}><Copy /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mobile-cards col" style={{ gap: 8 }}>
            {cats.map((c) => (
              <div key={c.category} className={cx('card stripe', `tone-${c.tone}`)} style={{ padding: 0 }}>
                <button className="row seg-expand" onClick={() => setOpen(open === c.category ? undefined : c.category)} aria-expanded={open === c.category}>
                  <strong className="grow" style={{ textAlign: 'left' }}>{c.category}</strong>
                  {c.shahid && <Badge tone="cat-shahid">Shahid</Badge>}
                  {c.mbc && <Badge tone="accent">MBC</Badge>}
                  <ChevronDown width={18} style={{ transform: open === c.category ? 'rotate(180deg)' : undefined }} />
                </button>
                {open === c.category && (
                  <div className="col" style={{ gap: 12, padding: '0 16px 14px' }}>
                    {(['shahid', 'mbc'] as const).filter((p) => c[p] && (platform === 'all' || platform === p)).map((p) => (
                      <dl key={p} className="kv">
                        <dt className="eyebrow" style={{ gridColumn: '1 / -1' }}>{p === 'shahid' ? 'Shahid' : 'MBC channels'}</dt>
                        <dt>Parts</dt><dd>{c[p]!.parts}</dd>
                        <dt>TIT</dt><dd><Cell v={c[p]!.tit} /></dd>
                        <dt>EC</dt><dd><Cell v={c[p]!.ec} /></dd>
                      </dl>
                    ))}
                    {c.notes && <p className="small muted">{c.notes}</p>}
                    <button className="btn btn-sm" onClick={() => copy(`${c.category} — Shahid: ${c.shahid?.parts ?? '—'} / MBC: ${c.mbc?.parts ?? '—'}`)}><Copy /> Copy</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {tab === 'groups' && (
        <div className="col" style={{ gap: 10 }}>
          {content.groups.filter((g) => match(g.group, g.usage, g.channel, g.treatment, g.notes)).map((g) => (
            <div key={g.group} className="card card-pad col" style={{ gap: 8 }}>
              <div className="row-wrap"><strong>{g.group}</strong><Badge tone="accent">{g.channel}</Badge><span className="spacer" /><button className="icon-btn sm" aria-label="Copy" onClick={() => copy(`${g.group} (${g.channel})\n${g.treatment}\n${g.notes}`)}><Copy /></button></div>
              <p className="small muted">{g.usage}</p>
              <p><strong>Treatment:</strong> {g.treatment}</p>
              <p className="small" style={{ color: 'var(--text-2)' }}>{g.notes}</p>
            </div>
          ))}
        </div>
      )}

      {tab === 'glossary' && (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Term</th><th>Meaning</th><th>Example</th><th>Platform</th><th aria-label="Actions" /></tr></thead>
            <tbody>
              {content.glossary.filter((g) => match(g.term, g.meaning, g.example, g.platform)).map((g) => (
                <tr key={g.term}>
                  <td><strong className="mono">{g.term}</strong></td>
                  <td>{g.meaning}{g.related && <div className="tiny faint">See {g.related}</div>}</td>
                  <td className="mono small">{g.example ?? ''}</td>
                  <td><Badge tone={g.platform === 'Shahid' ? 'cat-shahid' : g.platform === 'MBC' ? 'accent' : 'muted'}>{g.platform}</Badge></td>
                  <td><button className="icon-btn sm" aria-label={`Copy ${g.term}`} onClick={() => copy(`${g.term}: ${g.meaning}`)}><Copy /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'durations' && (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Content</th><th>Average duration</th><th>Segments</th><th>1st segment</th><th>Other segments</th></tr></thead>
            <tbody>
              {content.durations.filter((d) => match(d.content, d.average)).map((d, i) => (
                <tr key={i}><td>{d.content}</td><td className="mono">{d.average}</td><td className="mono">{d.segments}</td><td className="mono">{d.first}</td><td className="mono">{d.others}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'rules' && (
        <div className="form-grid" style={{ alignItems: 'start' }}>
          <div className="card card-pad col" style={{ gap: 10 }}>
            <span className="eyebrow">Quality control — checking KPIs</span>
            <ol className="doc-list" style={{ margin: 0 }}>{content.kpis.map((k) => <li key={k}>{k}</li>)}</ol>
          </div>
          <div className="card card-pad col" style={{ gap: 10 }}>
            <span className="eyebrow">Standards & practices</span>
            <ul className="doc-list" style={{ margin: 0 }}>{content.rules.map((k) => <li key={k}>{k}</li>)}</ul>
          </div>
        </div>
      )}

      {tab === 'map' && content.imageId && <PackImage fileId={content.imageId} w={2339} h={3307} alt="Segmentation Map Guide (A3)" />}
    </div>
  )
}
