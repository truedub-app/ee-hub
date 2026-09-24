/**
 * Contact-list spreadsheet → Contact records. Shared by the in-app importer and the pack builder.
 * Finds the header row (Team / Name / Title / Responsibility / Ext / Email), normalises team names
 * into directory groups, extracts channels and repairs common data-entry slips.
 */
import type { Contact } from '../../data/types'
import { cleanSpaces, slug } from '../../lib/text'
import type { Grid } from '../rota/import/parseRota'
import { cellText } from '../rota/import/parseRota'

type Field = 'team' | 'name' | 'title' | 'responsibility' | 'ext' | 'email' | 'mobile' | 'notes'

const HEADER_WORDS: [Field, RegExp][] = [
  ['team', /team|department|dept|group/i],
  ['name', /^name|contact|person/i],
  ['title', /title|position|job|role/i],
  ['responsibility', /responsib|channels?|area|covers?/i],
  ['ext', /^ext|extension|phone|tel/i],
  ['email', /e-?mail/i],
  ['mobile', /mobile|cell|gsm/i],
  ['notes', /notes?|comments?/i],
]

const TEAM_RULES: [RegExp, string, string?][] = [
  [/tv\s*services/i, 'TV Services'],
  [/turkish|telenovel/i, 'Acquisition', 'Turkish & Telenovela Acquisition'],
  [/arabic\s*a(c)?quisition/i, 'Acquisition', 'Arabic Acquisition'],
  [/a(c)?quisition/i, 'Acquisition'],
  [/masr/i, 'Scheduling & Planning', 'MASR Scheduling & Planning'],
  [/schedul/i, 'Scheduling & Planning', 'Schedulers'],
  [/plann?er|planning/i, 'Scheduling & Planning', 'Planning'],
  [/tcr|transmission/i, 'Transmission', 'TCR'],
  [/noc|network\s*operations/i, 'Tech Ops', 'NOC'],
  [/\bmam\b/i, 'Tech Ops', 'MAM'],
  [/broadcast/i, 'Tech Ops', 'Broadcast'],
  [/\bmcr\b|media\s*control/i, 'Tech Ops', 'MCR'],
  [/tech\s*ops/i, 'Tech Ops'],
  [/^it$|information\s*tech/i, 'IT'],
  [/current\s*affairs|production/i, 'Production', 'Current Affairs'],
  [/graphic/i, 'Graphics'],
  [/compliance/i, 'Compliance'],
  [/editing|editorial/i, 'Editing & Editorial'],
]

const CHANNELS: [RegExp, string][] = [
  [/mbc\s*drama\s*\+|drama\s*plus/i, 'MBC Drama+'],
  [/mbc\s*drama(?!\s*\+)/i, 'MBC Drama'],
  [/mbc\s*\+?\s*power|\+\s*power/i, 'MBC+ Power'],
  [/mbc\s*msr|mbc\s*masr|\bmasr\b|\bmsr\b/i, 'MBC Masr'],
  [/mbc\s*1\b|mbc1/i, 'MBC 1'],
  [/mbc\s*2\b|mbc2/i, 'MBC 2'],
  [/mbc\s*3\b|mbc3/i, 'MBC 3'],
  [/mbc\s*4\b|mbc4/i, 'MBC 4'],
  [/\baction\b/i, 'MBC Action'],
  [/\bmax\b/i, 'MBC Max'],
  [/v(a)?riety/i, 'MBC Variety'],
  [/bollywood/i, 'MBC Bollywood'],
  [/persia/i, 'MBC Persia'],
  [/\biraq\b/i, 'MBC Iraq'],
  [/\bsport/i, 'Sport'],
  [/shahid/i, 'Shahid'],
  [/al\s*arabiya/i, 'Al Arabiya'],
]

const TITLE_FIXES: [RegExp, string][] = [
  [/^usiness\b/i, 'Business'],
  [/westren/gi, 'Western'],
  [/\s*�\s*/g, ' – '],
  [/\(\s*([^)]*?)\s*\)/g, '($1)'],
  [/\(ARABIC\)/g, '(Arabic)'],
]

export function normaliseTeam(raw: string): { team: string; subTeam?: string } {
  const t = cleanSpaces(raw)
  for (const [rx, team, sub] of TEAM_RULES) if (rx.test(t)) return { team, subTeam: sub ?? (t !== team ? t : undefined) }
  return { team: 'Other', subTeam: t || undefined }
}

export function extractChannels(text: string): string[] {
  const out: string[] = []
  for (const [rx, name] of CHANNELS) {
    if (rx.test(text) && !out.includes(name)) out.push(name)
  }
  // "MBC Drama+" also matches "MBC Drama" — keep both only if both are written
  return out
}

function fixTitle(s: string): string {
  let out = cleanSpaces(s)
  for (const [rx, rep] of TITLE_FIXES) out = out.replace(rx, rep)
  return out
}

function fixEmail(s: string): string {
  return cleanSpaces(s).replace(/^[<"']+|[>"',;]+$/g, '')
}

export interface ContactsParse {
  contacts: Contact[]
  fixes: string[]
  headerRow: number
}

export function parseContacts(grid: Grid, now: number): ContactsParse | null {
  let headerRow = -1
  let map: Partial<Record<Field, number>> = {}
  for (let r = 0; r < Math.min(grid.rows.length, 30); r++) {
    const m: Partial<Record<Field, number>> = {}
    grid.rows[r].forEach((v, col) => {
      const h = cellText(v)
      if (!h) return
      for (const [f, rx] of HEADER_WORDS) {
        if (rx.test(h) && m[f] === undefined) {
          m[f] = col
          break
        }
      }
    })
    if (m.name !== undefined && (m.email !== undefined || m.ext !== undefined)) {
      headerRow = r
      map = m
      break
    }
  }
  if (headerRow < 0) return null

  const fixes: string[] = []
  const contacts: Contact[] = []
  const ids = new Set<string>()
  const get = (row: (typeof grid.rows)[number], f: Field) => (map[f] !== undefined ? cellText(row[map[f]!]) : '')

  for (let r = headerRow + 1; r < grid.rows.length; r++) {
    const row = grid.rows[r]
    const name = cleanSpaces(get(row, 'name'))
    if (!name) continue
    const rawTeam = get(row, 'team')
    const { team, subTeam } = normaliseTeam(rawTeam || name)
    const rawTitle = get(row, 'title')
    const title = fixTitle(rawTitle)
    if (title !== cleanSpaces(rawTitle)) fixes.push(`Row ${r + grid.rowOffset + 1}: title “${cleanSpaces(rawTitle)}” → “${title}”`)
    const rawEmail = get(row, 'email')
    const email = fixEmail(rawEmail)
    if (email !== cleanSpaces(rawEmail)) fixes.push(`Row ${r + grid.rowOffset + 1}: email “${cleanSpaces(rawEmail)}” → “${email}”`)
    const responsibility = cleanSpaces(get(row, 'responsibility').replace(/\s*,\s*/g, ', ').replace(/\(\s*/g, '(').replace(/\s*\)/g, ')'))
    let ext = get(row, 'ext').replace(/\s+/g, '')
    if (ext === '-' || ext === '–') ext = ''
    const isGroup =
      /group|team|center|centre/i.test(name) ||
      cleanSpaces(name).toLowerCase() === cleanSpaces(title).toLowerCase() ||
      /^[A-Z]{2,5}$/.test(name) ||
      /^(currentaffairs|mam|noc|mcr)$/i.test(name.replace(/\s/g, ''))
    let id = 'ct-' + slug(`${name}-${team}`)
    while (ids.has(id)) id += '-2'
    ids.add(id)
    contacts.push({
      id,
      name: name === 'CurrentAffairs' ? 'Current Affairs' : name,
      kind: isGroup ? 'group' : 'person',
      jobTitle: title && title.toLowerCase() !== name.toLowerCase() ? title : undefined,
      team,
      subTeam,
      channels: extractChannels(responsibility),
      responsibility: responsibility || undefined,
      extension: ext || undefined,
      mobile: get(row, 'mobile') || undefined,
      email: email || undefined,
      notes: get(row, 'notes') || undefined,
      updatedAt: now,
    })
  }
  return { contacts, fixes, headerRow }
}
