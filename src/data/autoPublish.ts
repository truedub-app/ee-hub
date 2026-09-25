/**
 * Automatic publishing: on an administrator device that is connected to the site, every change made here
 * (a rota upload, duties, staff, documents, the blacklist) is published to all devices shortly afterwards,
 * without anyone pressing a button. Changes are grouped: publishing starts once edits pause for a moment.
 */
import { useEffect } from 'react'
import { useHub } from './store'
import { isPublishing, publishNow } from './githubPublish'
import { toast } from '../ui/toast'

const QUIET_MS = 20_000 // wait for edits to pause
const RETRY_MS = 2 * 60_000
const MAX_RETRIES = 3

function due(): boolean {
  const s = useHub.getState()
  return s.session?.role === 'admin' && !!s.local.publisher && !!s.local.editedAt && s.local.editedAt > (s.local.publishedAt ?? 0)
}

export function useAutoPublish(): void {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let retries = 0
    const schedule = (ms = QUIET_MS) => {
      clearTimeout(timer)
      if (due()) timer = setTimeout(() => void run(), ms)
    }
    const run = async () => {
      if (!due()) return
      if (!navigator.onLine) return // the 'online' listener picks it up again
      if (isPublishing()) return schedule(30_000) // e.g. the rota import is publishing right now
      try {
        const r = await publishNow()
        retries = 0
        toast(`Sent to every device — data version ${r.version}`)
        schedule() // anything changed while publishing goes next
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        if (++retries <= MAX_RETRIES) schedule(RETRY_MS)
        toast(`Couldn’t send the changes to other devices yet: ${msg}`, 'warn', 8000)
      }
    }
    const unsub = useHub.subscribe((s, prev) => {
      if (s.local.editedAt !== prev.local.editedAt || s.local.publisher !== prev.local.publisher) {
        retries = 0
        schedule()
      }
    })
    const onOnline = () => schedule(5_000)
    window.addEventListener('online', onOnline)
    schedule(5_000) // changes left from earlier (e.g. a rota imported before publishing was connected)
    return () => {
      clearTimeout(timer)
      unsub()
      window.removeEventListener('online', onOnline)
    }
  }, [])
}
