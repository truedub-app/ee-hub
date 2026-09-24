/** Calendar-date helpers. Dates are 'YYYY-MM-DD' strings in local time — never UTC-shifted. */
import type { ISODate } from '../data/types'

export function toISO(d: Date): ISODate {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function fromISO(s: ISODate): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function ymd(y: number, m: number, d: number): ISODate {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

export function isValidDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return false
  const dt = new Date(y, m - 1, d)
  return dt.getMonth() === m - 1 && dt.getDate() === d
}

export function addDays(s: ISODate, n: number): ISODate {
  const d = fromISO(s)
  d.setDate(d.getDate() + n)
  return toISO(d)
}

export function addMonths(s: ISODate, n: number): ISODate {
  const d = fromISO(s)
  const day = d.getDate()
  d.setDate(1)
  d.setMonth(d.getMonth() + n)
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  d.setDate(Math.min(day, last))
  return toISO(d)
}

export function today(): ISODate {
  return toISO(new Date())
}

export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((fromISO(a).getTime() - fromISO(b).getTime()) / 86_400_000)
}

/** weekStart: 0 = Sunday (Middle-East rota week), 1 = Monday */
export function startOfWeek(s: ISODate, weekStart = 0): ISODate {
  const d = fromISO(s)
  const delta = (d.getDay() - weekStart + 7) % 7
  return addDays(s, -delta)
}

export function startOfMonth(s: ISODate): ISODate {
  return s.slice(0, 8) + '01'
}

export function daysInMonth(s: ISODate): number {
  const d = fromISO(s)
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
}

export function range(from: ISODate, count: number): ISODate[] {
  return Array.from({ length: count }, (_, i) => addDays(from, i))
}

export function monthDays(s: ISODate): ISODate[] {
  return range(startOfMonth(s), daysInMonth(s))
}

const fmtCache = new Map<string, Intl.DateTimeFormat>()
function fmt(opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = JSON.stringify(opts)
  let f = fmtCache.get(key)
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', opts)
    fmtCache.set(key, f)
  }
  return f
}

/** 'Tuesday, 22 September 2026' */
export function longDate(s: ISODate): string {
  return fmt({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(fromISO(s))
}
/** '22 Sep 2026' */
export function mediumDate(s: ISODate): string {
  return fmt({ day: 'numeric', month: 'short', year: 'numeric' }).format(fromISO(s))
}
/** 'Tue 22' */
export function shortDay(s: ISODate): string {
  return fmt({ weekday: 'short', day: 'numeric' }).format(fromISO(s))
}
export function weekdayShort(s: ISODate): string {
  return fmt({ weekday: 'short' }).format(fromISO(s))
}
export function weekdayNarrow(s: ISODate): string {
  return fmt({ weekday: 'narrow' }).format(fromISO(s))
}
/** 'September 2026' */
export function monthLabel(s: ISODate): string {
  return fmt({ month: 'long', year: 'numeric' }).format(fromISO(s))
}
export function isWeekend(s: ISODate, weekendDays = [5, 6]): boolean {
  return weekendDays.includes(fromISO(s).getDay())
}

/** '22 Sep 2026, 09:42' */
export function dateTime(ms: number): string {
  return fmt({ day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ms))
}

export function timeOfDay(ms: number): string {
  return fmt({ hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ms))
}

/** 'Today, 09:42' / 'Yesterday, 18:10' / '22 Sep 2026, 09:42' */
export function relativeDateTime(ms: number, now = Date.now()): string {
  const d = toISO(new Date(ms))
  const t = toISO(new Date(now))
  if (d === t) return `Today, ${timeOfDay(ms)}`
  if (d === addDays(t, -1)) return `Yesterday, ${timeOfDay(ms)}`
  return dateTime(ms)
}

/** '2 hours ago' style, coarse. */
export function ago(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000))
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`
  const d = Math.round(h / 24)
  if (d < 30) return `${d} day${d === 1 ? '' : 's'} ago`
  return dateTime(ms)
}

/** Minutes since midnight from 'HH:MM'. */
export function hm(s: string): number {
  const [h, m] = s.split(':').map(Number)
  return h * 60 + (m || 0)
}

export function greeting(date = new Date()): string {
  const h = date.getHours()
  if (h < 5) return 'Good evening'
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

export function formatDuration(sec: number): string {
  const s = Math.round(sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`
}
