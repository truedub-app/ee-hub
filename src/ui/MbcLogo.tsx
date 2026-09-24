import svg from '../assets/mbc-logo.svg?raw'
import { cx } from './primitives'

// Paths come straight from the logo file, grouped as "mark" (mbc + swoosh) and "group" (the GROUP line)
const paths = (id: string) => [...(svg.match(new RegExp(`<g id="${id}">([\\s\\S]*?)</g>`))?.[1] ?? '').matchAll(/ d="([^"]+)"/g)].map((m) => m[1])
const MARK = paths('mark')
const GROUP = paths('group')

/**
 * The MBC Group logo, drawn in the current text colour so it works on dark and light themes.
 * `mark` leaves out the small GROUP line for sizes where it would be unreadable.
 */
export function MbcLogo({ variant = 'full', className, decorative }: { variant?: 'full' | 'mark'; className?: string; decorative?: boolean }) {
  const full = variant === 'full'
  return (
    <svg
      className={cx('mbc-logo', className)}
      viewBox={full ? '0 0 252 106' : '0 0 252 88'}
      fill="currentColor"
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : 'MBC Group'}
      aria-hidden={decorative || undefined}
    >
      {MARK.map((d, i) => <path key={`m${i}`} d={d} />)}
      {full && GROUP.map((d, i) => <path key={`g${i}`} d={d} />)}
    </svg>
  )
}
