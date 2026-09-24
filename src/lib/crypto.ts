/**
 * AES-256-GCM + PBKDF2 helpers on top of WebCrypto.
 * Runs unchanged in the browser and in Node 22+ (used by the pack builder).
 *
 * Sealed blob layout: 'EEH1' magic (4 bytes) | IV (12 bytes) | ciphertext + GCM tag
 */

const MAGIC = new Uint8Array([0x45, 0x45, 0x48, 0x31]) // "EEH1"
const IV_LEN = 12
export const PBKDF2_ITERATIONS = 600_000

const subtle = () => globalThis.crypto.subtle
const te = new TextEncoder()
const td = new TextDecoder()

export function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  return globalThis.crypto.getRandomValues(new Uint8Array(n))
}

export function toB64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(s)
}

export function fromB64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Access codes are case/space/dash-insensitive: "eeh-7k4q 92mx" == "EEH7K4Q92MX". */
export function normalizeCode(code: string): string {
  return code.normalize('NFKC').toUpperCase().replace(/[\s\-_.]/g, '')
}

export async function deriveKey(secret: string, salt: Uint8Array<ArrayBuffer>, iterations = PBKDF2_ITERATIONS): Promise<CryptoKey> {
  const base = await subtle().importKey('raw', te.encode(secret), 'PBKDF2', false, ['deriveKey'])
  return subtle().deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function importKey(raw: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return subtle().importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

export async function hmacKey(raw: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return subtle().importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
}

export async function hmacHex(key: CryptoKey, data: string): Promise<string> {
  return toHex(new Uint8Array(await subtle().sign('HMAC', key, te.encode(data))))
}

export async function sha256Hex(data: Uint8Array<ArrayBuffer> | string): Promise<string> {
  const bytes = typeof data === 'string' ? te.encode(data) : data
  return toHex(new Uint8Array(await subtle().digest('SHA-256', bytes)))
}

export async function seal(key: CryptoKey, plain: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const iv = randomBytes(IV_LEN)
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, key, plain))
  const out = new Uint8Array(MAGIC.length + IV_LEN + ct.length)
  out.set(MAGIC, 0)
  out.set(iv, MAGIC.length)
  out.set(ct, MAGIC.length + IV_LEN)
  return out
}

export class DecryptError extends Error {}

export async function open(key: CryptoKey, sealed: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  for (let i = 0; i < MAGIC.length; i++) {
    if (sealed[i] !== MAGIC[i]) throw new DecryptError('Not a Hub encrypted file')
  }
  const iv = sealed.subarray(MAGIC.length, MAGIC.length + IV_LEN)
  const ct = sealed.subarray(MAGIC.length + IV_LEN)
  try {
    return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv }, key, ct))
  } catch {
    throw new DecryptError('Wrong key or damaged data')
  }
}

export async function sealJson(key: CryptoKey, value: unknown): Promise<Uint8Array<ArrayBuffer>> {
  return seal(key, te.encode(JSON.stringify(value)))
}

export async function openJson<T>(key: CryptoKey, sealed: Uint8Array<ArrayBuffer>): Promise<T> {
  return JSON.parse(td.decode(await open(key, sealed))) as T
}

export const utf8 = { encode: (s: string) => te.encode(s), decode: (b: Uint8Array) => td.decode(b) }
