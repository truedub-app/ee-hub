/**
 * Domain model for the Editing & Editorial Hub.
 *
 * Every synced record carries `id` + `updatedAt`. Merging between devices, backups and
 * published packs is last-write-wins per record id; deletions travel as tombstones.
 */

export type ISODate = string // 'YYYY-MM-DD'

export interface RecordMeta {
  id: string
  updatedAt: number
  updatedBy?: string
  deleted?: boolean
}

export type Role = 'admin' | 'manager' | 'editor' | 'guest'

export interface Section extends RecordMeta {
  name: string // 'Morning'
  short: string // 'M'
  start: string // '08:00'
  end: string // '16:00'
  tone: string // colour token: 'morning' | 'afternoon' | 'night' | 'graphics' | ...
  order: number
  duties: boolean // requires In-Charge + QC 2 each day
}

export type CodeKind = 'work' | 'duty' | 'rest' | 'absence' | 'other'

export interface ShiftCode extends RecordMeta {
  code: string // 'M', 'A', 'N', 'Q', 'OFF', 'HOL', 'TOIL', 'SICK', 'TRN', 'REM'
  label: string
  kind: CodeKind
  band?: string // section id for 'work' codes
  hours?: string // '08:00–16:00'
  glyph: string // one/two chars for the compact month grid
  tone: string // colour token
  builtin?: boolean
  /** Regular expressions (case-insensitive) matched against spreadsheet cell text on import. */
  match?: string[]
}

export interface Staff extends RecordMeta {
  name: string
  preferredName?: string
  initials: string
  aliases: string[] // raw spellings seen in rota imports
  employeeId?: string
  jobTitle?: string
  section: string // home section id
  suite?: string
  extension?: string
  email?: string
  mobile?: string
  skills?: string[]
  languages?: string[]
  inChargeEligible?: boolean
  qc2Eligible?: boolean
  active: boolean
  review?: string // why this record needs attention
}

/** One cell of the rota. id = `${staffId}|${date}` */
export interface RotaAssignment extends RecordMeta {
  staffId: string
  date: ISODate
  code: string
  band?: string // section actually worked (for work / duty codes)
  suite?: string
  note?: string
  raw?: string // original spreadsheet text
  sourceImportId?: string
  inferred?: string // explanation when band was inferred
}

/** Duty holders for one band on one day. id = `${date}|${band}` */
export interface DutyAssignment extends RecordMeta {
  date: ISODate
  band: string
  inChargeId?: string
  qc2Id?: string
}

export type DocKind = 'pdf' | 'video' | 'guide' | 'procedure' | 'segmentation'

export interface DocCategory extends RecordMeta {
  name: string
  tone: string
  glyph: string // lucide icon name
  order: number
  description?: string
}

export interface ManualDoc extends RecordMeta {
  title: string
  category: string // DocCategory id
  kind: DocKind
  reference?: string
  version?: string
  description: string
  owner?: string
  lang?: 'en' | 'ar'
  fileId?: string // original file / media in the pack
  fileName?: string
  fileSize?: number
  mime?: string
  posterId?: string
  contentId?: string // structured content (blocks / pages / tables)
  sectionId?: string // procedure → section inside a guide
  parentId?: string // procedure → guide doc id
  pageCount?: number
  duration?: number // seconds
  updated?: ISODate // document's own revision date
  tags?: string[]
  related?: string[] // doc ids
}

/** Structured document content, stored as a separate pack file. */
export type Run = { x: string; b?: 1; i?: 1; u?: 1; alert?: 1 }
export type Block =
  | { t: 'h'; level: number; text: string }
  | { t: 'p'; runs: Run[] }
  | { t: 'li'; runs: Run[]; level: number; list: number; ordered: boolean }
  | { t: 'note'; text: string }
  | { t: 'img'; src: string; w: number; h: number; fileId?: string }
  | { t: 'table'; rows: string[][] }

export interface GuideContent {
  kind: 'guide'
  sections: { id: string; title: string; number: number; blocks: Block[] }[]
}
export interface PagesContent {
  kind: 'pages'
  pages: { n: number; text: string }[]
}
export interface SegmentationContent {
  kind: 'segmentation'
  imageId?: string
  categories: {
    category: string
    tone: string
    shahid?: { parts: string; tit: string; ec: string }
    mbc?: { parts: string; tit: string; ec: string }
    notes?: string
  }[]
  groups: { group: string; usage: string; channel: string; treatment: string; notes: string }[]
  glossary: { term: string; meaning: string; example?: string; platform: string; related?: string }[]
  durations: { content: string; average: string; segments: number; first: string; others: string }[]
  kpis: string[]
  rules: string[]
}
export type DocContent = GuideContent | PagesContent | SegmentationContent

export interface Contact extends RecordMeta {
  name: string
  kind: 'person' | 'group'
  jobTitle?: string
  team: string // group: 'TV Services', 'Tech Ops', ...
  subTeam?: string
  channels: string[]
  responsibility?: string
  extension?: string
  mobile?: string
  email?: string
  notes?: string
}

export type BlacklistCategory = 'actor' | 'journalist' | 'presenter' | 'contributor' | 'other'
export type BlacklistStatus = 'do-not-book' | 'review-required' | 'restricted' | 'cleared'

export interface BlacklistEntry extends RecordMeta {
  name: string
  category: BlacklistCategory
  aliases: string[]
  programs: string[]
  channels: string[]
  status: BlacklistStatus
  reason: string
  source?: string
  dateAdded: ISODate
  lastReviewed?: ISODate
  reviewOwner?: string
  reviewDue?: ISODate
  notes?: string
  active: boolean
}

/** An image of the blacklist (e.g. the official sheet), encrypted with the blacklist key. */
export interface BlacklistSheet extends RecordMeta {
  title: string
  fileId: string
  mime: string
  width?: number
  height?: number
  size?: number
  /** Names shown on the image, typed by an administrator so they can be searched. */
  names: string[]
  note?: string
  addedAt: number
  addedBy?: string
}

export interface ImportRecord extends RecordMeta {
  kind: 'rota' | 'contacts' | 'documents' | 'backup' | 'pack'
  fileName: string
  importedBy: string
  importedAt: number
  period?: { from: ISODate; to: ISODate }
  stats: Record<string, number>
  warnings: string[]
  /** Previous versions of every record the import touched, for rollback. `null` = did not exist. */
  before?: Record<string, RotaAssignment | null>
  beforeDuties?: Record<string, DutyAssignment | null>
  rolledBack?: boolean
}

export interface AuditEvent {
  id: string
  at: number
  actor: string
  role: Role
  action: string // 'unlock', 'blacklist.view', 'blacklist.edit', 'rota.import', 'backup.export', ...
  target?: string
  detail?: string
}

/** Everything that syncs. Keyed collections of records. */
export interface HubData {
  sections: Section[]
  shiftCodes: ShiftCode[]
  staff: Staff[]
  rota: RotaAssignment[]
  duties: DutyAssignment[]
  categories: DocCategory[]
  docs: ManualDoc[]
  contacts: Contact[]
  imports: ImportRecord[]
}
export interface HubRestricted {
  blacklist: BlacklistEntry[]
  sheets: BlacklistSheet[]
}

export type CollectionName = keyof HubData | keyof HubRestricted
