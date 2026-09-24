/** Global offline search. One MiniSearch index over staff, contacts, manual content, glossary and (if permitted) blacklist. */
import MiniSearch from 'minisearch'
import type { BlacklistEntry, BlacklistSheet, Block, Contact, DocCategory, DocContent, ManualDoc, Section, Staff } from '../../data/types'
import { fold } from '../../lib/text'

export type HitKind = 'staff' | 'contact' | 'doc' | 'section' | 'page' | 'glossary' | 'blacklist'

export interface SearchDoc {
  id: string
  kind: HitKind
  title: string
  subtitle?: string
  tags?: string
  body?: string
  route: string
  refId: string // staff / contact / doc / entry id
  page?: number
  lang?: string
}

function processTerm(term: string): string | string[] | null {
  const t = fold(term).replace(/[^\p{L}\p{N}]+/gu, '')
  if (!t) return null
  if (/^ال/.test(t) && t.length > 4) return [t, t.slice(2)] // Arabic definite article
  if (/^(wa|و)/.test(t) && t.length > 5 && /[؀-ۿ]/.test(t)) return [t, t.slice(1)]
  return t
}

function blocksText(blocks: Block[]): string {
  const out: string[] = []
  for (const b of blocks) {
    if (b.t === 'h' || b.t === 'note') out.push(b.text)
    else if (b.t === 'p' || b.t === 'li') out.push(b.runs.map((r) => r.x).join(''))
    else if (b.t === 'table') out.push(b.rows.map((r) => r.join(' · ')).join('\n'))
  }
  return out.join('\n')
}

export interface IndexInput {
  staff: Staff[]
  sections: Section[]
  contacts: Contact[]
  docs: ManualDoc[]
  categories: DocCategory[]
  contents: Record<string, DocContent>
  blacklist?: BlacklistEntry[]
  sheets?: BlacklistSheet[]
}

export interface SearchIndex {
  mini: MiniSearch<SearchDoc>
  byId: Map<string, SearchDoc>
}

export function buildSearchIndex(input: IndexInput): SearchIndex {
  const docs: SearchDoc[] = []
  const sec = (id: string) => input.sections.find((s) => s.id === id)?.name ?? id
  const cat = (id: string) => input.categories.find((c) => c.id === id)?.name ?? id

  for (const s of input.staff) {
    if (s.deleted) continue
    docs.push({
      id: `staff:${s.id}`, kind: 'staff', refId: s.id, title: s.name,
      subtitle: [s.jobTitle ?? 'Editing & Editorial', sec(s.section)].join(' · '),
      tags: [s.preferredName, ...(s.aliases ?? []), s.extension, s.email, ...(s.skills ?? []), ...(s.languages ?? [])].filter(Boolean).join(' '),
      route: `/contacts/staff/${encodeURIComponent(s.id)}`,
    })
  }
  for (const c of input.contacts) {
    if (c.deleted) continue
    docs.push({
      id: `contact:${c.id}`, kind: 'contact', refId: c.id, title: c.name,
      subtitle: [c.jobTitle, c.subTeam ?? c.team].filter(Boolean).join(' · '),
      tags: [c.team, c.subTeam, ...c.channels, c.extension, c.email].filter(Boolean).join(' '),
      body: c.responsibility,
      route: `/contacts?focus=${encodeURIComponent(c.id)}`,
    })
  }
  for (const d of input.docs) {
    if (d.deleted) continue
    const content = d.contentId ? input.contents[d.contentId] : undefined
    let body = d.description
    if (d.kind === 'procedure' && content?.kind === 'guide') {
      const s = content.sections.find((x) => x.id === d.sectionId)
      if (s) body += '\n' + blocksText(s.blocks)
    }
    if (d.kind === 'guide' && content?.kind === 'guide' && !input.docs.some((p) => p.parentId === d.id)) {
      body += '\n' + content.sections.map((s) => blocksText(s.blocks)).join('\n')
    }
    docs.push({
      id: `doc:${d.id}`, kind: 'doc', refId: d.id, title: d.title,
      subtitle: [cat(d.category), d.reference, d.version, d.kind === 'video' ? 'Video' : d.kind === 'pdf' ? 'PDF' : undefined].filter(Boolean).join(' · '),
      tags: [...(d.tags ?? []), d.owner, cat(d.category)].filter(Boolean).join(' '),
      body, route: `/manual/${encodeURIComponent(d.id)}`, lang: d.lang,
    })
    if (d.kind === 'pdf' && content?.kind === 'pages') {
      for (const p of content.pages) {
        if (!p.text.trim()) continue
        docs.push({
          id: `page:${d.id}:${p.n}`, kind: 'page', refId: d.id, page: p.n, title: d.title, subtitle: `Page ${p.n}`,
          body: p.text, route: `/manual/${encodeURIComponent(d.id)}?page=${p.n}`, lang: d.lang,
        })
      }
    }
    if (d.kind === 'segmentation' && content?.kind === 'segmentation') {
      for (const g of content.glossary) {
        docs.push({
          id: `gloss:${d.id}:${g.term}`, kind: 'glossary', refId: d.id, title: g.term, subtitle: `Segmentation comment · ${g.platform}`,
          body: [g.meaning, g.example].filter(Boolean).join(' — '), route: `/manual/${encodeURIComponent(d.id)}?tab=glossary&q=${encodeURIComponent(g.term)}`,
        })
      }
      for (const c of content.categories) {
        const txt = [c.shahid && `Shahid: parts ${c.shahid.parts}; TIT ${c.shahid.tit}; EC ${c.shahid.ec}`, c.mbc && `MBC: parts ${c.mbc.parts}; TIT ${c.mbc.tit}; EC ${c.mbc.ec}`, c.notes]
        docs.push({
          id: `segcat:${d.id}:${c.category}`, kind: 'section', refId: d.id, title: `${c.category} — segmentation`, subtitle: 'Segmentation Map',
          body: txt.filter(Boolean).join('\n'), route: `/manual/${encodeURIComponent(d.id)}?tab=categories&q=${encodeURIComponent(c.category)}`,
        })
      }
    }
  }
  for (const b of input.blacklist ?? []) {
    if (b.deleted) continue
    docs.push({
      id: `bl:${b.id}`, kind: 'blacklist', refId: b.id, title: b.name, subtitle: b.category,
      tags: [...b.aliases, ...b.programs, ...b.channels].join(' '), body: b.reason,
      route: `/blacklist?focus=${encodeURIComponent(b.id)}`,
    })
  }

  for (const sh of input.sheets ?? []) {
    if (sh.deleted) continue
    sh.names.forEach((n, i) => {
      docs.push({ id: `sheet:${sh.id}:${i}`, kind: 'blacklist', refId: sh.id, title: n, subtitle: `On the blacklist image — ${sh.title}`, route: '/blacklist' })
    })
  }

  const mini = new MiniSearch<SearchDoc>({
    fields: ['title', 'subtitle', 'tags', 'body'],
    storeFields: ['kind'],
    processTerm,
    searchOptions: {
      boost: { title: 5, tags: 2.5, subtitle: 2, body: 1 },
      prefix: (term) => term.length >= 2,
      fuzzy: (term) => (term.length > 4 ? 0.2 : false),
      combineWith: 'AND',
    },
  })
  mini.addAll(docs)
  return { mini, byId: new Map(docs.map((d) => [d.id, d])) }
}

export interface Hit {
  doc: SearchDoc
  score: number
  terms: string[]
}

export function runSearch(index: SearchIndex, q: string, opts: { kinds?: HitKind[]; limit?: number } = {}): Hit[] {
  const query = q.trim()
  if (!query) return []
  let res = index.mini.search(query)
  if (res.length === 0) res = index.mini.search(query, { combineWith: 'OR' })
  const hits: Hit[] = []
  for (const r of res) {
    const doc = index.byId.get(r.id as string)
    if (!doc || (opts.kinds && !opts.kinds.includes(doc.kind))) continue
    hits.push({ doc, score: r.score, terms: r.terms })
    if (opts.limit && hits.length >= opts.limit) break
  }
  return hits
}

/** Short excerpt around the first matching term, with match ranges for highlighting. */
export function snippet(text: string | undefined, terms: string[], radius = 70): { text: string; marks: [number, number][] } | undefined {
  if (!text) return undefined
  const flat = text.replace(/\s+/g, ' ')
  const lower = flat.toLowerCase()
  let at = -1
  let len = 0
  for (const t of terms) {
    const i = lower.indexOf(t.toLowerCase())
    if (i >= 0 && (at < 0 || i < at)) {
      at = i
      len = t.length
    }
  }
  if (at < 0) return { text: flat.slice(0, radius * 2) + (flat.length > radius * 2 ? '…' : ''), marks: [] }
  const start = Math.max(0, at - radius)
  const end = Math.min(flat.length, at + len + radius)
  const pre = start > 0 ? '…' : ''
  const excerpt = pre + flat.slice(start, end) + (end < flat.length ? '…' : '')
  const marks: [number, number][] = []
  const ex = excerpt.toLowerCase()
  for (const t of terms) {
    let i = ex.indexOf(t.toLowerCase())
    while (i >= 0 && t.length > 1) {
      marks.push([i, i + t.length])
      i = ex.indexOf(t.toLowerCase(), i + t.length)
    }
  }
  marks.sort((a, b) => a[0] - b[0])
  return { text: excerpt, marks }
}
