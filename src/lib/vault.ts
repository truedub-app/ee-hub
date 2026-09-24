/**
 * Device vault. A random data-encryption key (DEK) encrypts everything stored on this device.
 * The DEK and the pack content keys (the "payload") are sealed:
 *   - by default with a non-extractable device key kept in IndexedDB, so the Hub opens without a PIN
 *   - or, when the user turns the PIN on, with a key derived from the PIN (daily unlock)
 *   - always also with a key derived from the access code (recovery when a PIN is forgotten)
 * Wrong-PIN attempts are rate limited.
 */
import { deriveKey, fromB64, importKey, normalizeCode, open, openJson, randomBytes, seal, sealJson, toB64, DecryptError } from './crypto'
import * as idb from './idb'
import type { SlotPayload } from './packFormat'
import type { Role } from '../data/types'

const PIN_ITERATIONS = 310_000

export type PinMode = 'pin6' | 'passcode'

export interface VaultRecord {
  v: 1
  role: Role
  /** 'none' = opens without a PIN (default); 'pin' = PIN required. Older records without it used a PIN. */
  lock?: 'none' | 'pin'
  deviceKey?: CryptoKey
  byDevice?: string
  pinMode?: PinMode
  pinSalt?: string
  byPin?: string
  codeSalt: string
  codeIterations: number
  byCode: string
  createdAt: number
  failed: number
  lockedUntil?: number
}

export interface VaultPayload {
  dek: string
  slot: SlotPayload
}

export interface Unlocked {
  payload: VaultPayload
  dek: CryptoKey
}

export async function readVault(): Promise<VaultRecord | undefined> {
  return idb.get<VaultRecord>('kv', 'vault')
}

export function pinRequired(rec: VaultRecord): boolean {
  return (rec.lock ?? 'pin') === 'pin'
}

async function newDeviceKey(): Promise<CryptoKey> {
  return globalThis.crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

async function unlocked(payload: VaultPayload): Promise<Unlocked> {
  return { payload, dek: await importKey(fromB64(payload.dek)) }
}

/** First set-up on a device: no PIN; the access code seals the recovery copy. */
export async function createVault(opts: { code: string; codeSalt: string; codeIterations: number; slot: SlotPayload }): Promise<Unlocked> {
  const payload: VaultPayload = { dek: toB64(randomBytes(32)), slot: opts.slot }
  const codeKey = await deriveKey(normalizeCode(opts.code), fromB64(opts.codeSalt), opts.codeIterations)
  const deviceKey = await newDeviceKey()
  const rec: VaultRecord = {
    v: 1,
    role: payload.slot.role,
    lock: 'none',
    deviceKey,
    byDevice: toB64(await sealJson(deviceKey, payload)),
    codeSalt: opts.codeSalt,
    codeIterations: opts.codeIterations,
    byCode: toB64(await sealJson(codeKey, payload)),
    createdAt: Date.now(),
    failed: 0,
  }
  await idb.put('kv', 'vault', rec)
  return unlocked(payload)
}

/** Open a device that has no PIN. */
export async function unlockDevice(): Promise<Unlocked | null> {
  const rec = await readVault()
  if (!rec || pinRequired(rec) || !rec.deviceKey || !rec.byDevice) return null
  try {
    return await unlocked(await openJson<VaultPayload>(rec.deviceKey, fromB64(rec.byDevice)))
  } catch {
    return null
  }
}

/** Turn the PIN on (or change it): the device key copy is removed, so the PIN is needed to open the Hub. */
export async function setPin(payload: VaultPayload, pin: string, pinMode: PinMode): Promise<void> {
  const rec = await readVault()
  if (!rec) throw new Error('No vault')
  const pinSalt = randomBytes(16)
  const pinKey = await deriveKey(pin, pinSalt, PIN_ITERATIONS)
  const next: VaultRecord = {
    ...rec,
    lock: 'pin',
    pinMode,
    pinSalt: toB64(pinSalt),
    byPin: toB64(await sealJson(pinKey, payload)),
    failed: 0,
    lockedUntil: undefined,
  }
  delete next.deviceKey
  delete next.byDevice
  await idb.put('kv', 'vault', next)
}

/** Turn the PIN off: the Hub opens directly on this device again. */
export async function removePin(payload: VaultPayload): Promise<void> {
  const rec = await readVault()
  if (!rec) throw new Error('No vault')
  const deviceKey = await newDeviceKey()
  const next: VaultRecord = { ...rec, lock: 'none', deviceKey, byDevice: toB64(await sealJson(deviceKey, payload)), failed: 0, lockedUntil: undefined }
  delete next.pinSalt
  delete next.byPin
  delete next.pinMode
  await idb.put('kv', 'vault', next)
}

export class LockedOut extends Error {
  until: number
  constructor(until: number) {
    super('Too many attempts')
    this.until = until
  }
}

function backoff(failed: number): number {
  if (failed < 5) return 0
  return Math.min(30_000 * 2 ** (failed - 5), 30 * 60_000)
}

export async function unlockWithPin(pin: string): Promise<Unlocked | null> {
  const rec = await readVault()
  if (!rec || !rec.pinSalt || !rec.byPin) return null
  if (rec.lockedUntil && rec.lockedUntil > Date.now()) throw new LockedOut(rec.lockedUntil)
  const key = await deriveKey(pin, fromB64(rec.pinSalt), PIN_ITERATIONS)
  try {
    const payload = await openJson<VaultPayload>(key, fromB64(rec.byPin))
    if (rec.failed) await idb.put('kv', 'vault', { ...rec, failed: 0, lockedUntil: undefined })
    return unlocked(payload)
  } catch (e) {
    if (!(e instanceof DecryptError)) throw e
    const failed = rec.failed + 1
    const wait = backoff(failed)
    await idb.put('kv', 'vault', { ...rec, failed, lockedUntil: wait ? Date.now() + wait : undefined })
    if (wait) throw new LockedOut(Date.now() + wait)
    return null
  }
}

/** Forgot PIN: the access code opens the recovery copy. */
export async function recoverWithCode(code: string): Promise<VaultPayload | null> {
  const rec = await readVault()
  if (!rec) return null
  const key = await deriveKey(normalizeCode(code), fromB64(rec.codeSalt), rec.codeIterations)
  try {
    return await openJson<VaultPayload>(key, fromB64(rec.byCode))
  } catch {
    return null
  }
}

// ---- sealed storage with the DEK -----------------------------------------------------------

export async function saveSealed(dek: CryptoKey, key: string, value: unknown): Promise<void> {
  await idb.put('sealed', key, await sealJson(dek, value))
}

export async function loadSealed<T>(dek: CryptoKey, key: string): Promise<T | undefined> {
  const bytes = await idb.get<Uint8Array<ArrayBuffer>>('sealed', key)
  if (!bytes) return undefined
  return openJson<T>(dek, bytes)
}

export async function sealBytes(dek: CryptoKey, bytes: Uint8Array<ArrayBuffer>) {
  return seal(dek, bytes)
}

export async function openBytes(dek: CryptoKey, bytes: Uint8Array<ArrayBuffer>) {
  return open(dek, bytes)
}

export async function wipeDevice(): Promise<void> {
  await idb.clearAll()
  try {
    for (const k of await caches.keys()) await caches.delete(k)
  } catch {
    /* ignore */
  }
}
