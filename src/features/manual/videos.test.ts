import { describe, expect, it } from 'vitest'
import { docVideos } from './videos'
import type { ManualDoc } from '../../data/types'

const doc = (id: string, kind: ManualDoc['kind'], related: string[] = [], deleted = false): ManualDoc =>
  ({ id, kind, title: id, description: '', category: 'x', related, updatedAt: 0, deleted }) as ManualDoc

describe('videos inside their documents', () => {
  const docs = [
    doc('proc-01', 'procedure'),
    doc('proc-03', 'procedure'),
    doc('seg-map', 'segmentation'),
    doc('vid-check-copy', 'video', ['proc-03']),
    doc('vid-oracle', 'video', ['proc-01']),
    doc('vid-txmhd', 'video', ['proc-01', 'proc-02']),
    doc('vid-qc2', 'video', ['vid-missing', 'seg-map', 'proc-03']), // a video first in the list is skipped
    doc('vid-alone', 'video', ['vid-oracle']), // only other videos → stays on its own
    doc('vid-gone', 'video', ['proc-gone']),
    doc('proc-gone', 'procedure', [], true), // deleted home → stays on its own
  ]
  const { homeOf, videosOf } = docVideos(docs)

  it('attaches each video to the first related document that is not a video', () => {
    expect(homeOf.get('vid-check-copy')).toBe('proc-03')
    expect(homeOf.get('vid-qc2')).toBe('seg-map')
    expect(videosOf.get('proc-01')!.map((v) => v.id)).toEqual(['vid-oracle', 'vid-txmhd'])
  })

  it('leaves videos without a live document on their own', () => {
    expect(homeOf.has('vid-alone')).toBe(false)
    expect(homeOf.has('vid-gone')).toBe(false)
  })
})
