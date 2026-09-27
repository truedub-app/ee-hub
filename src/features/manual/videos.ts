import { useMemo } from 'react'
import { useHub } from '../../data/store'
import type { ManualDoc } from '../../data/types'

/**
 * Videos live inside the document they explain. A walkthrough belongs to the first document in its
 * `related` list that is not itself a video (the "Check & Copy, Segment & QC 1" video → the Module 3
 * procedure). Videos without such a document stay on their own in the library.
 */
export interface DocVideos {
  /** video id → id of the document it belongs to */
  homeOf: Map<string, string>
  /** document id → its videos, in library order */
  videosOf: Map<string, ManualDoc[]>
}

export function docVideos(docs: ManualDoc[]): DocVideos {
  const live = new Map(docs.filter((d) => !d.deleted).map((d) => [d.id, d]))
  const homeOf = new Map<string, string>()
  const videosOf = new Map<string, ManualDoc[]>()
  for (const d of live.values()) {
    if (d.kind !== 'video') continue
    const home = (d.related ?? []).map((id) => live.get(id)).find((x) => x && x.kind !== 'video')
    if (!home) continue
    homeOf.set(d.id, home.id)
    videosOf.set(home.id, [...(videosOf.get(home.id) ?? []), d])
  }
  return { homeOf, videosOf }
}

export function useDocVideos(): DocVideos {
  const docs = useHub((s) => s.data.docs)
  return useMemo(() => docVideos(docs), [docs])
}
