import { useState } from 'react'
import { CircleCheck, CloudUpload, ExternalLink, KeyRound, PackageCheck, Power } from 'lucide-react'
import { useHub } from '../../data/store'
import { DEFAULT_REPO, publishNow, removePublisher, savePublisher, siteRepo, verifyTarget, type PublishStep } from '../../data/githubPublish'
import { buildPublishZip } from '../../data/publish'
import { downloadBytes } from '../../data/backup'
import { dateTime, relativeDateTime } from '../../lib/dates'
import { Badge, Field, Modal, Notice, Progress } from '../../ui/primitives'
import { confirmDialog, toast } from '../../ui/toast'
import '../install/install.css'

const TOKEN_PAGE = 'https://github.com/settings/personal-access-tokens/new'

/** Changes made on this device that other devices don't have yet. */
export function useUnpublished(): boolean {
  const local = useHub((s) => s.local)
  return !!local.editedAt && local.editedAt > (local.publishedAt ?? 0)
}

/** Guided, one-time setup of one-click publishing on this device. */
export function PublisherSetup({ onClose, onSaved }: { onClose: () => void; onSaved?: () => void }) {
  const current = useHub((s) => s.local.publisher)
  const [repo, setRepo] = useState(current?.repo ?? siteRepo() ?? DEFAULT_REPO)
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string>()
  const owner = repo.split('/')[0]
  const name = repo.split('/')[1] ?? ''
  const save = async () => {
    setBusy(true)
    setErr(undefined)
    try {
      const t = { repo: repo.trim(), branch: 'gh-pages', token: token.trim() }
      const { login } = await verifyTarget(t)
      await savePublisher(t, login)
      toast('One-click publishing is on for this device')
      onSaved?.()
      onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      open
      onClose={onClose}
      title="Set up one-click publishing"
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy || !token.trim() || !/^[\w.-]+\/[\w.-]+$/.test(repo.trim())} onClick={() => void save()}>
            {busy ? <><span className="spinner" /> Checking…</> : <><KeyRound /> Check and save</>}
          </button>
        </>
      }
    >
      <div className="col" style={{ gap: 16 }}>
        <p className="small muted">
          Publishing needs a GitHub key (a “fine-grained token”) that may update this site. You create it once on GitHub — signed in as <strong>{owner}</strong> — and paste it here.
        </p>
        <ol className="install-steps">
          <li><span>Open <a href={TOKEN_PAGE} target="_blank" rel="noopener noreferrer">GitHub → new fine-grained token <ExternalLink width={13} style={{ verticalAlign: -1 }} /></a>.</span></li>
          <li><span><strong>Token name:</strong> EE Hub publishing. <strong>Expiration:</strong> 1 year (or longer if offered). <strong>Resource owner:</strong> {owner}.</span></li>
          <li><span><strong>Repository access:</strong> Only select repositories → <strong>{name || 'the site repository'}</strong>.</span></li>
          <li><span><strong>Permissions</strong> → Repository permissions → <strong>Contents: Read and write</strong>. Nothing else is needed.</span></li>
          <li><span>Click <strong>Generate token</strong>, copy it, and paste it below.</span></li>
        </ol>
        <div className="form-grid">
          <Field label="Site repository" htmlFor="pub-repo" hint="owner/name — filled in for you">
            <input id="pub-repo" className="input mono" value={repo} onChange={(e) => setRepo(e.target.value)} spellCheck={false} autoComplete="off" />
          </Field>
          <Field label="GitHub token" htmlFor="pub-token" hint="Starts with github_pat_">
            <input id="pub-token" type="password" className="input mono" value={token} onChange={(e) => setToken(e.target.value)} spellCheck={false} autoComplete="off" />
          </Field>
        </div>
        {err && <Notice tone="alert">{err}</Notice>}
        <p className="tiny faint">
          The token stays on this device only, encrypted. It is never published, never included in backups, and other devices never see it. Anyone who can open the Hub as administrator on this device can publish — turn on the PIN in Settings if others use it.
        </p>
      </div>
    </Modal>
  )
}

const STEPS: [PublishStep, string][] = [
  ['sync', 'Getting the latest published version'],
  ['build', 'Encrypting this device’s data'],
  ['upload', 'Sending it to GitHub'],
  ['site', 'Waiting for the site to update'],
]

export interface PublishState {
  step?: PublishStep
  detail?: string
  error?: string
  result?: { version: number; live: boolean }
}

export function usePublishRunner() {
  const [state, setState] = useState<PublishState>({})
  const running = !!state.step && state.step !== 'done' && !state.error
  const run = async () => {
    setState({ step: 'sync' })
    try {
      const result = await publishNow((step, detail) => setState((s) => ({ ...s, step, detail })))
      setState({ step: 'done', result })
      toast(`Published data version ${result.version} to all devices`)
    } catch (e) {
      setState((s) => ({ ...s, error: e instanceof Error ? e.message : String(e) }))
    }
  }
  return { state, run, running }
}

export function PublishProgress({ state }: { state: PublishState }) {
  if (!state.step) return null
  if (state.step === 'done' && state.result) {
    return (
      <Notice tone="qc2" icon={<CircleCheck />}>
        <strong>Published as data version {state.result.version}.</strong>{' '}
        {state.result.live
          ? 'The site already has it. Every device gets it the next time it opens the Hub or checks for updates — within a few minutes while it is open.'
          : 'The site updates within a minute or two, then every device gets it the next time it opens the Hub or checks for updates.'}
      </Notice>
    )
  }
  const at = STEPS.findIndex(([s]) => s === state.step)
  return (
    <div className="col" style={{ gap: 8 }} role="status" aria-live="polite">
      {STEPS.map(([s, label], i) => (
        <div key={s} className="row" style={{ gap: 10, color: i < at ? 'var(--text-2)' : i === at ? 'var(--text)' : 'var(--text-3)' }}>
          {i < at ? <CircleCheck width={16} style={{ color: 'var(--qc2)' }} /> : i === at && !state.error ? <span className="spinner" /> : <span style={{ width: 16 }} />}
          <span className="small">{label}{i === at && state.detail ? ` — ${state.detail}` : ''}</span>
        </div>
      ))}
      {state.step === 'upload' && state.detail && <Progress value={parseInt(state.detail) / 100} />}
      {state.error && <Notice tone="alert">{state.error}</Notice>}
    </div>
  )
}

/** "Publish to all devices" card on the Backup page. */
export function PublishCard() {
  const s = useHub()
  const publisher = s.local.publisher
  const unpublished = useUnpublished()
  const { state, run, running } = usePublishRunner()
  const [setup, setSetup] = useState(false)
  const [busy, setBusy] = useState(false)
  const next = Math.max(s.manifest?.version ?? 0, s.local.packVersion ?? 0) + 1

  const download = async () => {
    setBusy(true)
    try {
      const r = await buildPublishZip()
      downloadBytes(r.zip as Uint8Array<ArrayBuffer>, `hub-pack-v${r.version}.zip`, 'application/zip')
      s.audit('pack.publish', `v${r.version}`, `${r.files} files (zip)`)
      toast(`Publish package v${r.version} created`)
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'alert')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card" id="publish" style={{ scrollMarginTop: 80 }}>
      <div className="card-head">
        <CloudUpload width={18} style={{ color: 'var(--accent-2)' }} />
        <h2>Publish to all devices</h2>
        <span className="spacer" />
        <Badge tone="muted">Current: v{s.manifest?.version ?? '—'}</Badge>
      </div>
      <div className="card-body col" style={{ gap: 14 }}>
        {unpublished ? (
          <Notice tone="warn">This device has changes that other devices don’t have yet{s.local.editedAt ? ` (last change ${relativeDateTime(s.local.editedAt)})` : ''}.</Notice>
        ) : s.local.publishedAt ? (
          <Notice tone="qc2" icon={<CircleCheck />}>Everything on this device is published — data version {s.local.publishedVersion}, {dateTime(s.local.publishedAt)}.</Notice>
        ) : null}

        {publisher ? (
          <>
            <p className="small muted">
              One-click publishing is on: this device sends its data straight to <span className="mono">{publisher.repo}</span>
              {publisher.login ? <> as <strong>{publisher.login}</strong></> : null}. Rota imports publish automatically.
            </p>
            <div className="row-wrap">
              <button className="btn btn-primary" disabled={running || !s.manifest} onClick={() => void run()}>
                {running ? <><span className="spinner" /> Publishing…</> : <><CloudUpload /> Publish data version {next} now</>}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setSetup(true)} disabled={running}><KeyRound /> Replace token</button>
              <button
                className="btn btn-ghost btn-sm"
                disabled={running}
                onClick={async () => {
                  if (await confirmDialog({ title: 'Turn off one-click publishing?', body: 'The GitHub token is erased from this device. You can set it up again at any time.', confirm: 'Turn off' })) {
                    await removePublisher()
                    toast('One-click publishing turned off on this device')
                  }
                }}
              >
                <Power /> Turn off
              </button>
            </div>
            <PublishProgress state={state} />
          </>
        ) : (
          <>
            <p className="small muted">
              Set up one-click publishing once, and everything you change here — a new rota, duties, staff, documents, the blacklist — reaches every device with one button. Rota imports then publish automatically.
            </p>
            <div><button className="btn btn-primary" onClick={() => setSetup(true)}><KeyRound /> Set up one-click publishing</button></div>
          </>
        )}

        <details>
          <summary className="small muted" style={{ cursor: 'pointer' }}>Or publish by hand with a zip file</summary>
          <div className="col" style={{ gap: 10, marginTop: 10 }}>
            <p className="small muted">
              Download data version {next} as a zip. On GitHub, open the <span className="mono">gh-pages</span> branch → <span className="mono">pack</span> folder → Add file → Upload files, and drag in the contents of the zip’s <span className="mono">pack</span> folder.
            </p>
            <div><button className="btn" onClick={() => void download()} disabled={busy || !s.manifest}><PackageCheck /> Download publish package</button></div>
          </div>
        </details>
      </div>
      {setup && <PublisherSetup onClose={() => setSetup(false)} />}
    </section>
  )
}
