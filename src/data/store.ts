/**
 * Application store. Holds the decrypted working set in memory while unlocked and persists
 * every change, sealed with the device key, to IndexedDB.
 */
import { create } from 'zustand'
import type { AuditEvent, BlacklistEntry, BlacklistSheet, DocContent, HubData, RecordMeta, Role } from './types'
import { emptyData, live } from './merge'
import { PERMS, type Perms } from './perms'
import type { PackFileEntry, PackIndex, PackManifest } from '../lib/packFormat'
import { keysFrom, type PackKeys } from '../lib/pack'
import * as idb from '../lib/idb'
import { loadSealed, saveSealed, type VaultPayload } from '../lib/vault'
import { uid } from '../lib/text'

export interface UiPrefs {
  theme: 'dark' | 'light'
  textScale: number // 0.875 … 1.25
  contrast: 'normal' | 'high'
  reduceMotion: boolean
  sidebarCollapsed: boolean
}

export const DEFAULT_UI: UiPrefs = { theme: 'dark', textScale: 1, contrast: 'normal', reduceMotion: false, sidebarCollapsed: false }

export interface LocalState {
  userName?: string
  staffId?: string
  favorites: string[]
  recent: { id: string; at: number }[]
  audit: AuditEvent[]
  weekStart: 0 | 1
  lockMinutes: number
  hideBlacklist: boolean
  blacklistReauth: boolean
  lastBackupAt?: number
  packVersion?: number
  packBuiltAt?: string
  lastDataAt?: number
  lastDataSource?: string
  dismissed: string[]
  graphicsSection: boolean
  /** Last change made on this device (rota import, edits, blacklist) — compared with publishedAt. */
  editedAt?: number
  /** Last time this device published to every device, and which data version that was. */
  publishedAt?: number
  publishedVersion?: number
  /** One-click publishing is set up on this device (the token itself is kept separately, encrypted). */
  publisher?: { repo: string; branch: string; login?: string; savedAt: number }
}

export const DEFAULT_LOCAL: LocalState = {
  favorites: [],
  recent: [],
  audit: [],
  weekStart: 0,
  lockMinutes: 15,
  hideBlacklist: false,
  blacklistReauth: false,
  dismissed: [],
  graphicsSection: false,
}

export type Phase = 'boot' | 'welcome' | 'locked' | 'ready'

export interface Session {
  role: Role
  label: string
  payload: VaultPayload
  dek: CryptoKey
  keys: PackKeys
}

export interface NetState {
  online: boolean
  checking: boolean
  lastCheck?: number
  error?: string
  downloading?: { label: string; done: number; total: number }
}

interface HubState {
  phase: Phase
  vaultRole?: Role
  session?: Session
  data: HubData
  blacklist: BlacklistEntry[]
  sheets: BlacklistSheet[]
  local: LocalState
  ui: UiPrefs
  manifest?: PackManifest
  index?: PackIndex
  contents: Record<string, DocContent>
  /** Files added on this device (in-app document import), stored encrypted in the pack cache. */
  localFiles: Record<string, PackFileEntry>
  net: NetState
  /** A PIN is required on this device (off by default). */
  pinOn: boolean
  blacklistUnlockedAt?: number

  setPhase(p: Phase, role?: Role): void
  startSession(payload: VaultPayload, dek: CryptoKey): Promise<void>
  lock(): void
  setPack(manifest: PackManifest, index: PackIndex): void
  setData(data: HubData, source?: string): void
  setBlacklistAll(list: BlacklistEntry[]): void
  setSheetsAll(list: BlacklistSheet[]): void
  upsertSheets(items: BlacklistSheet[]): void
  upsert<K extends keyof HubData>(key: K, items: HubData[K][number][]): void
  remove<K extends keyof HubData>(key: K, ids: string[]): void
  upsertBlacklist(items: BlacklistEntry[]): void
  setLocal(patch: Partial<LocalState>): void
  setUi(patch: Partial<UiPrefs>): void
  setNet(patch: Partial<NetState>): void
  setContent(id: string, c: DocContent): void
  addLocalFiles(files: Record<string, PackFileEntry>): void
  audit(action: string, target?: string, detail?: string): void
  touchRecent(docId: string): void
  toggleFavorite(id: string): void
  markBlacklistUnlocked(): void
}

// ---- persistence (debounced, sealed) -------------------------------------------------------------
const edited = (s: { local: LocalState }) => ({ local: { ...s.local, editedAt: Date.now() } })

const timers: Record<string, ReturnType<typeof setTimeout>> = {}
function persist(key: 'data' | 'restricted' | 'local' | 'localFiles') {
  clearTimeout(timers[key])
  timers[key] = setTimeout(() => {
    const s = useHub.getState()
    if (!s.session) return
    const value = key === 'data' ? s.data : key === 'restricted' ? { blacklist: s.blacklist, sheets: s.sheets } : key === 'localFiles' ? s.localFiles : s.local
    void saveSealed(s.session.dek, key, value).catch((e) => console.error('Save failed', e))
  }, 250)
}

export async function flushPersist(): Promise<void> {
  const s = useHub.getState()
  if (!s.session) return
  for (const k of Object.keys(timers)) clearTimeout(timers[k])
  await saveSealed(s.session.dek, 'data', s.data)
  if (s.session.keys.restricted) await saveSealed(s.session.dek, 'restricted', { blacklist: s.blacklist, sheets: s.sheets })
  await saveSealed(s.session.dek, 'local', s.local)
}

export const useHub = create<HubState>()((set, get) => ({
  phase: 'boot',
  data: emptyData(),
  blacklist: [],
  sheets: [],
  local: DEFAULT_LOCAL,
  ui: DEFAULT_UI,
  contents: {},
  localFiles: {},
  pinOn: false,
  net: { online: typeof navigator === 'undefined' ? true : navigator.onLine, checking: false },

  setPhase: (phase, role) => set({ phase, vaultRole: role ?? get().vaultRole }),

  async startSession(payload, dek) {
    const keys = await keysFrom(payload.slot)
    const data = (await loadSealed<HubData>(dek, 'data')) ?? emptyData()
    const restricted = keys.restricted ? await loadSealed<{ blacklist: BlacklistEntry[]; sheets?: BlacklistSheet[] }>(dek, 'restricted') : undefined
    const local = { ...DEFAULT_LOCAL, ...((await loadSealed<LocalState>(dek, 'local')) ?? {}) }
    const localFiles = (await loadSealed<Record<string, PackFileEntry>>(dek, 'localFiles')) ?? {}
    set({
      localFiles,
      session: { role: payload.slot.role, label: payload.slot.label, payload, dek, keys },
      data: { ...emptyData(), ...data },
      blacklist: restricted?.blacklist ?? [],
      sheets: restricted?.sheets ?? [],
      local,
      vaultRole: payload.slot.role,
    })
  },

  lock() {
    if (!get().pinOn) return // nothing to lock without a PIN
    void flushPersist().finally(() => {
      set({ session: undefined, data: emptyData(), blacklist: [], sheets: [], local: DEFAULT_LOCAL, contents: {}, localFiles: {}, index: undefined, phase: 'locked', blacklistUnlockedAt: undefined })
    })
  },

  setPack: (manifest, index) => set({ manifest, index }),

  setData(data, source) {
    set((s) => ({ data, local: { ...s.local, lastDataAt: Date.now(), lastDataSource: source ?? s.local.lastDataSource } }))
    persist('data')
    persist('local')
  },

  setBlacklistAll(list) {
    set({ blacklist: list })
    persist('restricted')
  },

  upsert(key, items) {
    const actor = get().local.userName ?? get().session?.label
    set((s) => {
      const map = new Map((s.data[key] as RecordMeta[]).map((r) => [r.id, r]))
      for (const it of items as RecordMeta[]) map.set(it.id, { ...it, updatedAt: it.updatedAt || Date.now(), updatedBy: it.updatedBy ?? actor })
      return { data: { ...s.data, [key]: [...map.values()] }, ...edited(s) }
    })
    persist('data')
    persist('local')
  },

  remove(key, ids) {
    const now = Date.now()
    const actor = get().local.userName ?? get().session?.label
    set((s) => ({
      data: {
        ...s.data,
        [key]: (s.data[key] as RecordMeta[]).map((r) => (ids.includes(r.id) ? { ...r, deleted: true, updatedAt: now, updatedBy: actor } : r)),
      },
      ...edited(s),
    }))
    persist('data')
    persist('local')
  },

  setSheetsAll(list) {
    set({ sheets: list })
    persist('restricted')
  },

  upsertSheets(items) {
    set((s) => {
      const map = new Map(s.sheets.map((r) => [r.id, r]))
      for (const it of items) map.set(it.id, it)
      return { sheets: [...map.values()], ...edited(s) }
    })
    persist('restricted')
    persist('local')
  },

  upsertBlacklist(items) {
    set((s) => {
      const map = new Map(s.blacklist.map((r) => [r.id, r]))
      for (const it of items) map.set(it.id, it)
      return { blacklist: [...map.values()], ...edited(s) }
    })
    persist('restricted')
    persist('local')
  },

  setLocal(patch) {
    set((s) => ({ local: { ...s.local, ...patch } }))
    persist('local')
  },

  setUi(patch) {
    const ui = { ...get().ui, ...patch }
    set({ ui })
    void idb.put('kv', 'ui', ui)
  },

  setNet: (patch) => set((s) => ({ net: { ...s.net, ...patch } })),

  setContent: (id, c) => set((s) => ({ contents: { ...s.contents, [id]: c } })),

  addLocalFiles(files) {
    set((s) => ({ localFiles: { ...s.localFiles, ...files }, ...edited(s) }))
    persist('localFiles')
    persist('local')
  },

  audit(action, target, detail) {
    const s = get()
    if (!s.session) return
    const ev: AuditEvent = {
      id: uid('ev-'),
      at: Date.now(),
      actor: s.local.userName ?? s.session.label,
      role: s.session.role,
      action,
      target,
      detail,
    }
    set((st) => ({ local: { ...st.local, audit: [ev, ...st.local.audit].slice(0, 2000) } }))
    persist('local')
  },

  touchRecent(docId) {
    set((s) => ({ local: { ...s.local, recent: [{ id: docId, at: Date.now() }, ...s.local.recent.filter((r) => r.id !== docId)].slice(0, 12) } }))
    persist('local')
  },

  toggleFavorite(id) {
    set((s) => {
      const has = s.local.favorites.includes(id)
      return { local: { ...s.local, favorites: has ? s.local.favorites.filter((x) => x !== id) : [...s.local.favorites, id] } }
    })
    persist('local')
  },

  markBlacklistUnlocked: () => set({ blacklistUnlockedAt: Date.now() }),
}))

// ---- selectors ---------------------------------------------------------------------------------
export function usePerms(): Perms {
  const role = useHub((s) => s.session?.role ?? 'guest')
  return PERMS[role]
}

export function useLive<K extends keyof HubData>(key: K): HubData[K] {
  const list = useHub((s) => s.data[key])
  return useMemoLive(list as RecordMeta[]) as HubData[K]
}

// small memo keyed on array identity
const liveCache = new WeakMap<object, unknown[]>()
function useMemoLive<T extends RecordMeta>(list: T[]): T[] {
  let v = liveCache.get(list) as T[] | undefined
  if (!v) {
    v = live(list)
    liveCache.set(list, v)
  }
  return v
}

export function canSeeBlacklist(): boolean {
  const s = useHub.getState()
  return !!s.session && PERMS[s.session.role].viewBlacklist && !!s.session.keys.restricted && !s.local.hideBlacklist
}

export async function loadUiPrefs(): Promise<UiPrefs> {
  return { ...DEFAULT_UI, ...((await idb.get<UiPrefs>('kv', 'ui')) ?? {}) }
}
