/**
 * Client side of the encrypted pack: fetch → cache (Cache Storage, still encrypted) → decrypt on use.
 * Works fully offline once parts are cached. Part names are content hashes, so cached parts never go stale.
 */
import { deriveKey, fromB64, importKey, normalizeCode, open, openJson, DecryptError } from './crypto'
import type { KeyName, PackFileEntry, PackIndex, PackManifest, SlotPayload } from './packFormat'

const CACHE = 'ee-hub-pack-v1'
const base = () => new URL('pack/', new URL(import.meta.env.BASE_URL, location.href)).href
/** Absolute address of a file in the published pack. */
export const url = (rel: string) => new URL(rel, base()).href

export interface PackKeys {
  core: CryptoKey
  restricted?: CryptoKey
}

export async function cache(): Promise<Cache | null> {
  try {
    return await caches.open(CACHE)
  } catch {
    return null // e.g. insecure context
  }
}

/** Latest manifest from the network, falling back to the cached copy when offline. */
export async function fetchManifest(opts: { preferCache?: boolean } = {}): Promise<{ manifest: PackManifest; online: boolean } | null> {
  const c = await cache()
  const key = url('manifest.json')
  if (!opts.preferCache) {
    try {
      const res = await fetch(key, { cache: 'no-cache' })
      if (res.ok) {
        const manifest = (await res.clone().json()) as PackManifest
        await c?.put(key, res)
        return { manifest, online: true }
      }
    } catch {
      /* offline */
    }
  }
  const cached = await c?.match(key)
  if (cached) return { manifest: (await cached.json()) as PackManifest, online: false }
  return null
}

/** Try the access code against every key slot. */
export async function unlockSlot(manifest: PackManifest, code: string): Promise<SlotPayload | null> {
  const kek = await deriveKey(normalizeCode(code), fromB64(manifest.kdf.salt), manifest.kdf.iterations)
  for (const s of manifest.slots) {
    try {
      return await openJson<SlotPayload>(kek, fromB64(s))
    } catch (e) {
      if (!(e instanceof DecryptError)) throw e
    }
  }
  return null
}

export async function keysFrom(payload: SlotPayload): Promise<PackKeys> {
  return {
    core: await importKey(fromB64(payload.keys.core)),
    restricted: payload.keys.restricted ? await importKey(fromB64(payload.keys.restricted)) : undefined,
  }
}

async function getPart(rel: string, onBytes?: (n: number) => void): Promise<Uint8Array<ArrayBuffer>> {
  const c = await cache()
  const key = url(rel)
  let res = await c?.match(key)
  if (!res) {
    res = await fetch(key)
    if (!res.ok) throw new Error(`Download failed (${res.status}) — connect to the network once to fetch this file`)
    if (c) {
      await c.put(key, res.clone())
    }
  }
  if (!onBytes || !res.body) {
    const buf = new Uint8Array(await res.arrayBuffer())
    onBytes?.(buf.length)
    return buf
  }
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    total += value.length
    onBytes(value.length)
  }
  const out = new Uint8Array(total)
  let o = 0
  for (const ch of chunks) {
    out.set(ch, o)
    o += ch.length
  }
  return out
}

export async function loadIndex(manifest: PackManifest, keys: PackKeys): Promise<PackIndex> {
  return openJson<PackIndex>(keys.core, await getPart(manifest.index))
}

function keyFor(entry: PackFileEntry, keys: PackKeys): CryptoKey {
  const k = keys[entry.key as KeyName]
  if (!k) throw new Error('Your access level cannot open this file')
  return k
}

export async function readFile(entry: PackFileEntry, keys: PackKeys, onProgress?: (done: number, total: number) => void): Promise<Uint8Array<ArrayBuffer>> {
  const key = keyFor(entry, keys)
  const chunks: Uint8Array<ArrayBuffer>[] = []
  let downloaded = 0
  const sealedTotal = entry.size + entry.parts.length * 32
  for (const part of entry.parts) {
    const sealed = await getPart(part, onProgress ? (n) => onProgress((downloaded += n), sealedTotal) : undefined)
    chunks.push(await open(key, sealed))
  }
  onProgress?.(sealedTotal, sealedTotal)
  if (chunks.length === 1) return chunks[0]
  // size the result from what was actually decrypted, never from the index (a wrong size would leave padding)
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.length
  }
  return out
}

export async function readJson<T>(entry: PackFileEntry, keys: PackKeys): Promise<T> {
  return JSON.parse(new TextDecoder().decode(await readFile(entry, keys))) as T
}

export async function isCached(entry: PackFileEntry): Promise<boolean> {
  const c = await cache()
  if (!c) return false
  for (const p of entry.parts) if (!(await c.match(url(p)))) return false
  return true
}

/** Store an already-sealed part in the pack cache (for files added on this device). */
export async function putPart(rel: string, sealed: Uint8Array<ArrayBuffer>): Promise<void> {
  const c = await cache()
  if (!c) throw new Error('Offline storage is not available in this browser')
  await c.put(url(rel), new Response(sealed, { headers: { 'Content-Type': 'application/octet-stream' } }))
}

/** Download (without decrypting) so the files are available offline. */
export async function prefetch(entries: PackFileEntry[], onProgress?: (done: number, total: number) => void, signal?: AbortSignal): Promise<number> {
  const c = await cache()
  if (!c) return 0
  const total = entries.reduce((a, e) => a + e.size, 0)
  let done = 0
  let fetched = 0
  for (const e of entries) {
    for (const p of e.parts) {
      if (signal?.aborted) return fetched
      if (!(await c.match(url(p)))) {
        const res = await fetch(url(p), { signal })
        if (!res.ok) throw new Error(`Download failed (${res.status})`)
        await c.put(url(p), res)
        fetched++
      }
    }
    done += e.size
    onProgress?.(done, total)
  }
  return fetched
}

export async function evict(entries: PackFileEntry[]): Promise<void> {
  const c = await cache()
  if (!c) return
  for (const e of entries) for (const p of e.parts) await c.delete(url(p))
}

/** Remove cached parts not referenced by the current index (after an update). */
export async function pruneCache(index: PackIndex, manifest: PackManifest, extra: PackFileEntry[] = []): Promise<number> {
  const c = await cache()
  if (!c) return 0
  const keep = new Set<string>([url('manifest.json'), url(manifest.index)])
  for (const e of [...Object.values(index.files), ...extra]) for (const p of e.parts) keep.add(url(p))
  let n = 0
  for (const req of await c.keys()) {
    if (!keep.has(req.url)) {
      await c.delete(req)
      n++
    }
  }
  return n
}

export async function cachedBytes(): Promise<number> {
  try {
    const est = await navigator.storage?.estimate?.()
    return est?.usage ?? 0
  } catch {
    return 0
  }
}
