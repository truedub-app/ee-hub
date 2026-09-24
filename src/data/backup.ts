/**
 * Encrypted backup packages (.hub). A passphrase chosen at export time protects the file;
 * it can be carried by USB, AirDrop, Nearby Share or a shared drive and imported on another device.
 *
 * Layout: 'EEHB' | 0x01 | salt (16) | iterations (uint32 BE) | sealed JSON
 */
import { deriveKey, open, PBKDF2_ITERATIONS, randomBytes, seal, utf8 } from '../lib/crypto'
import type { AuditEvent, BlacklistEntry, BlacklistSheet, HubData } from './types'
import type { CarriedFile } from './localFiles'

const MAGIC = [0x45, 0x45, 0x48, 0x42] // EEHB

export interface BackupPayload {
  format: 'eeh-backup/1'
  createdAt: number
  createdBy: string
  role: string
  packVersion?: number
  redacted: boolean
  data: HubData
  blacklist?: BlacklistEntry[]
  sheets?: BlacklistSheet[]
  audit?: AuditEvent[]
  /** Files added on the exporting device that were not yet published (still encrypted with the pack keys). */
  files?: Record<string, CarriedFile>
}

export async function encodeBackup(payload: BackupPayload, passphrase: string): Promise<Uint8Array<ArrayBuffer>> {
  const salt = randomBytes(16)
  const key = await deriveKey(passphrase, salt, PBKDF2_ITERATIONS)
  const sealed = await seal(key, utf8.encode(JSON.stringify(payload)))
  const out = new Uint8Array(4 + 1 + 16 + 4 + sealed.length)
  out.set(MAGIC, 0)
  out[4] = 1
  out.set(salt, 5)
  new DataView(out.buffer).setUint32(21, PBKDF2_ITERATIONS)
  out.set(sealed, 25)
  return out
}

export function isBackup(bytes: Uint8Array): boolean {
  return MAGIC.every((b, i) => bytes[i] === b)
}

export async function decodeBackup(bytes: Uint8Array<ArrayBuffer>, passphrase: string): Promise<BackupPayload> {
  if (!isBackup(bytes)) throw new Error('This is not an Editing & Editorial Hub backup file')
  if (bytes[4] !== 1) throw new Error('Unsupported backup version')
  const salt = bytes.slice(5, 21)
  const iterations = new DataView(bytes.buffer, bytes.byteOffset).getUint32(21)
  const key = await deriveKey(passphrase, salt, iterations)
  try {
    const plain = await open(key, bytes.slice(25))
    const p = JSON.parse(utf8.decode(plain)) as BackupPayload
    if (p.format !== 'eeh-backup/1') throw new Error('Unsupported backup format')
    return p
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('Unsupported')) throw e
    throw new Error('Wrong passphrase, or the file is damaged')
  }
}

export function backupFileName(d = new Date()): string {
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return `EditingEditorialHub_${ymd}.hub`
}

export function downloadBytes(bytes: Uint8Array<ArrayBuffer>, name: string, mime = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
