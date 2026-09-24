/**
 * Files added on this device (documents, the blacklist image). They are encrypted into the same
 * part format as the published pack and kept in the pack cache, so they read exactly like pack
 * files and can be published or carried in a backup as-is.
 */
import { fromB64, randomBytes, seal, sha256Hex, toB64, toHex } from '../lib/crypto'
import { cache, putPart } from '../lib/pack'
import { PART_SIZE, type KeyName, type PackFileEntry } from '../lib/packFormat'
import { useHub } from './store'

const partUrl = (rel: string) => new URL(`pack/${rel}`, new URL(import.meta.env.BASE_URL, location.href)).href

export async function sealLocalFile(id: string, bytes: Uint8Array<ArrayBuffer>, mime: string, opts: { name?: string; key?: KeyName } = {}): Promise<PackFileEntry> {
  const s = useHub.getState()
  const keyName = opts.key ?? 'core'
  const key = s.session?.keys[keyName]
  if (!key) throw new Error('Your access level cannot store this file')
  const parts: string[] = []
  const count = Math.max(1, Math.ceil(bytes.length / PART_SIZE))
  for (let i = 0; i < count; i++) {
    const rel = `f/${toHex(randomBytes(16))}.bin`
    await putPart(rel, await seal(key, bytes.slice(i * PART_SIZE, (i + 1) * PART_SIZE)))
    parts.push(rel)
  }
  const entry: PackFileEntry = { parts, size: bytes.length, mime, sha: await sha256Hex(bytes), key: keyName, name: opts.name }
  s.addLocalFiles({ [id]: entry })
  return entry
}

/** Sealed parts of a local file, for publishing or a backup. */
export async function localFileParts(entry: PackFileEntry): Promise<Record<string, Uint8Array>> {
  const c = await cache()
  const out: Record<string, Uint8Array> = {}
  for (const p of entry.parts) {
    const res = await c?.match(partUrl(p))
    if (!res) throw new Error('A file added on this device is missing from its storage — add it again')
    out[p] = new Uint8Array(await res.arrayBuffer())
  }
  return out
}

/** Serialisable form for .hub backups (parts stay encrypted with the pack keys). */
export interface CarriedFile {
  entry: PackFileEntry
  parts: Record<string, string> // path → base64 sealed bytes
}

export async function carryFiles(ids: string[]): Promise<Record<string, CarriedFile>> {
  const s = useHub.getState()
  const out: Record<string, CarriedFile> = {}
  for (const id of ids) {
    const entry = s.localFiles[id]
    if (!entry) continue
    const parts = await localFileParts(entry)
    out[id] = { entry, parts: Object.fromEntries(Object.entries(parts).map(([p, b]) => [p, toB64(b)])) }
  }
  return out
}

export async function restoreFiles(files: Record<string, CarriedFile>): Promise<number> {
  const add: Record<string, PackFileEntry> = {}
  for (const [id, f] of Object.entries(files)) {
    for (const [p, b64] of Object.entries(f.parts)) await putPart(p, fromB64(b64))
    add[id] = f.entry
  }
  if (Object.keys(add).length) useHub.getState().addLocalFiles(add)
  return Object.keys(add).length
}

/** Ids of device-added files that current records still reference. */
export function referencedLocalFileIds(): string[] {
  const s = useHub.getState()
  const ids = new Set<string>()
  for (const d of s.data.docs) if (!d.deleted) for (const id of [d.fileId, d.posterId, d.contentId]) if (id) ids.add(id)
  for (const sh of s.sheets) if (!sh.deleted) ids.add(sh.fileId)
  return [...ids].filter((id) => s.localFiles[id])
}

/** Downscale very large images (phone photos) so the blacklist sheet stays sharp but light. */
export async function prepareImage(file: File, maxSide = 3200): Promise<{ bytes: Uint8Array<ArrayBuffer>; mime: string; width: number; height: number }> {
  const bitmap = await createImageBitmap(file)
  const { width, height } = bitmap
  const scale = Math.min(1, maxSide / Math.max(width, height))
  if (scale === 1 && file.size < 4 * 1024 * 1024 && /^image\/(png|jpeg|webp)$/.test(file.type)) {
    bitmap.close()
    return { bytes: new Uint8Array(await file.arrayBuffer()), mime: file.type, width, height }
  }
  const w = Math.round(width * scale)
  const h = Math.round(height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h)
  bitmap.close()
  const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Could not process the image'))), 'image/jpeg', 0.9))
  return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: 'image/jpeg', width: w, height: h }
}
