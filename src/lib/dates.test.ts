import { describe, expect, it } from 'vitest'
import { msUntil, rotaToday } from './dates'
import { rotaDayStart } from '../features/rota/model'
import { DEFAULT_SECTIONS } from '../data/defaults'

const at = (d: number, h: number, m = 0, month = 8) => new Date(2026, month, d, h, m)

describe('rota day', () => {
  it('starts at the end of the night shift', () => {
    expect(rotaDayStart(DEFAULT_SECTIONS)).toBe('08:00')
    expect(rotaDayStart(DEFAULT_SECTIONS.filter((s) => s.id !== 'night'))).toBe('00:00') // Afternoon ends at midnight
    expect(rotaDayStart([{ ...DEFAULT_SECTIONS[0], id: 'late', start: '22:00', end: '06:00' }])).toBe('06:00')
  })

  it('keeps the previous day until the night shift ends', () => {
    expect(rotaToday('08:00', at(27, 0, 30))).toBe('2026-09-26') // 00:30 on the 27th: night shift of the 26th
    expect(rotaToday('08:00', at(27, 7, 59))).toBe('2026-09-26')
    expect(rotaToday('08:00', at(27, 8, 0))).toBe('2026-09-27') // morning shift starts the new day
    expect(rotaToday('08:00', at(26, 23, 50))).toBe('2026-09-26')
    expect(rotaToday('08:00', at(1, 3, 0, 9))).toBe('2026-09-30') // across the month end
    expect(rotaToday('00:00', at(27, 0, 30))).toBe('2026-09-27')
  })

  it('knows how long until the day changes', () => {
    expect(msUntil('08:00', at(27, 7, 59))).toBe(60_000)
    expect(msUntil('08:00', at(27, 8, 0))).toBe(24 * 3_600_000)
  })
})
