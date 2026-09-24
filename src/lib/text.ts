/** Text normalisation shared by search, name matching and imports (English + Arabic). */

const ARABIC_DIACRITICS = /[ً-ٰٟۖ-ۭـ]/g // harakat, superscript alef, tatweel

/** Fold case, accents and Arabic letter variants so "Ahmed", "AHMED", "أحمد"/"احمد" compare equal. */
export function fold(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(ARABIC_DIACRITICS, '')
    .replace(/[آأإٱ]/g, 'ا') // آ أ إ ٱ → ا
    .replace(/ة/g, 'ه') // ة → ه
    .replace(/ى/g, 'ي') // ى → ي
    .replace(/ؤ/g, 'و') // ؤ → و
    .replace(/ئ/g, 'ي') // ئ → ي
    .toLowerCase()
}

export function cleanSpaces(s: string): string {
  return s.replace(/[   ]/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Key used to match staff names across imports: folded, letters/digits only. */
export function nameKey(s: string): string {
  return fold(cleanSpaces(s)).replace(/[^\p{L}\p{N}]+/gu, '')
}

/** "karim  benali " → "Karim Benali" (keeps inner capitals such as "McKay"). */
export function displayName(s: string): string {
  return cleanSpaces(s)
    .split(' ')
    .map((w) => (w === w.toLowerCase() || w === w.toUpperCase() ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(' ')
}

export function initials(name: string): string {
  const parts = cleanSpaces(name).split(' ').filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export function slug(s: string): string {
  return fold(s).replace(/[^a-z0-9؀-ۿ]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'item'
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[b.length]
}

/** Optimal string alignment distance: like Levenshtein, but a swap of neighbours ("tset"/"test") costs 1. */
export function osa(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 0; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
    }
  }
  return d[a.length][b.length]
}

export function isArabic(s: string): boolean {
  return /[؀-ۿ]/.test(s)
}

export function plural(n: number, one: string, many = one + 's'): string {
  return `${n} ${n === 1 ? one : many}`
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

export function uid(prefix = ''): string {
  const r = globalThis.crypto.getRandomValues(new Uint8Array(8))
  return prefix + Array.from(r, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 12)
}
