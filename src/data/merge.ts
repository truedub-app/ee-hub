import type { BlacklistEntry, HubData, RecordMeta } from './types'

export interface MergeStats {
  added: number
  updated: number
  deleted: number
  kept: number
}

/** Last-write-wins merge by id. Tombstones (deleted: true) win when newer. */
export function mergeList<T extends RecordMeta>(local: T[], incoming: T[], stats?: MergeStats): T[] {
  const map = new Map(local.map((r) => [r.id, r]))
  for (const r of incoming) {
    const cur = map.get(r.id)
    if (!cur) {
      map.set(r.id, r)
      if (stats) {
        if (r.deleted) stats.deleted++
        else stats.added++
      }
    } else if (r.updatedAt > cur.updatedAt) {
      map.set(r.id, r)
      if (stats) {
        if (r.deleted && !cur.deleted) stats.deleted++
        else stats.updated++
      }
    } else if (stats) stats.kept++
  }
  return [...map.values()]
}

export const DATA_KEYS: (keyof HubData)[] = ['sections', 'shiftCodes', 'staff', 'rota', 'duties', 'categories', 'docs', 'contacts', 'imports']

export function emptyData(): HubData {
  return { sections: [], shiftCodes: [], staff: [], rota: [], duties: [], categories: [], docs: [], contacts: [], imports: [] }
}

export function mergeData(local: HubData, incoming: Partial<HubData>): { data: HubData; stats: MergeStats } {
  const stats: MergeStats = { added: 0, updated: 0, deleted: 0, kept: 0 }
  const out = { ...local }
  for (const k of DATA_KEYS) {
    const inc = incoming[k]
    if (inc) (out as Record<string, RecordMeta[]>)[k] = mergeList(local[k] as RecordMeta[], inc as RecordMeta[], stats)
  }
  return { data: out, stats }
}

export function mergeBlacklist(local: BlacklistEntry[], incoming: BlacklistEntry[]) {
  const stats: MergeStats = { added: 0, updated: 0, deleted: 0, kept: 0 }
  return { list: mergeList(local, incoming, stats), stats }
}

/** Live (non-deleted) records. */
export function live<T extends RecordMeta>(list: T[]): T[] {
  return list.filter((r) => !r.deleted)
}
