import { useEffect, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { CloudDownload, HardDrive, KeyRound, Lock, Moon, RefreshCw, RotateCcw, ShieldCheck, Sun, Trash2, UserRound, Wifi, WifiOff } from 'lucide-react'
import { useHub, usePerms } from '../../data/store'
import { essentialEntries, syncPack, videoEntries, warmEssentials } from '../../data/sync'
import { cachedBytes, evict, isCached, prefetch } from '../../lib/pack'
import { readVault, removePin, setPin, unlockWithPin, wipeDevice, type PinMode } from '../../lib/vault'
import { ROLE_LABEL } from '../../lib/packFormat'
import { dateTime, relativeDateTime, mediumDate } from '../../lib/dates'
import { formatBytes } from '../../lib/text'
import { Badge, Field, Modal, Notice, Progress, Segmented, Switch } from '../../ui/primitives'
import { confirmDialog, toast } from '../../ui/toast'
import { IdentityPicker } from '../unlock/Gate'
import { PinEntry } from '../unlock/PinPad'
import { live } from '../../data/merge'

function Section({ id, title, icon, children }: { id: string; title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="card" aria-labelledby={`${id}-h`} style={{ scrollMarginTop: 80 }}>
      <div className="card-head"><span style={{ color: 'var(--accent-2)', display: 'flex' }}>{icon}</span><h2 id={`${id}-h`}>{title}</h2></div>
      <div className="card-body col" style={{ gap: 16 }}>{children}</div>
    </section>
  )
}

/** Set, change or remove the device PIN. 'set' asks for a new PIN; 'change' and 'remove' first check the current one. */
function PinDialog({ action, onClose }: { action: 'set' | 'change' | 'remove'; onClose: () => void }) {
  const session = useHub((s) => s.session)
  const [step, setStep] = useState<'old' | 'new' | 'confirm'>(action === 'set' ? 'new' : 'old')
  const [mode, setMode] = useState<PinMode>('pin6')
  const [oldMode, setOldMode] = useState<PinMode>('pin6')
  const [first, setFirst] = useState('')
  const [err, setErr] = useState<string>()
  const [n, setN] = useState(0)
  useEffect(() => {
    void readVault().then((v) => v?.pinMode && setOldMode(v.pinMode))
  }, [])
  const title = action === 'set' ? 'Turn on the PIN' : action === 'change' ? 'Change PIN' : 'Turn off the PIN'
  return (
    <Modal open onClose={onClose} title={title}>
      <div className="col" style={{ gap: 14 }}>
        {err && <Notice tone="alert">{err}</Notice>}
        {step === 'old' && (
          <PinEntry key={`o${n}`} mode={oldMode} label="Current PIN" onSubmit={async (p) => {
            const ok = await unlockWithPin(p).catch(() => null)
            if (!ok) {
              setErr('Current PIN is wrong')
              setN(n + 1)
            } else if (action === 'remove' && session) {
              await removePin(session.payload)
              useHub.setState({ pinOn: false })
              useHub.getState().audit('security.pin-off')
              toast('PIN turned off — the Hub opens directly on this device')
              onClose()
            } else {
              setErr(undefined)
              setStep('new')
            }
          }} />
        )}
        {step !== 'old' && (
          <>
            <Segmented<PinMode> label="PIN type" value={mode} onChange={(m) => { setMode(m); setStep('new'); setN(n + 1) }} options={[{ value: 'pin6', label: '6-digit PIN' }, { value: 'passcode', label: 'Passcode (8+)' }]} />
            <p className="small muted" style={{ textAlign: 'center' }}>{step === 'new' ? 'Enter the new PIN' : 'Confirm the new PIN'}</p>
            <PinEntry key={`${step}${n}${mode}`} mode={mode} label={step === 'new' ? 'New PIN' : 'Confirm'} onSubmit={async (p) => {
              if (step === 'new') {
                setFirst(p)
                setStep('confirm')
              } else if (p !== first) {
                setErr('The PINs did not match')
                setStep('new')
                setN(n + 1)
              } else if (session) {
                await setPin(session.payload, p, mode)
                useHub.setState({ pinOn: true })
                useHub.getState().audit(action === 'set' ? 'security.pin-on' : 'security.pin-change')
                toast(action === 'set' ? 'PIN turned on — it is needed each time the Hub opens' : 'PIN changed')
                onClose()
              }
            }} />
          </>
        )}
      </div>
    </Modal>
  )
}

export function SettingsPage() {
  const loc = useLocation()
  const ui = useHub((s) => s.ui)
  const setUi = useHub((s) => s.setUi)
  const local = useHub((s) => s.local)
  const setLocal = useHub((s) => s.setLocal)
  const session = useHub((s) => s.session)
  const data = useHub((s) => s.data)
  const blacklist = useHub((s) => s.blacklist)
  const net = useHub((s) => s.net)
  const index = useHub((s) => s.index)
  const manifest = useHub((s) => s.manifest)
  const perms = usePerms()
  const lock = useHub((s) => s.lock)
  const [who, setWho] = useState(false)
  const [pinDialog, setPinDialog] = useState<'set' | 'change' | 'remove'>()
  const pinOn = useHub((s) => s.pinOn)
  const [usage, setUsage] = useState(0)
  const [offline, setOffline] = useState<{ docs: boolean; videos: number; videoTotal: number }>()
  const [dl, setDl] = useState<{ label: string; p: number }>()

  useEffect(() => {
    const el = loc.hash && document.getElementById(loc.hash.slice(1))
    if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth' }), 50)
  }, [loc.hash])

  const refreshStorage = async () => {
    setUsage(await cachedBytes())
    if (!index) return
    const docs = live(data.docs)
    const ess = essentialEntries(index, docs)
    const vids = videoEntries(index, docs)
    let docsOk = true
    for (const e of ess) if (!(await isCached(e))) { docsOk = false; break }
    let v = 0
    for (const e of vids) if (await isCached(e)) v++
    setOffline({ docs: docsOk, videos: v, videoTotal: vids.length })
  }
  useEffect(() => {
    void refreshStorage()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index])

  const videoBytes = index ? videoEntries(index, live(data.docs)).reduce((a, e) => a + e.size, 0) : 0
  const lastImport = live(data.imports).filter((i) => i.kind === 'rota' && !i.rolledBack).sort((a, b) => b.importedAt - a.importedAt)[0]
  const staffName = data.staff.find((s) => s.id === local.staffId)?.name

  const download = async (which: 'docs' | 'videos') => {
    if (!index) return
    const docs = live(data.docs)
    const entries = which === 'docs' ? essentialEntries(index, docs) : videoEntries(index, docs)
    setDl({ label: which === 'docs' ? 'Documents' : 'Videos', p: 0 })
    try {
      await prefetch(entries, (d, t) => setDl({ label: which === 'docs' ? 'Documents' : 'Videos', p: d / t }))
      if (which === 'docs') await warmEssentials()
      toast(which === 'docs' ? 'All documents are available offline' : 'All videos are available offline')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Download failed', 'alert')
    } finally {
      setDl(undefined)
      void refreshStorage()
    }
  }

  return (
    <div className="col" style={{ gap: 16, maxWidth: 900 }}>
      <Section id="status" title="Offline status" icon={net.online ? <Wifi /> : <WifiOff />}>
        <div className="row-wrap">
          <Badge tone={net.online ? 'qc2' : 'warn'} lg>● {net.online ? 'Local data · network available' : 'Offline mode · local data'}</Badge>
          <span className="spacer" />
          <button className="btn btn-sm" disabled={net.checking} onClick={async () => { const r = await syncPack(); toast(r.message, r.status === 'error' ? 'alert' : r.status === 'offline' ? 'warn' : 'ok'); void refreshStorage() }}>
            <RefreshCw /> {net.checking ? 'Checking…' : 'Check for updates'}
          </button>
        </div>
        {net.error && <Notice tone="warn">Last update check failed: {net.error}</Notice>}
        <dl className="kv">
          <dt>Data version</dt><dd>{local.packVersion ?? '—'}{manifest?.builtAt ? <span className="faint"> · published {dateTime(Date.parse(manifest.builtAt))}</span> : null}</dd>
          <dt>Last updated</dt><dd>{local.lastDataAt ? `${relativeDateTime(local.lastDataAt)}${local.lastDataSource ? ` — ${local.lastDataSource}` : ''}` : '—'}</dd>
          <dt>Last rota import</dt><dd>{lastImport ? `${relativeDateTime(lastImport.importedAt)} — ${lastImport.fileName}${lastImport.period ? ` (${mediumDate(lastImport.period.from)} – ${mediumDate(lastImport.period.to)})` : ''}` : '—'}</dd>
          <dt>Last backup</dt><dd>{local.lastBackupAt ? relativeDateTime(local.lastBackupAt) : 'Never from this device'}</dd>
          <dt>Last check</dt><dd>{net.lastCheck ? relativeDateTime(net.lastCheck) : '—'}</dd>
          <dt>Storage used</dt><dd>{formatBytes(usage)}</dd>
          <dt>Documents</dt><dd>{live(data.docs).length} ({live(data.docs).filter((d) => d.kind === 'video').length} videos)</dd>
          <dt>Staff</dt><dd>{live(data.staff).length}</dd>
          <dt>Contacts</dt><dd>{live(data.contacts).length}</dd>
          {perms.viewBlacklist && <><dt>Blacklist entries</dt><dd>{live(blacklist).length}</dd></>}
          <dt>Rota cells</dt><dd>{live(data.rota).length}</dd>
        </dl>
        <div className="col" style={{ gap: 10 }}>
          <div className="row-wrap">
            <HardDrive width={18} className="faint" />
            <span className="grow">Documents, images & procedure text {offline ? (offline.docs ? <Badge tone="qc2">Available offline</Badge> : <Badge tone="warn">Partly online-only</Badge>) : null}</span>
            <button className="btn btn-sm" onClick={() => void download('docs')} disabled={!!dl || !net.online}><CloudDownload /> Download all</button>
          </div>
          <div className="row-wrap">
            <HardDrive width={18} className="faint" />
            <span className="grow">Training videos ({formatBytes(videoBytes)}) {offline ? <Badge tone={offline.videos === offline.videoTotal ? 'qc2' : 'muted'}>{offline.videos}/{offline.videoTotal} offline</Badge> : null}</span>
            <button className="btn btn-sm" onClick={() => void download('videos')} disabled={!!dl || !net.online}><CloudDownload /> Download all</button>
            {offline && offline.videos > 0 && (
              <button className="icon-btn sm" aria-label="Remove offline videos" title="Remove offline videos" onClick={async () => { if (index) { await evict(videoEntries(index, live(data.docs))); toast('Offline videos removed'); void refreshStorage() } }}><Trash2 /></button>
            )}
          </div>
          {dl && <div className="col" style={{ gap: 4 }}><span className="small muted">Downloading {dl.label}… {Math.round(dl.p * 100)}%</span><Progress value={dl.p} /></div>}
        </div>
        <p className="tiny faint">Each device keeps its own encrypted copy. When a network is available the Hub fetches the latest published version automatically; everything keeps working when the studio network is down.</p>
      </Section>

      <Section id="profile" title="Profile" icon={<UserRound />}>
        <dl className="kv">
          <dt>Signed in as</dt><dd>{local.userName ?? <span className="faint">Not set</span>}{staffName && staffName !== local.userName ? ` (${staffName})` : ''}</dd>
          <dt>Access level</dt><dd>{session ? ROLE_LABEL[session.role] : '—'}</dd>
        </dl>
        <div><button className="btn" onClick={() => setWho(true)}>Change who I am</button></div>
        {who && (
          <Modal open onClose={() => setWho(false)} title="Who are you?">
            <IdentityPicker onDone={(staffId, name) => { setLocal({ staffId, userName: name }); setWho(false); toast(`Profile set to ${name}`) }} />
          </Modal>
        )}
      </Section>

      <Section id="display" title="Display" icon={ui.theme === 'dark' ? <Moon /> : <Sun />}>
        <div className="form-grid">
          <Field label="Theme">
            <Segmented label="Theme" value={ui.theme} onChange={(v) => setUi({ theme: v })} options={[{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }]} />
          </Field>
          <Field label={`Text size — ${Math.round(ui.textScale * 100)}%`} htmlFor="ts">
            <input id="ts" type="range" min={0.875} max={1.3} step={0.025} value={ui.textScale} onChange={(e) => setUi({ textScale: Number(e.target.value) })} />
          </Field>
          <Field label="Week starts on">
            <Segmented label="Week start" value={String(local.weekStart)} onChange={(v) => setLocal({ weekStart: Number(v) as 0 | 1 })} options={[{ value: '0', label: 'Sunday' }, { value: '1', label: 'Monday' }]} />
          </Field>
        </div>
        <Switch checked={ui.contrast === 'high'} onChange={(v) => setUi({ contrast: v ? 'high' : 'normal' })} label="High-contrast mode" hint="Stronger borders and pure text colours" />
        <Switch checked={ui.reduceMotion} onChange={(v) => setUi({ reduceMotion: v })} label="Reduce motion" />
        <Switch checked={local.graphicsSection} onChange={(v) => setLocal({ graphicsSection: v })} label="Show a Graphics section in the rota" hint="For departments that roster a Graphics band" />
      </Section>

      <Section id="security" title="Security" icon={<ShieldCheck />}>
        <Switch
          checked={pinOn}
          onChange={(v) => setPinDialog(v ? 'set' : 'remove')}
          label="Require a PIN to open the Hub on this device"
          hint={pinOn ? 'On — the Hub locks after inactivity and asks for the PIN.' : 'Off — the Hub opens directly. Turn on for shared or studio computers.'}
        />
        {pinOn && (
          <Field label="Auto-lock after inactivity" htmlFor="al">
            <select id="al" className="select" style={{ maxWidth: 260 }} value={local.lockMinutes} onChange={(e) => setLocal({ lockMinutes: Number(e.target.value) })}>
              {[2, 5, 10, 15, 30, 60, 240].map((m) => <option key={m} value={m}>{m < 60 ? `${m} minutes` : `${m / 60} hour${m > 60 ? 's' : ''}`}</option>)}
            </select>
          </Field>
        )}
        {perms.viewBlacklist && (
          <>
            <Switch checked={local.hideBlacklist} onChange={(v) => { setLocal({ hideBlacklist: v }); useHub.getState().audit('blacklist.hidden', v ? 'on' : 'off') }} label="Hidden blacklist mode" hint="Removes the blacklist from navigation, Home and search on this device" />
            {pinOn && <Switch checked={local.blacklistReauth} onChange={(v) => setLocal({ blacklistReauth: v })} label="Ask for my PIN before opening the blacklist" />}
          </>
        )}
        <div className="row-wrap">
          {pinOn && <button className="btn" onClick={() => setPinDialog('change')}><KeyRound /> Change PIN</button>}
          {pinOn && <button className="btn" onClick={lock}><Lock /> Lock now</button>}
          <button className="btn btn-ghost" style={{ color: 'var(--alert)' }} onClick={async () => {
            if (await confirmDialog({ title: 'Reset this device?', body: 'Erases all Hub data on this device, including unpublished changes and the audit log. Export a backup first if needed. The access code is needed to set it up again.', confirm: 'Erase device', danger: true, typeToConfirm: 'ERASE' })) {
              await wipeDevice()
              location.reload()
            }
          }}><RotateCcw /> Reset device</button>
        </div>
        <p className="tiny faint">Data on this device is encrypted with AES-256-GCM. Without a PIN the key stays on this device (it cannot be exported by web pages), so anyone using this computer or phone can open the Hub — including the blacklist for editor, manager and admin codes. With a PIN, the key is sealed by the PIN. Documents arrive from the published pack already encrypted; guests never receive the blacklist key.</p>
        {pinDialog && <PinDialog action={pinDialog} onClose={() => setPinDialog(undefined)} />}
      </Section>

      <p className="tiny faint" style={{ textAlign: 'center' }}>Editing &amp; Editorial Hub · v{__APP_VERSION__} · built {__BUILD_DATE__}</p>
    </div>
  )
}
