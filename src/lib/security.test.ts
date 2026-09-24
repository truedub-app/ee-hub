import { describe, expect, it } from 'vitest'
import { deriveKey, DecryptError, importKey, normalizeCode, open, randomBytes, seal, sealJson, openJson, toB64, fromB64 } from './crypto'
import { decodeBackup, encodeBackup, type BackupPayload } from '../data/backup'
import { emptyData, mergeList } from '../data/merge'
import { checkName } from '../features/blacklist/checkName'
import type { BlacklistEntry } from '../data/types'
import { fold, nameKey, osa } from './text'

describe('crypto', () => {
  it('round-trips and rejects the wrong key', async () => {
    const k1 = await importKey(randomBytes(32))
    const k2 = await importKey(randomBytes(32))
    const sealed = await sealJson(k1, { hello: 'عالم' })
    expect(await openJson(k1, sealed)).toEqual({ hello: 'عالم' })
    await expect(open(k2, sealed)).rejects.toBeInstanceOf(DecryptError)
    // tampering is detected (GCM tag)
    const t = sealed.slice()
    t[t.length - 1] ^= 1
    await expect(open(k1, t)).rejects.toBeInstanceOf(DecryptError)
  })

  it('derives the same key from equivalent access codes', async () => {
    expect(normalizeCode('ab12-cd34 ef56_gh78')).toBe('AB12CD34EF56GH78')
    const salt = randomBytes(16)
    const a = await deriveKey(normalizeCode('ab12-cd34'), salt, 1000)
    const b = await deriveKey(normalizeCode('AB12 CD34'), salt, 1000)
    const sealed = await seal(a, new TextEncoder().encode('x'))
    expect(new TextDecoder().decode(await open(b, sealed))).toBe('x')
  })

  it('base64 round-trips binary data', () => {
    const b = randomBytes(1000)
    expect(fromB64(toB64(b))).toEqual(b)
  })
})

describe('backup packages', () => {
  const payload: BackupPayload = { format: 'eeh-backup/1', createdAt: 1, createdBy: 'test', role: 'admin', redacted: true, data: emptyData() }
  it('needs the right passphrase', async () => {
    const bytes = await encodeBackup(payload, 'correct horse battery')
    expect((await decodeBackup(bytes, 'correct horse battery')).createdBy).toBe('test')
    await expect(decodeBackup(bytes, 'wrong passphrase!')).rejects.toThrow(/Wrong passphrase/)
  }, 20_000)
})

describe('merge', () => {
  it('keeps the newest version of each record and honours tombstones', () => {
    type R = { id: string; updatedAt: number; v: string; deleted?: boolean }
    const local: R[] = [{ id: 'a', updatedAt: 5, v: 'local' }, { id: 'b', updatedAt: 1, v: 'old' }]
    const incoming: R[] = [{ id: 'a', updatedAt: 3, v: 'pack' }, { id: 'b', updatedAt: 2, v: 'new', deleted: true }, { id: 'c', updatedAt: 1, v: 'c' }]
    const out = mergeList(local, incoming)
    expect(out.find((r) => r.id === 'a')!.v).toBe('local')
    expect(out.find((r) => r.id === 'b')!.deleted).toBe(true)
    expect(out.find((r) => r.id === 'c')).toBeTruthy()
  })
})

describe('text matching', () => {
  it('folds Arabic letter variants and case', () => {
    expect(fold('أحمد')).toBe(fold('احمد'))
    expect(fold('مكتبة')).toBe(fold('مكتبه'))
    expect(nameKey('  Karim  benali ')).toBe('karimbenali')
  })
  it('treats a swap of neighbouring letters as one edit', () => {
    expect(osa('tset', 'test')).toBe(1)
  })
})

describe('blacklist name check', () => {
  const entry: BlacklistEntry = {
    id: 'x', name: 'Test Example Person', category: 'journalist', aliases: ['تست مثال'], programs: [], channels: [],
    status: 'do-not-book', reason: 'r', dateAdded: '2026-09-01', active: true, updatedAt: 0,
  }
  it('catches typos, partial names and Arabic aliases without false positives', () => {
    expect(checkName('Tset Exampel', [entry])).toHaveLength(1)
    expect(checkName('example', [entry])).toHaveLength(1)
    expect(checkName('تست مثال', [entry])).toHaveLength(1)
    expect(checkName('John Smith', [entry])).toHaveLength(0)
  })
  it('finds names typed for the blacklist image', () => {
    const sheet = { id: 's', title: 'Blacklist', fileId: 'f', mime: 'image/jpeg', names: ['Sample Person', 'شخص تجريبي'], addedAt: 0, updatedAt: 0 }
    const hits = checkName('Sampel Person', [], [sheet])
    expect(hits).toHaveLength(1)
    expect(hits[0].sheet?.id).toBe('s')
    expect(hits[0].how).toMatch(/Blacklist/)
    expect(checkName('شخص تجريبي', [], [sheet])[0].how).toMatch(/^Listed on/)
    expect(checkName('Nobody Here', [], [sheet])).toHaveLength(0)
  })
})
