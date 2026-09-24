/**
 * Keeps the local working set in step with the published pack, and serves decrypted files
 * (images, PDFs, video, document content) to the UI.
 */
import { useEffect, useState } from 'react'
import { useHub } from './store'
import { mergeBlacklist, mergeData, mergeList } from './merge'
import type { DocContent, ManualDoc } from './types'
import { fetchManifest, loadIndex, prefetch, pruneCache, readFile, readJson } from '../lib/pack'
import type { CoreDataFile, PackFileEntry, PackIndex, PackManifest, RestrictedDataFile } from '../lib/packFormat'
import { loadSealed, saveSealed } from '../lib/vault'

export interface SyncResult {
  status: 'offline' | 'current' | 'updated' | 'error'
  version?: number
  message: string
}

/** Check the network for a newer pack and merge it. Safe to call often. */
export async function syncPack(opts: { force?: boolean } = {}): Promise<SyncResult> {
  const st = useHub.getState()
  const session = st.session
  if (!session) return { status: 'error', message: 'Locked' }
  st.setNet({ checking: true, error: undefined })
  try {
    const res = await fetchManifest()
    if (!res) {
      st.setNet({ checking: false, online: false })
      return { status: 'offline', message: 'Offline — using local data' }
    }
    const { manifest, online } = res
    st.setNet({ online, lastCheck: Date.now() })
    let index = useHub.getState().index
    const current = st.local.packVersion
    if (!index || index.version !== manifest.version) {
      // cached, sealed copy of the index keeps the reader working offline between versions
      index = await loadIndex(manifest, session.keys)
      await saveSealed(session.dek, 'index', { manifest, index })
    }
    useHub.getState().setPack(manifest, index)
    if (current === manifest.version && !opts.force) {
      st.setNet({ checking: false })
      return { status: 'current', version: manifest.version, message: `Up to date — data version ${manifest.version}` }
    }
    const core = await readJson<CoreDataFile>(index.files[index.data.core], session.keys)
    const merged = mergeData(useHub.getState().data, core.data)
    useHub.getState().setData(merged.data, `Pack v${manifest.version}`)
    if (session.keys.restricted && index.data.restricted) {
      const r = await readJson<RestrictedDataFile>(index.files[index.data.restricted], session.keys)
      useHub.getState().setBlacklistAll(mergeBlacklist(useHub.getState().blacklist, r.data.blacklist).list)
      useHub.getState().setSheetsAll(mergeList(useHub.getState().sheets, r.data.sheets ?? []))
    }
    useHub.getState().setLocal({ packVersion: manifest.version, packBuiltAt: manifest.builtAt })
    useHub.getState().audit('pack.update', `v${manifest.version}`, `${merged.stats.added} added, ${merged.stats.updated} updated`)
    st.setNet({ checking: false })
    void pruneCache(index, manifest, Object.values(useHub.getState().localFiles))
    void warmEssentials()
    return {
      status: 'updated',
      version: manifest.version,
      message: current ? `Updated to data version ${manifest.version}` : `Loaded data version ${manifest.version}`,
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    st.setNet({ checking: false, error: message })
    return { status: 'error', message }
  }
}

/** Restore the last index from the device (offline start). */
export async function restoreIndex(): Promise<void> {
  const s = useHub.getState()
  if (!s.session) return
  const saved = await loadSealed<{ manifest: PackManifest; index: PackIndex }>(s.session.dek, 'index')
  if (saved) s.setPack(saved.manifest, saved.index)
}

export function entryFor(fileId?: string): PackFileEntry | undefined {
  if (!fileId) return undefined
  const s = useHub.getState()
  return s.index?.files[fileId] ?? s.localFiles[fileId]
}

/** Everything except video — small enough to keep offline on every device (~25 MB). */
export function essentialEntries(index: PackIndex, docs: ManualDoc[]): PackFileEntry[] {
  const ids = new Set<string>()
  for (const d of docs) {
    if (d.contentId) ids.add(d.contentId)
    if (d.posterId) ids.add(d.posterId)
    if ((d.kind === 'pdf' || d.kind === 'segmentation') && d.fileId) ids.add(d.fileId)
  }
  for (const id of Object.keys(index.files)) if (id.startsWith('img:')) ids.add(id)
  return [...ids].map((id) => index.files[id]).filter(Boolean)
}

export function videoEntries(index: PackIndex, docs: ManualDoc[]): PackFileEntry[] {
  return docs.filter((d) => d.kind === 'video' && d.fileId).map((d) => index.files[d.fileId!]).filter(Boolean)
}

let warming: Promise<void> | null = null
export function warmEssentials(): Promise<void> {
  warming ??= (async () => {
    const s = useHub.getState()
    if (!s.index) return
    const entries = essentialEntries(s.index, s.data.docs.filter((d) => !d.deleted))
    // the blacklist image travels with the essentials for roles that can read it
    if (s.session?.keys.restricted) {
      for (const sh of s.sheets) {
        const e = !sh.deleted ? s.index.files[sh.fileId] : undefined
        if (e) entries.push(e)
      }
    }
    try {
      await prefetch(entries)
    } catch {
      /* offline — try again next time */
    } finally {
      warming = null
    }
    await loadAllContents()
  })()
  return warming
}

/** Decrypt structured content for every document (for search). */
export async function loadAllContents(): Promise<void> {
  const s = useHub.getState()
  if (!s.session || !s.index) return
  const ids = new Set(s.data.docs.filter((d) => !d.deleted && d.contentId).map((d) => d.contentId!))
  for (const id of ids) {
    if (useHub.getState().contents[id]) continue
    const entry = entryFor(id)
    if (!entry) continue
    try {
      useHub.getState().setContent(id, await readJson<DocContent>(entry, s.session.keys))
    } catch {
      /* not cached yet */
    }
  }
}

export async function getContent(contentId: string): Promise<DocContent> {
  const s = useHub.getState()
  const have = s.contents[contentId]
  if (have) return have
  const entry = entryFor(contentId)
  if (!entry || !s.session) throw new Error('Document content is not available on this device yet')
  const c = await readJson<DocContent>(entry, s.session.keys)
  s.setContent(contentId, c)
  return c
}

// ---- decrypted object URLs -----------------------------------------------------------------------
const urlCache = new Map<string, Promise<string>>()
const LARGE = 4 * 1024 * 1024

export function fileUrl(fileId: string, onProgress?: (done: number, total: number) => void): Promise<string> {
  const cached = urlCache.get(fileId)
  if (cached) return cached
  const p = (async () => {
    const s = useHub.getState()
    const entry = entryFor(fileId)
    if (!entry || !s.session) throw new Error('File not available')
    const bytes = await readFile(entry, s.session.keys, onProgress)
    return URL.createObjectURL(new Blob([bytes], { type: entry.mime }))
  })()
  const entry = entryFor(fileId)
  // keep small files (images, posters) for the session; large media is released by the viewer
  if (!entry || entry.size < LARGE) urlCache.set(fileId, p)
  p.catch(() => urlCache.delete(fileId))
  return p
}

export function releaseUrl(fileId: string, url: string) {
  const entry = entryFor(fileId)
  if (entry && entry.size >= LARGE) URL.revokeObjectURL(url)
}

export function clearUrlCache() {
  for (const p of urlCache.values()) void p.then((u) => URL.revokeObjectURL(u)).catch(() => {})
  urlCache.clear()
}

export function useFileUrl(fileId?: string, opts: { enabled?: boolean } = {}) {
  const enabled = opts.enabled ?? true
  const [state, setState] = useState<{ url?: string; error?: string; progress?: number }>({})
  const indexReady = useHub((s) => !!s.index || Object.keys(s.localFiles).length > 0)
  useEffect(() => {
    if (!fileId || !enabled || !indexReady) return
    let alive = true
    let got: string | undefined
    setState({ progress: 0 })
    fileUrl(fileId, (d, t) => alive && setState((x) => ({ ...x, progress: t ? d / t : 0 })))
      .then((url) => {
        got = url
        if (alive) setState({ url })
      })
      .catch((e: unknown) => alive && setState({ error: e instanceof Error ? e.message : String(e) }))
    return () => {
      alive = false
      if (got) releaseUrl(fileId, got)
    }
  }, [fileId, enabled, indexReady])
  return state
}
