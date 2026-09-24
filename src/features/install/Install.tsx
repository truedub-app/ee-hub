import { useState, type ReactNode } from 'react'
import { Check, CircleCheck, Copy, Ellipsis, EllipsisVertical, Menu, MonitorDown, MonitorSmartphone, Share, SquarePlus, X } from 'lucide-react'
import { useHub } from '../../data/store'
import { deviceNoun, promptInstall, useInstall, type Browser, type Platform } from '../../lib/install'
import { Modal, Notice, Segmented } from '../../ui/primitives'
import { toast } from '../../ui/toast'
import './install.css'

type Tab = 'ios' | 'android' | 'computer'

const tabOf = (p: Platform): Tab => (p === 'ios' ? 'ios' : p === 'android' ? 'android' : 'computer')

/** An on-screen control, drawn the way the browser shows it. */
function Key({ icon, children }: { icon?: ReactNode; children?: ReactNode }) {
  return <span className="ui-key">{icon}{children}</span>
}

/** Numbered steps for one platform, adapted to the browser in use. */
export function InstallSteps({ tab, browser }: { tab: Tab; browser: Browser }) {
  if (tab === 'ios') {
    const share = browser === 'chrome' || browser === 'edge' || browser === 'firefox'
      ? <>Tap <Key icon={<Share />}>Share</Key> in the address bar (or <Key icon={<Ellipsis />} /> then <strong>Share</strong>).</>
      : <>Tap <Key icon={<Share />}>Share</Key> in Safari’s toolbar. If you don’t see it, tap <Key icon={<Ellipsis />} /> first.</>
    return (
      <ol className="install-steps">
        <li><span>{share}</span></li>
        <li><span>Scroll down and tap <Key icon={<SquarePlus />}>Add to Home Screen</Key>.</span></li>
        <li><span>Keep <strong>Open as Web App</strong> switched on, then tap <strong>Add</strong>.</span></li>
        <li><span>Open <strong>EE Hub</strong> from your Home Screen.</span></li>
      </ol>
    )
  }
  if (tab === 'android') {
    if (browser === 'samsung') {
      return (
        <ol className="install-steps">
          <li><span>Tap <Key icon={<Menu />} /> at the bottom of the screen.</span></li>
          <li><span>Tap <strong>Add page to</strong>, then <strong>Home screen</strong>.</span></li>
          <li><span>Open <strong>EE Hub</strong> from your home screen.</span></li>
        </ol>
      )
    }
    return (
      <ol className="install-steps">
        <li><span>Tap <Key icon={<EllipsisVertical />} /> at the top right{browser === 'firefox' ? ' (or bottom right)' : ''}.</span></li>
        <li><span>Tap <strong>Install app</strong> — or <strong>Add to Home screen</strong>, then <strong>Install</strong>.</span></li>
        <li><span>Open <strong>EE Hub</strong> from your home screen or app list.</span></li>
      </ol>
    )
  }
  if (browser === 'safari') {
    return (
      <ol className="install-steps">
        <li><span>In the menu bar, choose <strong>File</strong> → <strong>Add to Dock</strong>.</span></li>
        <li><span>Click <strong>Add</strong>. The Hub opens in its own window from the Dock.</span></li>
      </ol>
    )
  }
  if (browser === 'firefox') {
    return <Notice tone="warn">Firefox can’t install web apps on a computer. Open the Hub link in <strong>Chrome</strong> or <strong>Edge</strong> and install it from there.</Notice>
  }
  if (browser === 'edge') {
    return (
      <ol className="install-steps">
        <li><span>Click <Key icon={<MonitorDown />}>App available</Key> at the right end of the address bar — or <Key icon={<Ellipsis />} /> → <strong>Apps</strong> → <strong>Install this site as an app</strong>.</span></li>
        <li><span>Click <strong>Install</strong>. The Hub opens in its own window and is added to the Start menu.</span></li>
      </ol>
    )
  }
  return (
    <ol className="install-steps">
      <li><span>Click <Key icon={<MonitorDown />} /> at the right end of the address bar — or <Key icon={<EllipsisVertical />} /> → <strong>Cast, save and share</strong> → <strong>Install page as app</strong>.</span></li>
      <li><span>Click <strong>Install</strong>. The Hub opens in its own window, with an icon in the Start menu or Dock.</span></li>
    </ol>
  )
}

/** The browser to describe on a tab: the real one when it matches this device, otherwise the usual one. */
function browserFor(tab: Tab, platform: Platform, browser: Browser): Browser {
  if (tab === tabOf(platform)) return browser
  return tab === 'ios' ? 'safari' : 'chrome'
}

async function oneTapInstall(): Promise<boolean> {
  const r = await promptInstall()
  if (r === 'accepted') toast('Installing the Hub — it will appear with your other apps')
  return r !== 'unavailable'
}

export function InstallGuide({ onInstalled }: { onInstalled?: () => void }) {
  const st = useInstall()
  const [tab, setTab] = useState<Tab>(tabOf(st.platform))
  const browser = browserFor(tab, st.platform, st.browser)
  const here = tab === tabOf(st.platform)

  if (st.standalone) {
    return <Notice tone="qc2" icon={<CircleCheck />}>You’re already using the installed Hub on this device.</Notice>
  }
  return (
    <div className="col" style={{ gap: 16 }}>
      <p className="small muted">Installed, the Hub gets its own icon, opens full screen without the address bar and works offline — just like an app from the store. Updates arrive automatically.</p>
      {here && st.canPrompt && (
        <div className="col" style={{ gap: 8 }}>
          <button className="btn btn-primary btn-lg" onClick={async () => { if (await oneTapInstall()) onInstalled?.() }}>
            <MonitorDown /> Install the Hub
          </button>
          <span className="tiny faint" style={{ textAlign: 'center' }}>Your browser asks you to confirm. Or follow the steps below.</span>
        </div>
      )}
      {here && st.browser === 'inapp' && (
        <Notice tone="warn">
          This page is open inside another app, which can’t install it. Open it in {st.platform === 'ios' ? <strong>Safari</strong> : <strong>Chrome</strong>} first — look for <strong>Open in {st.platform === 'ios' ? 'Safari' : 'Chrome'}</strong> or <strong>Open in browser</strong> in that app’s menu.
        </Notice>
      )}
      <Segmented<Tab>
        label="Device"
        value={tab}
        onChange={setTab}
        options={[{ value: 'ios', label: 'iPhone / iPad' }, { value: 'android', label: 'Android' }, { value: 'computer', label: 'Computer' }]}
      />
      <InstallSteps tab={tab} browser={browser} />
      {tab === 'ios' && (
        <Notice>
          The Home Screen app keeps its own data, separate from Safari. The first time it opens it asks for your <strong>department access code</strong> — paste your setup link or the code at its end.
        </Notice>
      )}
      {tab === 'android' && <p className="tiny faint">Opened the link from WhatsApp, Teams or email? Choose <strong>Open in Chrome</strong> from that app’s menu first.</p>}
    </div>
  )
}

export function InstallDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Install the Hub">
      <InstallGuide onInstalled={onClose} />
    </Modal>
  )
}

/** One-tap install where the browser allows it, otherwise the step-by-step guide. */
export function useInstallAction(): { label: string; run: () => void; dialog: ReactNode } {
  const st = useInstall()
  const [open, setOpen] = useState(false)
  return {
    label: st.canPrompt ? 'Install' : 'Show me how',
    run: () => void (st.canPrompt ? oneTapInstall().then((ok) => !ok && setOpen(true)) : setOpen(true)),
    dialog: <InstallDialog open={open} onClose={() => setOpen(false)} />,
  }
}

/** Home screen nudge, shown in the browser until the Hub is installed or the user says "not now". */
export function InstallBanner() {
  const st = useInstall()
  const dismissed = useHub((s) => s.local.dismissed)
  const setLocal = useHub((s) => s.setLocal)
  const action = useInstallAction()
  if (st.standalone || dismissed.includes('install')) return null
  const hide = () => setLocal({ dismissed: [...dismissed, 'install'] })
  if (st.justInstalled) {
    return (
      <div className="install-banner done" role="status">
        <span className="install-icon"><Check /></span>
        <div className="grow col" style={{ gap: 2 }}>
          <strong>The Hub is installed</strong>
          <span className="small muted">Open <strong>EE Hub</strong> from your {st.platform === 'android' || st.platform === 'ios' ? 'home screen' : 'Start menu or Dock'} from now on.</span>
        </div>
        <button className="icon-btn sm" aria-label="Close" onClick={hide}><X /></button>
      </div>
    )
  }
  return (
    <div className="install-banner" role="region" aria-label="Install the Hub">
      <span className="install-icon"><MonitorSmartphone /></span>
      <div className="grow col" style={{ gap: 2 }}>
        <strong>Install the Hub on this {deviceNoun(st.platform)}</strong>
        <span className="small muted">Its own icon, full screen and offline — like a normal app.</span>
      </div>
      <div className="install-actions">
        <button className="btn btn-primary btn-sm" onClick={action.run}>{action.label}</button>
        <button className="btn btn-ghost btn-sm" onClick={hide}>Not now</button>
      </div>
      {action.dialog}
    </div>
  )
}

/** The access code in large type with a copy button (iPhone set-up hand-over). */
export function CodeBox({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="code-box">
      <span className="mono" aria-label="Access code">{code}</span>
      <button
        type="button"
        className="btn btn-sm"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(code)
            setCopied(true)
            setTimeout(() => setCopied(false), 2500)
          } catch {
            toast('Couldn’t copy — write the code down instead', 'warn')
          }
        }}
      >
        {copied ? <><Check /> Copied</> : <><Copy /> Copy</>}
      </button>
    </div>
  )
}
