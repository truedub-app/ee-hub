/**
 * Build the encrypted Hub pack from the department's source files.
 *
 *   npm run pack                 # full build (preprocesses anything missing)
 *   npm run pack -- --codes      # print the access codes
 *
 * Folders (override with env vars):
 *   HUB_SOURCE   source documents               default: parent of the repo
 *   HUB_CONTENT  catalogue, tables, secrets     default: $HUB_SOURCE/hub-content
 *   HUB_BUILD    preprocessing cache            default: $HUB_SOURCE/hub-build
 *   output       public/pack/ inside the repo (only ciphertext is written here)
 *
 * Nothing in the source, content or build folders is ever copied in plaintext to the repo.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  deriveKey, fromB64, hmacHex, hmacKey, importKey, normalizeCode, open, openJson, PBKDF2_ITERATIONS, randomBytes, seal, sealJson, sha256Hex, toB64,
} from '../../src/lib/crypto.ts'
import { DATA_KEYS, mergeData, mergeList } from '../../src/data/merge.ts'
import { displayName, initials, nameKey } from '../../src/lib/text.ts'
import { PACK_FORMAT, PART_SIZE, ROLE_LABEL, type CoreDataFile, type KeyName, type PackFileEntry, type PackIndex, type PackManifest, type RestrictedDataFile, type SlotPayload } from '../../src/lib/packFormat.ts'
import { DEFAULT_CATEGORIES, DEFAULT_CODES, DEFAULT_SECTIONS } from '../../src/data/defaults.ts'
import type { Block, BlacklistEntry, BlacklistSheet, DocContent, HubData, ManualDoc, RecordMeta, Role, SegmentationContent, Staff } from '../../src/data/types.ts'
import { readWorkbook, workbookGrids } from '../../src/lib/xlsxGrid.ts'
import { applyPlan, buildPlan, detectLayout, staffIdFor } from '../../src/features/rota/import/parseRota.ts'
import { parseContacts } from '../../src/features/contacts/parseContacts.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SOURCE = path.resolve(process.env.HUB_SOURCE ?? path.join(ROOT, '..'))
const CONTENT = path.resolve(process.env.HUB_CONTENT ?? path.join(SOURCE, 'hub-content'))
const BUILD = path.resolve(process.env.HUB_BUILD ?? path.join(SOURCE, 'hub-build'))
const OUT = path.join(ROOT, 'public', 'pack')
const SCRIPTS = path.join(ROOT, 'scripts', 'content')
const PY = process.env.PYTHON ?? 'python'

const log = (...a: unknown[]) => console.log('•', ...a)
const BUILDER = 'Pack builder'

// ---------------------------------------------------------------------------------------
// Secrets: access codes + content keys (kept outside the repo)
// ---------------------------------------------------------------------------------------
interface Secrets {
  /** One code per access level. By default: admin (private) and editor (the shared department link). */
  codes: Partial<Record<Role, string>>
  keys: { core: string; restricted: string; names: string }
  salt: string
}

function newCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = randomBytes(16)
  const chars = Array.from(bytes, (b) => alphabet[b % 32])
  return [0, 4, 8, 12].map((i) => chars.slice(i, i + 4).join('')).join('-')
}

function loadSecrets(): Secrets {
  const file = path.join(CONTENT, 'secrets.json')
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'))
  const s: Secrets = {
    codes: { admin: newCode(), editor: newCode() },
    keys: { core: toB64(randomBytes(32)), restricted: toB64(randomBytes(32)), names: toB64(randomBytes(32)) },
    salt: toB64(randomBytes(16)),
  }
  writeFileSync(file, JSON.stringify(s, null, 2))
  log(`Created ${file} with new access codes — keep this file private.`)
  return s
}

// ---------------------------------------------------------------------------------------
// Preprocessing (cached in HUB_BUILD)
// ---------------------------------------------------------------------------------------
function newer(src: string, out: string): boolean {
  return !existsSync(out) || statSync(src).mtimeMs > statSync(out).mtimeMs
}

function run(cmd: string, args: string[]) {
  execFileSync(cmd, args, { stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env, PYTHONIOENCODING: 'utf-8' } })
}

function extractGuide(id: string, src: string, split: boolean, blur: string[]): string {
  const dir = path.join(BUILD, 'guides', id)
  const json = path.join(dir, 'doc.json')
  if (newer(src, json)) {
    log(`Extracting ${path.basename(src)} …`)
    const args = [path.join(SCRIPTS, 'extract_docx.py'), src, dir]
    if (split) args.push('--split-modules')
    if (blur.length) args.push('--blur', blur.join(','))
    run(PY, args)
  }
  return dir
}

function ocrPdf(id: string, src: string, lang: string): { dir: string; pages: number } {
  const dir = path.join(BUILD, 'pdfs', id)
  const pagesDir = path.join(dir, 'pages')
  if (newer(src, path.join(dir, 'cover.webp'))) {
    log(`Rendering ${path.basename(src)} …`)
    run(PY, [path.join(SCRIPTS, 'render_pdf.py'), src, dir, '200'])
  }
  const pngs = readdirSync(pagesDir).filter((f) => f.endsWith('.png'))
  if (pngs.some((p) => !existsSync(path.join(pagesDir, p.replace('.png', '.txt'))))) {
    log(`OCR (${lang}) ${path.basename(src)} …`)
    run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(SCRIPTS, 'ocr.ps1'), '-Dir', pagesDir, '-Lang', lang])
  }
  return { dir, pages: pngs.length }
}

function compressVideo(id: string, src: string): { file: string; poster: string; duration: number } {
  const dir = path.join(BUILD, 'media')
  mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${id}.mp4`)
  const poster = path.join(dir, `${id}.jpg`)
  if (newer(src, file)) {
    log(`Compressing ${path.basename(src)} …`)
    run('ffmpeg', ['-v', 'error', '-y', '-i', src, '-c:v', 'libx264', '-preset', 'slow', '-crf', '30', '-tune', 'stillimage', '-r', '15',
      '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '64k', '-ac', '1', '-movflags', '+faststart', file])
  }
  if (!existsSync(poster)) {
    run('ffmpeg', ['-v', 'error', '-y', '-ss', '8', '-i', file, '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '4', poster])
  }
  const duration = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim())
  return { file, poster, duration }
}

function webpOf(src: string, out: string, maxW = 2400) {
  if (!newer(src, out)) return
  run(PY, ['-c', `from PIL import Image; im=Image.open(r'''${src}''').convert('RGB'); w=min(im.width,${maxW}); im=im.resize((w, round(im.height*w/im.width))) if w<im.width else im; im.save(r'''${out}''','WEBP',quality=82,method=6)`])
}

/** Windows OCR returns Arabic lines in left-to-right word order; flip them back. */
function fixOcrLine(line: string, lang: string): string {
  const l = line.replace(/\s+/g, ' ').trim()
  if (!lang.startsWith('ar') || !/[؀-ۿ]/.test(l)) return l
  return l.split(' ').reverse().join(' ')
}

// ---------------------------------------------------------------------------------------
// Pack writer
// ---------------------------------------------------------------------------------------
class PackWriter {
  files: Record<string, PackFileEntry> = {}
  written = new Set<string>()
  newBytes = 0
  keys: Record<KeyName, CryptoKey>
  private names: CryptoKey

  constructor(keys: Record<KeyName, CryptoKey>, names: CryptoKey) {
    this.keys = keys
    this.names = names
    mkdirSync(path.join(OUT, 'f'), { recursive: true })
  }

  async add(id: string, bytes: Uint8Array<ArrayBuffer>, mime: string, opts: { key?: KeyName; name?: string } = {}): Promise<string> {
    const key = opts.key ?? 'core'
    const sha = await sha256Hex(bytes)
    const parts: string[] = []
    const count = Math.max(1, Math.ceil(bytes.length / PART_SIZE))
    for (let i = 0; i < count; i++) {
      const name = (await hmacHex(this.names, `${key}:${sha}:${i}:${count}`)).slice(0, 32)
      const rel = `f/${name}.bin`
      const abs = path.join(OUT, rel)
      if (!existsSync(abs)) {
        const chunk = bytes.slice(i * PART_SIZE, (i + 1) * PART_SIZE)
        const sealed = await seal(this.keys[key], chunk)
        writeFileSync(abs, sealed)
        this.newBytes += sealed.length
      }
      this.written.add(rel)
      parts.push(rel)
    }
    this.files[id] = { parts, size: bytes.length, mime, sha, key, name: opts.name }
    return id
  }

  async addFile(id: string, file: string, mime: string, opts: { key?: KeyName; name?: string } = {}) {
    return this.add(id, new Uint8Array(readFileSync(file)), mime, { name: opts.name ?? path.basename(file), key: opts.key })
  }

  async addJson(id: string, value: unknown, key: KeyName = 'core') {
    return this.add(id, new TextEncoder().encode(JSON.stringify(value)), 'application/json', { key })
  }

  /** Remove files from earlier builds that are no longer referenced. */
  prune(keep: Set<string>) {
    let removed = 0
    for (const f of readdirSync(path.join(OUT, 'f'))) {
      if (!keep.has(`f/${f}`)) {
        rmSync(path.join(OUT, 'f', f))
        removed++
      }
    }
    return removed
  }
}

/** Decrypt the version currently in public/pack (if any) with the content keys. */
async function loadPublished(keys: Record<KeyName, CryptoKey>) {
  const manifestPath = path.join(OUT, 'manifest.json')
  if (!existsSync(manifestPath)) return undefined
  const manifest: PackManifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const readRel = (rel: string) => new Uint8Array(readFileSync(path.join(OUT, rel)))
  const readEntry = async (entry: PackFileEntry, key: CryptoKey) => {
    const chunks = await Promise.all(entry.parts.map((p) => open(key, readRel(p))))
    const out = new Uint8Array(chunks.reduce((a, c) => a + c.length, 0))
    let o = 0
    for (const c of chunks) {
      out.set(c, o)
      o += c.length
    }
    return JSON.parse(new TextDecoder().decode(out))
  }
  try {
    const index = await openJson<PackIndex>(keys.core, readRel(manifest.index))
    const core: CoreDataFile = await readEntry(index.files[index.data.core], keys.core)
    const restricted: RestrictedDataFile | undefined = index.data.restricted ? await readEntry(index.files[index.data.restricted], keys.restricted) : undefined
    return { version: manifest.version, index, core, blacklist: restricted?.data.blacklist ?? [], sheets: restricted?.data.sheets ?? [] }
  } catch (e) {
    log(`Could not read the published pack (${e instanceof Error ? e.message : e}) — building from sources only`)
    return undefined
  }
}

// ---------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------
interface Catalogue {
  rota: string[]
  /** Spellings used in the rota → full staff names, e.g. { "Sam": "Samantha" } */
  staffNames?: Record<string, string>
  /**
   * Team members who are not on the rota (e.g. the head of department), or extra details for people who are.
   * Matched by name; `section` defaults to '' = not on the rota.
   */
  team?: (Partial<Pick<Staff, 'jobTitle' | 'section' | 'extension' | 'email' | 'mobile' | 'preferredName'>> & { name: string })[]
  contacts?: string
  guides: {
    id: string; title: string; source: string; category: string; description: string; owner?: string; updated?: string
    pageCount?: number; blur?: string[]; splitModules?: boolean; tags?: string[]
    procedures?: Record<string, { title: string; category: string; description: string; tags?: string[] }>
  }[]
  pdfs: { id: string; title: string; source: string; category: string; reference?: string; version?: string; lang: 'en' | 'ar'; ocr: string; description: string; owner?: string; updated?: string; tags?: string[] }[]
  segmentation?: { id: string; title: string; source: string; content: string; category: string; description: string; owner?: string; tags?: string[] }
  videos: { id: string; title: string; source: string; topic: string; related?: string[]; description: string; tags?: string[] }[]
}

async function main() {
  if (process.argv.includes('--codes')) {
    const s = loadSecrets()
    const site = (process.env.HUB_SITE_URL ?? 'https://truedub-app.github.io/ee-hub/').replace(/\/?$/, '/')
    const label = (r: string) => (r === 'editor' ? 'Department (shared)' : ROLE_LABEL[r as Role])
    for (const [role, code] of Object.entries(s.codes)) {
      console.log(`${label(role).padEnd(20)} ${code}`)
      console.log(`${''.padEnd(20)} ${site}#setup=${code}
`)
    }
    return
  }
  const secrets = loadSecrets()
  const cat: Catalogue = JSON.parse(readFileSync(path.join(CONTENT, 'catalogue.json'), 'utf8'))
  const keys = { core: await importKey(fromB64(secrets.keys.core)), restricted: await importKey(fromB64(secrets.keys.restricted)) }
  const w = new PackWriter(keys, await hmacKey(fromB64(secrets.keys.names)))
  const mtime = (f: string) => Math.floor(statSync(f).mtimeMs)
  const src = (rel: string) => path.join(SOURCE, rel)

  const data: HubData = {
    sections: DEFAULT_SECTIONS, shiftCodes: DEFAULT_CODES, categories: DEFAULT_CATEGORIES,
    staff: [], rota: [], duties: [], docs: [], contacts: [], imports: [],
  }

  // ---- ROTA -----------------------------------------------------------------------------
  for (const rel of cat.rota) {
    const file = src(rel)
    const wb = readWorkbook(readFileSync(file))
    for (const grid of workbookGrids(wb)) {
      const layout = detectLayout(grid, data.sections)
      if (!layout) continue
      const renames = Object.fromEntries(Object.entries(cat.staffNames ?? {}).map(([k, v]) => [nameKey(k), v]))
      const plan = buildPlan(grid, layout, { sections: data.sections, codes: data.shiftCodes, staff: data.staff, renames })
      const now = mtime(file)
      const importId = `imp-${path.basename(rel).replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${grid.sheet.trim().toLowerCase()}`
      const res = applyPlan(plan, {}, data, { importId, actor: BUILDER, now })
      const upsert = <T extends { id: string }>(list: T[], items: T[]) => {
        const m = new Map(list.map((x) => [x.id, x]))
        for (const it of items) m.set(it.id, it)
        return [...m.values()]
      }
      data.staff = upsert(data.staff, res.staff)
      data.rota = upsert(data.rota, res.rota)
      data.duties = upsert(data.duties, res.duties)
      data.imports.push({
        id: importId, kind: 'rota', fileName: path.basename(rel), importedBy: 'Initial pack', importedAt: now, updatedAt: now,
        period: plan.period, warnings: plan.warnings.map((x) => `${x.level === 'info' ? 'ℹ' : '⚠'} ${x.message}`),
        stats: { ...plan.stats, created: res.counts.created, updated: res.counts.updated },
      })
      log(`ROTA ${rel} [${grid.sheet.trim()}]: ${plan.stats.staff} staff, ${plan.stats.days} days, ${plan.stats.cells} cells, ${plan.warnings.length} notes`)
    }
  }

  // ---- Team members from the catalogue (not on the rota, or extra details) ------------------
  for (const t of cat.team ?? []) {
    const { name, ...details } = t
    const key = nameKey(name)
    const found = data.staff.find((s) => nameKey(s.name) === key || s.aliases.some((a) => nameKey(a) === key))
    if (found) Object.assign(found, details)
    else {
      const display = displayName(name)
      data.staff.push({
        id: staffIdFor(display, new Set(data.staff.map((s) => s.id))), name: display, initials: initials(display), aliases: [],
        section: '', active: true, updatedAt: mtime(path.join(CONTENT, 'catalogue.json')), ...details,
      })
    }
    log(`Team: ${displayName(name)}${t.jobTitle ? ` — ${t.jobTitle}` : ''}${found ? ' (details added to the rota record)' : ' (not on the rota)'}`)
  }

  // ---- Contacts -------------------------------------------------------------------------
  if (cat.contacts) {
    const file = src(cat.contacts)
    const wb = readWorkbook(readFileSync(file))
    const res = parseContacts(workbookGrids(wb)[0], mtime(file))
    if (res) {
      data.contacts = res.contacts
      data.imports.push({
        id: 'imp-contacts', kind: 'contacts', fileName: path.basename(file), importedBy: 'Initial pack', importedAt: mtime(file), updatedAt: mtime(file),
        stats: { contacts: res.contacts.length }, warnings: res.fixes.map((f) => `✎ ${f}`),
      })
      log(`Contacts: ${res.contacts.length} (${res.fixes.length} fixes)`)
    }
  }

  const docs: ManualDoc[] = []

  // ---- Guides (docx) ----------------------------------------------------------------------
  for (const g of cat.guides) {
    const file = src(g.source)
    const dir = extractGuide(g.id, file, !!g.splitModules, g.blur ?? [])
    const doc = JSON.parse(readFileSync(path.join(dir, 'doc.json'), 'utf8')) as { sections: { id: string; title: string; number: number; blocks: Block[] }[] }
    // images → pack files; drop duplicate images inside one section
    for (const s of doc.sections) {
      const seen = new Set<string>()
      const blocks: Block[] = []
      for (const b of s.blocks) {
        if (b.t === 'img') {
          if (seen.has(b.src)) continue
          seen.add(b.src)
          const fid = `img:${g.id}:${path.basename(b.src, '.webp')}`
          if (!w.files[fid]) await w.addFile(fid, path.join(dir, b.src), 'image/webp')
          blocks.push({ ...b, fileId: fid })
        } else blocks.push(b)
      }
      s.blocks = blocks
    }
    const sections = doc.sections.filter((s) => s.id !== 'introduction' || s.blocks.some((b) => b.t !== 'img'))
    const content: DocContent = { kind: 'guide', sections: sections.filter((s) => s.id !== 'introduction') }
    if (content.sections.length === 0) content.sections = sections
    const contentId = await w.addJson(`content:${g.id}`, content)
    const firstImg = content.sections.flatMap((s) => s.blocks).find((b) => b.t === 'img') as Extract<Block, { t: 'img' }> | undefined
    docs.push({
      id: g.id, title: g.title, category: g.category, kind: 'guide', description: g.description, owner: g.owner, updated: g.updated,
      pageCount: g.pageCount, contentId, tags: g.tags, posterId: firstImg?.fileId, updatedAt: mtime(file),
      related: g.procedures ? Object.keys(g.procedures).map((n) => `proc-${n.padStart(2, '0')}`) : undefined,
    })
    for (const s of content.sections) {
      const p = g.procedures?.[String(s.number)]
      if (!p) continue
      const img = s.blocks.find((b) => b.t === 'img') as Extract<Block, { t: 'img' }> | undefined
      docs.push({
        id: `proc-${String(s.number).padStart(2, '0')}`, title: p.title, category: p.category, kind: 'procedure', description: p.description,
        reference: `Module ${s.number}`, parentId: g.id, sectionId: s.id, contentId, owner: g.owner, updated: g.updated, tags: p.tags,
        posterId: img?.fileId, updatedAt: mtime(file),
      })
    }
    log(`Guide ${g.id}: ${content.sections.length} sections`)
  }

  // ---- PDFs -----------------------------------------------------------------------------
  for (const p of cat.pdfs) {
    const file = src(p.source)
    const { dir, pages } = ocrPdf(p.id, file, p.ocr)
    const pageTexts = readdirSync(path.join(dir, 'pages')).filter((f) => f.endsWith('.txt')).sort().map((f, i) => ({
      n: i + 1,
      text: readFileSync(path.join(dir, 'pages', f), 'utf8').split(/\r?\n/).map((l) => fixOcrLine(l, p.ocr)).filter(Boolean).join('\n'),
    }))
    const fileId = await w.addFile(`file:${p.id}`, file, 'application/pdf', { name: path.basename(file) })
    const posterId = await w.addFile(`poster:${p.id}`, path.join(dir, 'cover.webp'), 'image/webp')
    const contentId = await w.addJson(`content:${p.id}`, { kind: 'pages', pages: pageTexts } satisfies DocContent)
    docs.push({
      id: p.id, title: p.title, category: p.category, kind: 'pdf', reference: p.reference, version: p.version, lang: p.lang,
      description: p.description, owner: p.owner, updated: p.updated, fileId, fileName: path.basename(file), fileSize: statSync(file).size,
      mime: 'application/pdf', posterId, contentId, pageCount: pages, tags: p.tags, updatedAt: mtime(file),
    })
    log(`PDF ${p.id}: ${pages} pages OCR'd`)
  }

  // ---- Segmentation map ----------------------------------------------------------------------
  if (cat.segmentation) {
    const sgm = cat.segmentation
    const file = src(sgm.source)
    const web = path.join(BUILD, 'segmentation-map.webp')
    webpOf(file, web)
    const table = JSON.parse(readFileSync(path.join(CONTENT, sgm.content), 'utf8')) as SegmentationContent
    const imageId = await w.addFile('img:segmentation-map', web, 'image/webp')
    const fileId = await w.addFile('file:segmentation-map', file, 'image/jpeg', { name: path.basename(file) })
    const contentId = await w.addJson('content:segmentation-map', { ...table, imageId })
    docs.push({
      id: sgm.id, title: sgm.title, category: sgm.category, kind: 'segmentation', description: sgm.description, owner: sgm.owner,
      fileId, fileName: path.basename(file), fileSize: statSync(file).size, mime: 'image/jpeg', posterId: imageId, contentId,
      tags: sgm.tags, related: ['proc-09', 'vid-segmentation', 'vid-qc2'], updatedAt: Math.max(mtime(file), mtime(path.join(CONTENT, sgm.content))),
    })
  }

  // ---- Videos ---------------------------------------------------------------------------
  for (const v of cat.videos) {
    const file = src(v.source)
    const out = compressVideo(v.id, file)
    const fileId = await w.addFile(`file:${v.id}`, out.file, 'video/mp4', { name: `${v.title.replace(/[^\w&\- ]+/g, '').trim()}.mp4` })
    const posterId = await w.addFile(`poster:${v.id}`, out.poster, 'image/jpeg')
    docs.push({
      id: v.id, title: v.title, category: 'walkthroughs', kind: 'video', description: v.description, fileId, posterId,
      fileName: path.basename(file), fileSize: statSync(out.file).size, mime: 'video/mp4', duration: Math.round(out.duration),
      tags: [...(v.tags ?? []), v.topic], related: v.related, updatedAt: mtime(file),
    })
  }
  log(`Videos: ${cat.videos.length}`)

  // cross-links: procedures ↔ videos
  for (const d of docs) {
    for (const r of d.related ?? []) {
      const other = docs.find((x) => x.id === r)
      if (other && !(other.related ?? []).includes(d.id)) other.related = [...(other.related ?? []), d.id]
    }
  }
  data.docs = docs
  // Tag everything this build produced, so a later build can tell builder records from app edits
  for (const k of DATA_KEYS) for (const r of data[k] as RecordMeta[]) r.updatedBy ??= BUILDER

  // ---- Restricted (blacklist) --------------------------------------------------------------
  const blFile = path.join(CONTENT, 'blacklist.json')
  let blacklist: BlacklistEntry[] = existsSync(blFile) ? JSON.parse(readFileSync(blFile, 'utf8')) : []
  let sheets: BlacklistSheet[] = []

  // ---- Keep what was published from the app ------------------------------------------------
  // An administrator can publish edits (duties, blacklist, staff details, imported documents)
  // straight from the app. Merge the currently published version so a rebuild never loses them:
  // for every record the most recently changed version wins.
  const published = await loadPublished(keys)
  if (published) {
    // Builder records that the sources no longer produce (e.g. a renamed person) are dropped, not resurrected.
    const produced = new Map(DATA_KEYS.map((k) => [k, new Set((data[k] as RecordMeta[]).map((r) => r.id))]))
    const carry = { ...published.core.data }
    for (const k of DATA_KEYS) {
      ;(carry as Record<string, RecordMeta[]>)[k] = (published.core.data[k] as RecordMeta[]).filter((r) => r.updatedBy !== BUILDER || produced.get(k)!.has(r.id))
    }
    const merged = mergeData(data, carry)
    Object.assign(data, merged.data)
    blacklist = mergeList(blacklist, published.blacklist)
    sheets = mergeList(sheets, published.sheets)
    let carried = 0
    const appFileIds = [...data.docs.flatMap((d) => [d.fileId, d.posterId, d.contentId]), ...sheets.filter((s) => !s.deleted).map((s) => s.fileId)]
    {
      for (const id of appFileIds) {
        if (!id || w.files[id]) continue
        const entry = published.index.files[id]
        if (!entry) continue
        w.files[id] = entry
        entry.parts.forEach((p) => w.written.add(p))
        carried++
      }
    }
    log(`Merged published v${published.version}: ${merged.stats.added} records only in the app, ${merged.stats.updated} newer in the app; ${carried} app-added files kept`)
  }

  // ---- Index + manifest -------------------------------------------------------------------
  const manifestPath = path.join(OUT, 'manifest.json')
  const prev: PackManifest | undefined = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : undefined
  // revision = HMAC over every file hash + the data itself; unchanged content keeps version & timestamps
  const namesKey = await hmacKey(fromB64(secrets.keys.names))
  const rev = (await hmacHex(namesKey, JSON.stringify([Object.values(w.files).map((f) => f.sha).sort(), data, blacklist, sheets, Object.keys(secrets.codes).sort()]))).slice(0, 24)
  const unchanged = !!prev && prev.rev === rev && existsSync(path.join(OUT, prev.index))
  const version = unchanged ? prev!.version : (prev?.version ?? 0) + 1
  const builtAt = unchanged ? prev!.builtAt : new Date().toISOString()
  const coreFile: CoreDataFile = { version, builtAt, data }
  const restrictedFile: RestrictedDataFile = { version, data: { blacklist, sheets } }
  const coreId = await w.addJson('data:core', coreFile)
  const restrictedId = await w.addJson('data:restricted', restrictedFile, 'restricted')
  const index: PackIndex = { version, builtAt, files: w.files, data: { core: coreId, restricted: restrictedId } }
  const indexName = `f/${(await hmacHex(namesKey, `index:${version}:${rev}`)).slice(0, 32)}.bin`
  if (!existsSync(path.join(OUT, indexName))) writeFileSync(path.join(OUT, indexName), await sealJson(keys.core, index))
  w.written.add(indexName)

  const salt = fromB64(secrets.salt)
  const slots: string[] = []
  for (const role of Object.keys(secrets.codes) as Role[]) {
    const kek = await deriveKey(normalizeCode(secrets.codes[role]!), salt)
    const payload: SlotPayload = {
      role,
      label: ROLE_LABEL[role],
      keys: { core: secrets.keys.core, restricted: role === 'guest' ? undefined : secrets.keys.restricted },
    }
    slots.push(toB64(await sealJson(kek, payload)))
  }
  // shuffle so slot order does not reveal roles
  slots.sort(() => Math.random() - 0.5)
  const manifest: PackManifest = {
    format: PACK_FORMAT, version, builtAt, rev,
    kdf: { name: 'PBKDF2-SHA256', iterations: PBKDF2_ITERATIONS, salt: secrets.salt }, slots, index: indexName,
  }
  if (unchanged) log(`No content changes — pack stays at version ${version}`)
  else writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
  const removed = w.prune(w.written)
  const total = [...w.written].reduce((a, f) => a + statSync(path.join(OUT, f)).size, 0)
  log(`Pack v${version}: ${Object.keys(w.files).length} files, ${(total / 1e6).toFixed(1)} MB (${(w.newBytes / 1e6).toFixed(1)} MB new, ${removed} removed)`)
  log(`Docs ${docs.length} · Staff ${data.staff.length} · Rota cells ${data.rota.length} · Contacts ${data.contacts.length}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
