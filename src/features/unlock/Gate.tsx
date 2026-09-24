import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ArrowLeft, ClipboardPaste, KeyRound, MonitorSmartphone, ShieldCheck, WifiOff, RotateCcw, UserRound } from 'lucide-react'
import { useHub } from '../../data/store'
import { restoreIndex, syncPack } from '../../data/sync'
import { fetchManifest, unlockSlot } from '../../lib/pack'
import type { SlotPayload } from '../../lib/packFormat'
import { createVault, LockedOut, readVault, recoverWithCode, setPin, unlockWithPin, wipeDevice, type PinMode, type VaultRecord } from '../../lib/vault'
import { ROLE_LABEL } from '../../lib/packFormat'
import { PinEntry } from './PinPad'
import { Notice, SearchInput, Avatar } from '../../ui/primitives'
import { MbcLogo } from '../../ui/MbcLogo'
import { confirmDialog } from '../../ui/toast'
import { fold } from '../../lib/text'
import { claimSetupCode, clearSetupLinkFromUrl, codeFromSetupLink, showSetupLinkInUrl } from '../../lib/setupLink'
import { deviceNoun, useInstall } from '../../lib/install'
import { CodeBox, InstallDialog, InstallSteps } from '../install/Install'

function GateFrame({ title, subtitle, children, step, foot }: { title: string; subtitle?: ReactNode; children: ReactNode; step?: [number, number]; foot?: ReactNode }) {
  return (
    <main className="gate">
      <div className="gate-card">
        <div className="gate-brand">
          <MbcLogo className="gate-logo" />
          <div>
            <h1>{title}</h1>
            {subtitle && <p style={{ marginTop: 6 }}>{subtitle}</p>}
          </div>
          {step && (
            <div className="steps" aria-label={`Step ${step[0]} of ${step[1]}`}>
              {Array.from({ length: step[1] }, (_, i) => <span key={i} className={i < step[0] ? 'on' : ''} />)}
            </div>
          )}
        </div>
        <div className="card">{children}</div>
        <p className="gate-foot">{foot ?? 'One department. One rota. One trusted source.'}</p>
      </div>
    </main>
  )
}

/** A typed code, or the code inside a pasted setup link. */
const asCode = (text: string) => (codeFromSetupLink(text) ?? text.trim()).toUpperCase()

function AccessCodeForm({ onDone, submitLabel = 'Continue', check }: { onDone: (code: string, slot: SlotPayload) => void; submitLabel?: string; check?: (code: string) => Promise<SlotPayload | null> }) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ReactNode>()
  const canPaste = typeof navigator.clipboard?.readText === 'function'
  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text.trim()) setCode(asCode(text))
    } catch {
      /* the user declined clipboard access */
    }
  }
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(undefined)
    try {
      let slot: SlotPayload | null
      if (check) slot = await check(code)
      else {
        const res = await fetchManifest()
        if (!res) {
          setError(<><strong>Can’t reach the Hub.</strong> Connect to the internet once to download the department data — after that it works offline.</>)
          return
        }
        slot = await unlockSlot(res.manifest, code)
      }
      if (!slot) setError('That access code isn’t recognised. Check it with your department administrator.')
      else onDone(code, slot)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className="col" style={{ gap: 14 }} onSubmit={submit}>
      <div className="field">
        <label htmlFor="code">Department access code</label>
        <div className="row" style={{ gap: 8 }}>
          <input
            id="code"
            className="input mono grow code-input"
            value={code}
            onChange={(e) => setCode(asCode(e.target.value))}
            placeholder="XXXX-XXXX-XXXX-XXXX"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            autoFocus
            style={{ minHeight: 48, minWidth: 0 }}
            aria-invalid={!!error}
          />
          {canPaste && (
            <button type="button" className="btn paste-btn" style={{ minHeight: 48 }} onClick={paste} aria-label="Paste" title="Paste">
              <ClipboardPaste /> <span className="paste-label">Paste</span>
            </button>
          )}
        </div>
        <span className="hint">Type the code or paste your setup link. Your administrator gives each role its own code — it decides what you can see.</span>
      </div>
      {error && <Notice tone="alert">{error}</Notice>}
      <button className="btn btn-primary btn-lg" disabled={busy || code.replace(/[^A-Z0-9]/gi, '').length < 8}>
        {busy ? <><span className="spinner" /> Checking…</> : <><KeyRound /> {submitLabel}</>}
      </button>
    </form>
  )
}

export function CreatePin({ onDone, busy }: { onDone: (pin: string, mode: PinMode) => void; busy?: boolean }) {
  const [mode, setMode] = useState<PinMode>('pin6')
  const [first, setFirst] = useState<string>()
  const [mismatch, setMismatch] = useState(false)
  const [nonce, setNonce] = useState(0)
  const submit = (pin: string) => {
    if (!first) {
      setFirst(pin)
      setMismatch(false)
      setNonce((n) => n + 1)
    } else if (pin === first) onDone(pin, mode)
    else {
      setMismatch(true)
      setFirst(undefined)
      setNonce((n) => n + 1)
    }
  }
  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="col" style={{ gap: 4, textAlign: 'center' }}>
        <strong>{first ? 'Confirm your ' : 'Create a '}{mode === 'pin6' ? '6-digit PIN' : 'passcode'}</strong>
        <span className="small muted">You’ll use it to unlock the Hub on this device. It never leaves the device.</span>
      </div>
      {mismatch && <Notice tone="warn">Those didn’t match — try again.</Notice>}
      <PinEntry key={`${mode}-${nonce}`} mode={mode} onSubmit={submit} busy={busy} label={first ? 'Confirm PIN' : 'New PIN'} />
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() => {
          setMode(mode === 'pin6' ? 'passcode' : 'pin6')
          setFirst(undefined)
          setNonce((n) => n + 1)
        }}
      >
        {mode === 'pin6' ? 'Use a longer passcode instead (8+ characters)' : 'Use a 6-digit PIN instead'}
      </button>
    </div>
  )
}

export function IdentityPicker({ onDone, onSkip }: { onDone: (staffId: string | undefined, name: string) => void; onSkip?: () => void }) {
  const staff = useHub((s) => s.data.staff)
  const sections = useHub((s) => s.data.sections)
  const [q, setQ] = useState('')
  const [custom, setCustom] = useState('')
  const list = useMemo(
    () => staff.filter((s) => !s.deleted && s.active && fold(s.name).includes(fold(q))).sort((a, b) => a.name.localeCompare(b.name)),
    [staff, q],
  )
  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="col" style={{ gap: 4, textAlign: 'center' }}>
        <strong>Who are you?</strong>
        <span className="small muted">Pick your name so “My schedule” and today’s shift show your rota. You can change this later in Settings.</span>
      </div>
      <SearchInput value={q} onChange={setQ} placeholder="Search your name" autoFocus />
      <div className="col" style={{ gap: 4, maxHeight: 280, overflow: 'auto', margin: '0 -6px', padding: '0 6px' }} role="list">
        {list.map((s) => (
          <button key={s.id} type="button" className="btn btn-ghost" style={{ justifyContent: 'flex-start', height: 48, color: 'var(--text)' }} onClick={() => onDone(s.id, s.name)} role="listitem">
            <Avatar name={s.name} size="sm" tone={sections.find((x) => x.id === s.section)?.tone ?? 'accent'} />
            <span className="grow" style={{ textAlign: 'left' }}>{s.name}</span>
            <span className="tiny faint">{sections.find((x) => x.id === s.section)?.name}</span>
          </button>
        ))}
        {list.length === 0 && <p className="small muted" style={{ padding: 8 }}>No match on the rota.</p>}
      </div>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault()
          if (custom.trim()) onDone(undefined, custom.trim())
        }}
      >
        <input className="input" placeholder="Not on the rota? Type your name" value={custom} onChange={(e) => setCustom(e.target.value)} aria-label="Your name" />
        <button className="btn" disabled={!custom.trim()}>Use</button>
      </form>
      {onSkip && <button type="button" className="btn btn-ghost btn-sm" onClick={onSkip}>Skip for now</button>}
    </div>
  )
}

/**
 * First run on a device: access code → download → who are you. No PIN unless turned on later in Settings.
 * On iPhone/iPad a setup link first asks the user to add the Hub to the Home Screen: that app keeps its own
 * storage, separate from Safari, so a device set up in a Safari tab would not carry over to the icon.
 */
export function Welcome() {
  const [step, setStep] = useState<'code' | 'checking' | 'install' | 'loading' | 'who'>('code')
  const [error, setError] = useState<string>()
  const [role, setRole] = useState<string>()
  const [link, setLink] = useState<{ code: string; slot: SlotPayload }>()
  const [guide, setGuide] = useState(false)
  const inst = useInstall()
  const iosTab = inst.platform === 'ios' && !inst.standalone
  const startSession = useHub((s) => s.startSession)
  const setPhase = useHub((s) => s.setPhase)
  const setLocal = useHub((s) => s.setLocal)
  const audit = useHub((s) => s.audit)

  // Opened from a setup link: set the device up without typing the code
  useEffect(() => {
    const code = claimSetupCode()
    if (!code) return
    setStep('checking')
    void (async () => {
      const res = await fetchManifest()
      const slot = res ? await unlockSlot(res.manifest, code) : null
      if (!slot) {
        setError(res ? 'This setup link is not valid any more. Ask your administrator for a new link or access code.' : 'Can’t reach the Hub. Connect to the internet once to set up this device.')
        setStep('code')
      } else if (iosTab) {
        setLink({ code, slot })
        showSetupLinkInUrl(code)
        setStep('install')
      } else await createAndLoad(code, slot)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const createAndLoad = async (code: string, slot: SlotPayload) => {
    clearSetupLinkFromUrl()
    setRole(ROLE_LABEL[slot.role])
    setStep('loading')
    setError(undefined)
    try {
      const res = await fetchManifest({ preferCache: true })
      if (!res) throw new Error('Pack manifest missing')
      const unlocked = await createVault({ code, codeSalt: res.manifest.kdf.salt, codeIterations: res.manifest.kdf.iterations, slot })
      await startSession(unlocked.payload, unlocked.dek)
      useHub.setState({ pinOn: false })
      const r = await syncPack({ force: true })
      if (r.status === 'error') throw new Error(r.message)
      audit('device.setup', ROLE_LABEL[slot.role])
      try {
        await navigator.storage?.persist?.()
      } catch {
        /* optional */
      }
      setStep('who')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStep('code')
    }
  }

  const installFoot = inst.standalone ? undefined : (
    <button className="btn btn-ghost btn-sm" onClick={() => setGuide(true)}><MonitorSmartphone /> Install the Hub as an app</button>
  )
  const dialog = <InstallDialog open={guide} onClose={() => setGuide(false)} />

  if (step === 'code') {
    return (
      <GateFrame title="Editing & Editorial Hub" subtitle="Rota, work manual, contacts and blacklist — in one secure, offline hub." step={[1, 2]} foot={installFoot}>
        {error && <div style={{ marginBottom: 14 }}><Notice tone="alert">{error}</Notice></div>}
        {iosTab && (
          <div style={{ marginBottom: 14 }}>
            <Notice action={<button className="btn btn-sm" onClick={() => setGuide(true)}>How</button>}>
              On {deviceNoun(inst.platform)}, add the Hub to your Home Screen first and enter the code there — the Home Screen app keeps its own data.
            </Notice>
          </div>
        )}
        <AccessCodeForm onDone={(c, s) => void createAndLoad(c, s)} />
        {dialog}
      </GateFrame>
    )
  }
  if (step === 'checking') {
    return (
      <GateFrame title="Editing & Editorial Hub" step={[1, 2]}>
        <div className="col" style={{ alignItems: 'center', gap: 14, padding: '18px 0' }}>
          <span className="spinner lg" />
          <strong>Checking your setup link…</strong>
        </div>
      </GateFrame>
    )
  }
  if (step === 'install' && link) {
    const here = inst.browser === 'safari' ? 'Safari' : 'this browser'
    return (
      <GateFrame
        title="Add the Hub to your Home Screen"
        subtitle={<>Your link works. On {deviceNoun(inst.platform)} the Hub runs best from the Home Screen — its own icon, full screen and offline.</>}
        step={[1, 2]}
        foot={<button className="btn btn-ghost btn-sm" onClick={() => void createAndLoad(link.code, link.slot)}>Set up in {here} instead</button>}
      >
        <div className="col" style={{ gap: 20 }}>
          <InstallSteps tab="ios" browser={inst.browser} />
          <div className="col" style={{ gap: 8 }}>
            <strong className="small">If the app asks for a code, enter this one</strong>
            <CodeBox code={link.code} />
            <span className="small muted">Tap Copy now, then paste it in the app. If the app opens already set up, there’s nothing to enter.</span>
          </div>
          <p className="tiny faint">Opened this link inside Teams, Outlook or WhatsApp? Open it in Safari first.</p>
        </div>
      </GateFrame>
    )
  }
  if (step === 'loading') {
    return (
      <GateFrame title={`Welcome — ${role ?? ''}`} step={[1, 2]}>
        <div className="col" style={{ alignItems: 'center', gap: 14, padding: '18px 0' }}>
          <span className="spinner lg" />
          <strong>Downloading department data…</strong>
          <span className="small muted">This happens once. Afterwards the Hub opens directly and works without internet.</span>
        </div>
      </GateFrame>
    )
  }
  return (
    <GateFrame title="Almost there" step={[2, 2]}>
      <IdentityPicker
        onDone={(staffId, name) => {
          setLocal({ staffId, userName: name })
          setPhase('ready')
        }}
        onSkip={() => setPhase('ready')}
      />
    </GateFrame>
  )
}

/** Returning user. */
export function LockScreen() {
  const [vault, setVault] = useState<VaultRecord>()
  const [mode, setMode] = useState<'pin' | 'recover' | 'newpin'>('pin')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const [msg, setMsg] = useState<string>()
  const [lockedUntil, setLockedUntil] = useState<number>()
  const [recovered, setRecovered] = useState<{ code: string; payload: Awaited<ReturnType<typeof recoverWithCode>> }>()
  const [now, setNow] = useState(Date.now())
  const startSession = useHub((s) => s.startSession)
  const setPhase = useHub((s) => s.setPhase)

  useEffect(() => {
    void readVault().then((v) => {
      setVault(v)
      if (v?.lockedUntil && v.lockedUntil > Date.now()) setLockedUntil(v.lockedUntil)
    })
  }, [])
  useEffect(() => {
    if (!lockedUntil) return
    const t = setInterval(() => {
      setNow(Date.now())
      if (Date.now() > lockedUntil) setLockedUntil(undefined)
    }, 1000)
    return () => clearInterval(t)
  }, [lockedUntil])

  const enter = async (payload: NonNullable<Awaited<ReturnType<typeof recoverWithCode>>>, dek: CryptoKey) => {
    await startSession(payload, dek)
    useHub.setState({ pinOn: true })
    await restoreIndex()
    useHub.getState().audit('unlock')
    setPhase('ready')
    void syncPack()
  }

  const tryPin = async (pin: string) => {
    setBusy(true)
    setError(false)
    setMsg(undefined)
    try {
      const res = await unlockWithPin(pin)
      if (!res) {
        const v = await readVault()
        setVault(v)
        setError(true)
        const left = 5 - (v?.failed ?? 0)
        setMsg(left > 0 ? `Wrong PIN. ${left} attempt${left === 1 ? '' : 's'} before a timed lock.` : 'Wrong PIN.')
        return
      }
      await enter(res.payload, res.dek)
    } catch (e) {
      if (e instanceof LockedOut) {
        setLockedUntil(e.until)
        setError(true)
      } else setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const reset = async () => {
    const ok = await confirmDialog({
      title: 'Reset this device?',
      body: 'All Hub data stored on this device — including changes that have not been exported or published — will be erased. You will need an access code to set it up again.',
      confirm: 'Erase this device',
      danger: true,
      typeToConfirm: 'ERASE',
    })
    if (!ok) return
    await wipeDevice()
    location.reload()
  }

  if (!vault) return <GateFrame title="Editing & Editorial Hub"><div className="row" style={{ justifyContent: 'center' }}><span className="spinner" /></div></GateFrame>

  if (mode === 'recover') {
    return (
      <GateFrame title="Forgot your PIN?" subtitle="Enter your department access code to set a new PIN. Your data on this device is kept.">
        <AccessCodeForm
          submitLabel="Verify code"
          check={async (code) => {
            const payload = await recoverWithCode(code)
            if (payload) setRecovered({ code, payload })
            return payload?.slot ?? null
          }}
          onDone={() => setMode('newpin')}
        />
        <button className="btn btn-ghost btn-sm btn-block" style={{ marginTop: 10 }} onClick={() => setMode('pin')}><ArrowLeft /> Back</button>
      </GateFrame>
    )
  }
  if (mode === 'newpin' && recovered?.payload) {
    return (
      <GateFrame title="Set a new PIN">
        <CreatePin
          busy={busy}
          onDone={async (pin, pm) => {
            setBusy(true)
            await setPin(recovered.payload!, pin, pm)
            const res = await unlockWithPin(pin)
            if (res) await enter(res.payload, res.dek)
            setBusy(false)
          }}
        />
      </GateFrame>
    )
  }

  const secs = lockedUntil ? Math.max(0, Math.ceil((lockedUntil - now) / 1000)) : 0
  return (
    <GateFrame
      title="Hub locked"
      subtitle={<span className="row" style={{ justifyContent: 'center' }}><ShieldCheck width={16} /> {ROLE_LABEL[vault.role]} · encrypted on this device</span>}
      foot={
        <span className="row" style={{ justifyContent: 'center', gap: 14 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setMode('recover')}><UserRound /> Forgot PIN</button>
          <button className="btn btn-ghost btn-sm" onClick={reset}><RotateCcw /> Reset device</button>
        </span>
      }
    >
      <div className="col" style={{ gap: 16 }}>
        {lockedUntil ? (
          <Notice tone="alert" icon={<WifiOff />}>Too many wrong attempts. Try again in {secs >= 60 ? `${Math.ceil(secs / 60)} min` : `${secs} s`}, or use “Forgot PIN”.</Notice>
        ) : (
          <>
            <p className="small muted" style={{ textAlign: 'center' }}>{vault.pinMode === 'pin6' ? 'Enter your 6-digit PIN' : 'Enter your passcode'}</p>
            <PinEntry mode={vault.pinMode ?? 'pin6'} onSubmit={tryPin} busy={busy} error={error} label="PIN" />
          </>
        )}
        {msg && !lockedUntil && <p className="small" style={{ color: 'var(--alert)', textAlign: 'center' }} role="alert">{msg}</p>}
      </div>
    </GateFrame>
  )
}
