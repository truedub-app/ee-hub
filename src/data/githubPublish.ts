/**
 * One-click publishing: the administrator's device commits the next encrypted data version straight to
 * the site's gh-pages branch through the GitHub API. GitHub Pages then serves it, and every device picks
 * it up on its next update check.
 *
 * It needs a GitHub fine-grained token with Contents read & write on the site's repository. The token is
 * stored on this device only, sealed with the device's data key — never published, never in a backup.
 * Everything sent to GitHub is already encrypted (the same files as a manual publish package).
 */
import { toB64 } from '../lib/crypto'
import { del } from '../lib/idb'
import { url as packUrl } from '../lib/pack'
import { loadSealed, saveSealed } from '../lib/vault'
import { buildPublishFiles } from './publish'
import { useHub } from './store'
import { syncPack } from './sync'

const API = 'https://api.github.com'
const TOKEN_KEY = 'publisher'

export interface GitTarget {
  repo: string // 'owner/name'
  branch: string
  token: string
}

export class GitHubError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** The repository behind the site this app is served from (owner.github.io/name/), if it is one. */
export function siteRepo(loc: { hostname: string; pathname: string } = location): string | undefined {
  const m = loc.hostname.match(/^([a-z0-9-]+)\.github\.io$/i)
  const name = loc.pathname.split('/').filter(Boolean)[0]
  return m && name ? `${m[1]}/${name}` : undefined
}

export const DEFAULT_REPO = 'truedub-app/ee-hub'

async function gh<T>(t: GitTarget, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${t.token}`, Accept: 'application/vnd.github+json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  })
  if (!res.ok) {
    let msg = res.statusText
    try {
      msg = ((await res.json()) as { message?: string }).message ?? msg
    } catch {
      /* not JSON */
    }
    throw new GitHubError(res.status, explain(res.status, msg, t))
  }
  return (res.status === 204 ? undefined : await res.json()) as T
}

function explain(status: number, msg: string, t: GitTarget): string {
  if (status === 401) return 'GitHub rejected the token — it may be mistyped, expired or revoked. Create a new one and save it again.'
  if (status === 403 && /not accessible|permission/i.test(msg)) return `The token is not allowed to write to ${t.repo}. Give it “Contents: Read and write” for that repository.`
  if (status === 404) return `GitHub can’t find ${t.repo} (or the ${t.branch} branch) with this token. Check the repository name and that the token includes this repository.`
  if (status === 422 && /fast.?forward/i.test(msg)) return 'Someone published at the same moment. Try again.'
  return `GitHub: ${msg} (${status})`
}

/**
 * Check a token can publish: the repository and branch are visible, and it may write (creating an
 * empty blob is the cheapest write GitHub offers; it leaves nothing behind in the site).
 */
export async function verifyTarget(t: GitTarget): Promise<{ login?: string }> {
  await gh(t, 'GET', `/repos/${t.repo}`)
  await gh(t, 'GET', `/repos/${t.repo}/git/ref/heads/${t.branch}`)
  await gh(t, 'POST', `/repos/${t.repo}/git/blobs`, { content: '', encoding: 'utf-8' })
  try {
    const u = await gh<{ login: string }>(t, 'GET', '/user')
    return { login: u.login }
  } catch {
    return {}
  }
}

/** Read one text file from the branch (e.g. the published pack/manifest.json). */
export async function readBranchFile(t: GitTarget, path: string): Promise<string | undefined> {
  try {
    const f = await gh<{ content: string }>(t, 'GET', `/repos/${t.repo}/contents/${path}?ref=${encodeURIComponent(t.branch)}`)
    return new TextDecoder().decode(Uint8Array.from(atob(f.content.replace(/\n/g, '')), (c) => c.charCodeAt(0)))
  } catch (e) {
    if (e instanceof GitHubError && e.status === 404) return undefined
    throw e
  }
}

/**
 * One commit on the branch: add/replace `files`, delete `remove` (paths that do not exist are skipped).
 * Uses the Git data API so large encrypted parts upload as blobs, then moves the branch without force.
 */
export async function commitFiles(
  t: GitTarget,
  opts: { files: Record<string, Uint8Array>; remove?: string[]; message: string },
  onProgress?: (done: number, total: number) => void,
): Promise<{ sha: string; url: string }> {
  const ref = await gh<{ object: { sha: string } }>(t, 'GET', `/repos/${t.repo}/git/ref/heads/${t.branch}`)
  const parent = await gh<{ tree: { sha: string } }>(t, 'GET', `/repos/${t.repo}/git/commits/${ref.object.sha}`)
  const paths = Object.keys(opts.files)
  const total = paths.length + 3
  let done = 0
  const tick = () => onProgress?.(++done, total)

  const tree: { path: string; mode: '100644'; type: 'blob'; sha: string | null }[] = []
  for (const path of paths) {
    const blob = await gh<{ sha: string }>(t, 'POST', `/repos/${t.repo}/git/blobs`, { content: toB64(opts.files[path]), encoding: 'base64' })
    tree.push({ path, mode: '100644', type: 'blob', sha: blob.sha })
    tick()
  }
  if (opts.remove?.length) {
    const existing = await gh<{ tree: { path: string }[] }>(t, 'GET', `/repos/${t.repo}/git/trees/${parent.tree.sha}?recursive=1`)
    const have = new Set(existing.tree.map((e) => e.path))
    for (const path of opts.remove) if (have.has(path) && !opts.files[path]) tree.push({ path, mode: '100644', type: 'blob', sha: null })
  }
  const newTree = await gh<{ sha: string }>(t, 'POST', `/repos/${t.repo}/git/trees`, { base_tree: parent.tree.sha, tree })
  tick()
  const commit = await gh<{ sha: string; html_url: string }>(t, 'POST', `/repos/${t.repo}/git/commits`, { message: opts.message, tree: newTree.sha, parents: [ref.object.sha] })
  tick()
  await gh(t, 'PATCH', `/repos/${t.repo}/git/refs/heads/${t.branch}`, { sha: commit.sha, force: false })
  tick()
  return { sha: commit.sha, url: commit.html_url }
}

// ---- this device's publishing setup -------------------------------------------------------------

export async function savePublisher(t: GitTarget, login?: string): Promise<void> {
  const s = useHub.getState()
  if (!s.session) throw new Error('Locked')
  await saveSealed(s.session.dek, TOKEN_KEY, { token: t.token })
  s.setLocal({ publisher: { repo: t.repo, branch: t.branch, login, savedAt: Date.now() } })
  s.audit('publish.setup', t.repo, login)
}

export async function removePublisher(): Promise<void> {
  const s = useHub.getState()
  await del('sealed', TOKEN_KEY)
  s.setLocal({ publisher: undefined })
  s.audit('publish.remove')
}

async function loadTarget(): Promise<GitTarget | undefined> {
  const s = useHub.getState()
  const p = s.local.publisher
  if (!s.session || !p) return undefined
  const saved = await loadSealed<{ token: string }>(s.session.dek, TOKEN_KEY)
  return saved ? { repo: p.repo, branch: p.branch, token: saved.token } : undefined
}

export type PublishStep = 'sync' | 'build' | 'upload' | 'site' | 'done'

/**
 * Publish this device's data to every device. First merges the latest published version (so nobody
 * else's publish is lost), then commits the new files, then waits until the site serves them.
 */
export async function publishNow(onStep?: (step: PublishStep, detail?: string) => void): Promise<{ version: number; live: boolean }> {
  const s = useHub.getState()
  const target = await loadTarget()
  if (!target) throw new Error('One-click publishing is not set up on this device')
  const startedAt = Date.now()

  onStep?.('sync')
  const synced = await syncPack()
  if (synced.status === 'offline') throw new Error('No internet connection — publish when you are back online')
  if (synced.status === 'error') throw new Error(`Could not load the current published version: ${synced.message}`)
  // the site can lag a minute behind the repository: make sure we build on the newest version
  const remote = await readBranchFile(target, 'pack/manifest.json')
  const remoteVersion = remote ? (JSON.parse(remote) as { version: number }).version : 0
  if (remoteVersion > (useHub.getState().manifest?.version ?? 0)) {
    throw new Error(`Data version ${remoteVersion} was just published and is still reaching the site. Try again in a minute or two.`)
  }

  onStep?.('build')
  const pub = await buildPublishFiles()
  onStep?.('upload', '0%')
  const who = s.local.userName ?? s.session?.label ?? 'administrator'
  await commitFiles(
    target,
    { files: pub.files, remove: pub.replaced, message: `Publish data version ${pub.version} from the app (${who})` },
    (d, n) => onStep?.('upload', `${Math.round((d / n) * 100)}%`),
  )
  const st = useHub.getState()
  st.setLocal({ publishedAt: startedAt, publishedVersion: pub.version })
  st.audit('pack.publish', `v${pub.version}`, `${Object.keys(pub.files).length} files → ${target.repo}`)

  // wait (up to ~3 minutes) for GitHub Pages to serve the new version, then load it here too
  onStep?.('site')
  const live = siteRepo() ? await waitForSite(pub.version, 180_000) : false
  if (live) await syncPack()
  onStep?.('done')
  return { version: pub.version, live }
}

async function waitForSite(version: number, timeoutMs: number): Promise<boolean> {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    try {
      const res = await fetch(`${packUrl('manifest.json')}?v=${Date.now()}`, { cache: 'no-store' })
      if (res.ok && ((await res.json()) as { version: number }).version >= version) return true
    } catch {
      /* keep waiting */
    }
    await new Promise((r) => setTimeout(r, 8000))
  }
  return false
}
