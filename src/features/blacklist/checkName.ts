import type { BlacklistEntry, BlacklistSheet } from '../../data/types'
import { fold, nameKey, osa } from '../../lib/text'

export interface NameHit {
  name: string
  how: string
  score: number
  e?: BlacklistEntry
  sheet?: BlacklistSheet
}

const tokens = (s: string) =>
  fold(s)
    .split(/[\s\-_.،,]+/)
    .map((t) => t.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter((t) => t.length > 2)

const close = (a: string, b: string) => a === b || osa(a, b) <= (Math.min(a.length, b.length) <= 5 ? 1 : 2)

/** Best match of the query against a list of names: exact / contains / close spelling / matching name parts. */
function bestMatch(q: string, names: string[]): { name: string; how: string; score: number } | undefined {
  const key = nameKey(q)
  const qTokens = tokens(q)
  let best: { name: string; how: string; score: number } | undefined
  const offer = (name: string, how: string, score: number) => {
    if (!best || score > best.score) best = { name, how, score }
  }
  names.forEach((n, i) => {
    const k = nameKey(n)
    if (!k) return
    if (k === key) offer(n, i === 0 ? 'Exact name' : `Alias “${n}”`, 100)
    else if (k.includes(key) || key.includes(k)) offer(n, `Contains “${n}”`, 80)
    else {
      const d = osa(k, key)
      if (d <= Math.max(1, Math.floor(Math.min(k.length, key.length) / 5))) offer(n, `Similar spelling (“${n}”)`, 70 - d)
      const nTokens = tokens(n)
      const shared = qTokens.filter((t) => nTokens.some((x) => close(x, t)))
      if (shared.length && shared.length >= Math.min(2, nTokens.length, qTokens.length)) offer(n, `Name parts match “${n}”`, 50 + shared.length)
    }
  })
  return best
}

/** Fuzzy name check against detailed entries and the names listed for each blacklist image. */
export function checkName(q: string, list: BlacklistEntry[], sheets: BlacklistSheet[] = []): NameHit[] {
  if (nameKey(q).length < 3) return []
  const out: NameHit[] = []
  for (const e of list) {
    if (e.deleted) continue
    const m = bestMatch(q, [e.name, ...e.aliases])
    if (m) out.push({ ...m, e })
  }
  for (const sheet of sheets) {
    if (sheet.deleted) continue
    for (const n of sheet.names) {
      const m = bestMatch(q, [n])
      if (m) out.push({ ...m, how: `${m.score === 100 ? 'Listed' : m.how.replace(/^Exact name$/, 'Listed')} on “${sheet.title}”`, sheet })
    }
  }
  return out.sort((a, b) => b.score - a.score)
}
