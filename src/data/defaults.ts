import type { DocCategory, Section, ShiftCode } from './types'

const T0 = Date.UTC(2026, 0, 1) // stable timestamp for built-in records

export const DEFAULT_SECTIONS: Section[] = [
  { id: 'morning', name: 'Morning', short: 'M', start: '08:00', end: '16:00', tone: 'morning', order: 1, duties: true, updatedAt: T0 },
  { id: 'afternoon', name: 'Afternoon', short: 'A', start: '16:00', end: '00:00', tone: 'afternoon', order: 2, duties: true, updatedAt: T0 },
  { id: 'night', name: 'Night', short: 'N', start: '00:00', end: '08:00', tone: 'night', order: 3, duties: true, updatedAt: T0 },
]

/** A section that can be switched on in Settings if the department adds a Graphics roster. */
export const OPTIONAL_SECTIONS: Section[] = [
  { id: 'graphics', name: 'Graphics', short: 'G', start: '09:00', end: '17:00', tone: 'graphics', order: 4, duties: false, updatedAt: T0 },
]

export const DEFAULT_CODES: ShiftCode[] = [
  { id: 'M', code: 'M', label: 'Morning shift', kind: 'work', band: 'morning', hours: '08:00–16:00', glyph: 'M', tone: 'morning', builtin: true, updatedAt: T0 },
  { id: 'A', code: 'A', label: 'Afternoon shift', kind: 'work', band: 'afternoon', hours: '16:00–00:00', glyph: 'A', tone: 'afternoon', builtin: true, updatedAt: T0 },
  { id: 'N', code: 'N', label: 'Night shift', kind: 'work', band: 'night', hours: '00:00–08:00', glyph: 'N', tone: 'night', builtin: true, updatedAt: T0 },
  {
    id: 'Q', code: 'Q', label: 'QC 2 & Missing List duty', kind: 'duty', glyph: 'Q', tone: 'qc2', builtin: true, updatedAt: T0,
    match: ['missing\\s*list', 'qc\\s*-?\\s*2', '^q$'],
  },
  { id: 'OFF', code: 'OFF', label: 'Rest day', kind: 'rest', glyph: '–', tone: 'off', builtin: true, updatedAt: T0, match: ['^off$', '^rest', '^day\\s*off'] },
  { id: 'HOL', code: 'HOL', label: 'Annual holiday', kind: 'absence', glyph: 'H', tone: 'hol', builtin: true, updatedAt: T0, match: ['^hol', 'holiday', 'annual', 'vacation', '^al$'] },
  { id: 'TOIL', code: 'TOIL', label: 'Time off in lieu', kind: 'absence', glyph: 'T', tone: 'toil', builtin: true, updatedAt: T0, match: ['^toil', 'in\\s*lieu'] },
  { id: 'SICK', code: 'SICK', label: 'Sick leave', kind: 'absence', glyph: 'S', tone: 'sick', builtin: true, updatedAt: T0, match: ['^sick', '^sl$'] },
  { id: 'TRN', code: 'TRN', label: 'Training', kind: 'other', glyph: 'Tr', tone: 'training', builtin: true, updatedAt: T0, match: ['train', 'course'] },
  { id: 'REM', code: 'REM', label: 'Remote working', kind: 'work', glyph: 'R', tone: 'remote', builtin: true, updatedAt: T0, match: ['remote', '^wfh', 'home'] },
  { id: 'U', code: 'U', label: 'Unassigned', kind: 'other', glyph: '·', tone: 'unassigned', builtin: true, updatedAt: T0 },
  { id: 'X', code: 'X', label: 'Unrecognised entry', kind: 'other', glyph: '?', tone: 'alert', builtin: true, updatedAt: T0 },
]

export const DEFAULT_CATEGORIES: DocCategory[] = [
  { id: 'editorial', name: 'Editorial Guidelines', tone: 'cat-editorial', glyph: 'scale', order: 1, updatedAt: T0, description: 'Content standards and editorial policy' },
  { id: 'segmentation', name: 'Segmentation', tone: 'cat-segmentation', glyph: 'scissors', order: 2, updatedAt: T0, description: 'Parts, TIT & EC rules for MBC and Shahid' },
  { id: 'editing', name: 'Editing & Post', tone: 'cat-editing', glyph: 'clapperboard', order: 3, updatedAt: T0, description: 'Premiere, DALET and versioning' },
  { id: 'walkthroughs', name: 'Walkthroughs', tone: 'cat-walkthroughs', glyph: 'play', order: 4, updatedAt: T0, description: 'Screen-recorded training videos' },
  { id: 'workflow', name: 'Workflow', tone: 'cat-workflow', glyph: 'workflow', order: 5, updatedAt: T0, description: 'ERM, DALET exports and What’sON' },
  { id: 'qc', name: 'QC', tone: 'cat-qc', glyph: 'badge-check', order: 6, updatedAt: T0, description: 'Check & Copy, QC 1 and QC 2' },
  { id: 'subtitling', name: 'Subtitling', tone: 'cat-subtitling', glyph: 'captions', order: 7, updatedAt: T0, description: 'WinCAPS, PAC and SRT' },
  { id: 'shahid', name: 'Shahid', tone: 'cat-shahid', glyph: 'tv', order: 8, updatedAt: T0, description: 'STXML, multi-language and VIP' },
  { id: 'compliance', name: 'Compliance', tone: 'cat-compliance', glyph: 'shield-check', order: 9, updatedAt: T0, description: 'Special programmes and content checks' },
  { id: 'scheduling', name: 'Scheduling', tone: 'cat-scheduling', glyph: 'calendar-clock', order: 10, updatedAt: T0, description: 'Repeats and scheduling decisions' },
  { id: 'rules', name: 'Department Rules', tone: 'cat-rules', glyph: 'book-marked', order: 11, updatedAt: T0, description: 'Supervision, regulations and updates' },
]

export const CONTACT_TEAMS = [
  'Editing & Editorial', 'TV Services', 'Acquisition', 'Scheduling & Planning', 'Tech Ops', 'Transmission',
  'IT', 'Graphics', 'Compliance', 'Production', 'Other',
]
