import { useEffect, useRef, useState } from 'react'
import { CloudDownload, Download, Trash2, Gauge } from 'lucide-react'
import { entryFor, useFileUrl } from '../../data/sync'
import { evict, isCached, prefetch } from '../../lib/pack'
import { Progress, Badge } from '../../ui/primitives'
import { formatBytes } from '../../lib/text'
import { toast } from '../../ui/toast'
import { useHub } from '../../data/store'

const SPEEDS = [0.75, 1, 1.25, 1.5, 2]

function posKey(id: string) {
  return `ee-hub:pos:${id}`
}

export function VideoPlayer({ fileId, posterId, docId, startAt, onDownload }: { fileId: string; posterId?: string; docId: string; startAt?: number; onDownload: () => void }) {
  const [go, setGo] = useState(false)
  const [cached, setCached] = useState<boolean>()
  const [saving, setSaving] = useState<number>()
  const poster = useFileUrl(posterId)
  const video = useFileUrl(fileId, { enabled: go })
  const ref = useRef<HTMLVideoElement>(null)
  const [speed, setSpeed] = useState(1)
  const entry = entryFor(fileId)
  const online = useHub((s) => s.net.online)

  // re-check after playback too: streaming a video caches its encrypted parts
  useEffect(() => {
    if (entry) void isCached(entry).then(setCached)
  }, [entry, video.url])

  useEffect(() => {
    const v = ref.current
    if (!v || !video.url) return
    let resume = startAt ?? 0
    try {
      if (!startAt) resume = Number(localStorage.getItem(posKey(docId)) ?? 0)
    } catch {
      /* storage blocked */
    }
    const onMeta = () => {
      if (resume > 5 && resume < v.duration - 10) v.currentTime = resume
      v.playbackRate = speed
      void v.play().catch(() => {})
    }
    const onTime = () => {
      try {
        localStorage.setItem(posKey(docId), String(Math.floor(v.currentTime)))
      } catch {
        /* ignore */
      }
    }
    v.addEventListener('loadedmetadata', onMeta)
    v.addEventListener('timeupdate', onTime)
    return () => {
      v.removeEventListener('loadedmetadata', onMeta)
      v.removeEventListener('timeupdate', onTime)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video.url])

  useEffect(() => {
    if (ref.current) ref.current.playbackRate = speed
  }, [speed])

  const saveOffline = async () => {
    if (!entry) return
    setSaving(0)
    try {
      await prefetch([entry], (d, t) => setSaving(d / t))
      setCached(true)
      toast('Video saved for offline use')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Download failed', 'alert')
    } finally {
      setSaving(undefined)
    }
  }
  const removeOffline = async () => {
    if (!entry) return
    await evict([entry])
    setCached(false)
    toast('Offline copy removed')
  }

  return (
    <div className="video-wrap">
      <div className="video-stage">
        {video.url ? (
          <video ref={ref} src={video.url} controls playsInline preload="metadata" poster={poster.url} aria-label="Training video" />
        ) : (
          <button className="video-poster" onClick={() => setGo(true)} disabled={go} aria-label="Play video" style={poster.url ? { backgroundImage: `url(${poster.url})` } : undefined}>
            {go ? (
              <span className="col" style={{ alignItems: 'center', gap: 10, width: 240 }}>
                <span className="spinner lg" />
                <span className="small">{video.error ? video.error : `${cached ? 'Decrypting' : 'Downloading & decrypting'}… ${Math.round((video.progress ?? 0) * 100)}%`}</span>
                <Progress value={video.progress ?? 0} />
              </span>
            ) : (
              <span className="play-btn" aria-hidden>▶</span>
            )}
          </button>
        )}
      </div>
      <div className="video-bar">
        <span className="row small muted" style={{ gap: 6 }}><Gauge width={16} /> Speed</span>
        <div className="segmented" role="group" aria-label="Playback speed">
          {SPEEDS.map((s) => (
            <button key={s} type="button" aria-pressed={speed === s} onClick={() => setSpeed(s)}>{s}×</button>
          ))}
        </div>
        <span className="spacer" />
        {entry && <span className="small faint">{formatBytes(entry.size)}</span>}
        {cached ? (
          <>
            <Badge tone="qc2">Available offline</Badge>
            <button className="icon-btn sm" onClick={removeOffline} aria-label="Remove offline copy" title="Remove offline copy"><Trash2 /></button>
          </>
        ) : saving !== undefined ? (
          <span style={{ width: 120 }}><Progress value={saving} /></span>
        ) : (
          <button className="btn btn-sm" onClick={saveOffline} disabled={!online}><CloudDownload /> Save offline</button>
        )}
        <button className="btn btn-sm" onClick={onDownload}><Download /> <span className="desktop-only">Export video</span></button>
      </div>
    </div>
  )
}
