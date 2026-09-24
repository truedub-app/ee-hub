import { useEffect, useState, type ReactNode } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import {
  BookOpen, CalendarDays, Contact, Database, Download, Ellipsis, FileSpreadsheet, House, Lock, MonitorSmartphone, PanelLeftClose, PanelLeftOpen,
  Search, Settings, ShieldAlert, Upload,
} from 'lucide-react'
import { canSeeBlacklist, useHub, usePerms } from '../../data/store'
import { relativeDateTime } from '../../lib/dates'
import { cx } from '../../ui/primitives'
import { MbcLogo } from '../../ui/MbcLogo'
import { SearchPalette, useSearchPalette } from '../search/SearchPalette'
import { useNotices } from '../home/notices'
import { useInstall } from '../../lib/install'

export function StatusPill({ compact }: { compact?: boolean }) {
  const net = useHub((s) => s.net)
  const version = useHub((s) => s.local.packVersion)
  const lastDataAt = useHub((s) => s.local.lastDataAt)
  const navigate = useNavigate()
  const led = net.checking ? 'busy' : net.online ? '' : 'off'
  const title = `${net.online ? 'Online — local data in use' : 'Offline mode — local data'}${lastDataAt ? ` · Last updated ${relativeDateTime(lastDataAt)}` : ''}${version ? ` · Data version ${version}` : ''}`
  return (
    <button className="status-pill" title={title} aria-label={title} onClick={() => navigate('/settings#status')}>
      <span className={cx('led', led)} aria-hidden />
      {compact ? (net.online ? 'Local' : 'Offline') : <>{net.online ? 'Local data' : 'Offline mode'}{version ? <span className="faint">· v{version}</span> : null}</>}
    </button>
  )
}

const TITLES: [RegExp, string][] = [
  [/^\/$/, 'Home'],
  [/^\/rota\/import/, 'Import ROTA'],
  [/^\/rota/, 'Shift ROTA'],
  [/^\/manual\/.+/, 'Work Manual'],
  [/^\/manual/, 'Work Manual'],
  [/^\/contacts/, 'Contacts'],
  [/^\/blacklist/, 'Blacklist'],
  [/^\/admin/, 'Data Management'],
  [/^\/settings/, 'Settings'],
  [/^\/more/, 'More'],
]

function NavItem({ to, icon, label, end, badge, danger }: { to: string; icon: ReactNode; label: string; end?: boolean; badge?: ReactNode; danger?: boolean }) {
  return (
    <NavLink to={to} end={end} className={({ isActive }) => cx('nav-item', isActive && 'active', danger && 'danger')} title={label}>
      {icon}
      <span>{label}</span>
      {badge && <span className="nav-badge">{badge}</span>}
    </NavLink>
  )
}

export function Shell({ children }: { children: ReactNode }) {
  const perms = usePerms()
  const ui = useHub((s) => s.ui)
  const setUi = useHub((s) => s.setUi)
  const lock = useHub((s) => s.lock)
  const lockMinutes = useHub((s) => s.local.lockMinutes)
  const pinOn = useHub((s) => s.pinOn)
  const showBlacklist = useHub(() => canSeeBlacklist())
  const loc = useLocation()
  const palette = useSearchPalette()
  const notices = useNotices()
  const rotaIssues = notices.filter((n) => n.area === 'rota' && n.tone !== 'info').length
  const title = TITLES.find(([rx]) => rx.test(loc.pathname))?.[1] ?? 'Editing & Editorial Hub'

  useEffect(() => {
    document.title = `${title} · Editing & Editorial Hub`
  }, [title])

  // auto-lock after inactivity
  useEffect(() => {
    if (!lockMinutes || !pinOn) return
    let last = Date.now()
    const bump = () => (last = Date.now())
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart']
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }))
    let hiddenAt = 0
    const vis = () => {
      if (document.hidden) hiddenAt = Date.now()
      else if (hiddenAt && Date.now() - hiddenAt > lockMinutes * 60_000) lock()
    }
    document.addEventListener('visibilitychange', vis)
    const t = setInterval(() => {
      if (Date.now() - last > lockMinutes * 60_000) lock()
    }, 15_000)
    return () => {
      events.forEach((e) => window.removeEventListener(e, bump))
      document.removeEventListener('visibilitychange', vis)
      clearInterval(t)
    }
  }, [lockMinutes, lock, pinOn])

  const moreActive = /^\/(more|admin|settings|blacklist)/.test(loc.pathname)

  return (
    <div className={cx('shell', ui.sidebarCollapsed && 'collapsed')}>
      <a className="skip-link" href="#main">Skip to content</a>
      <aside className="sidebar" aria-label="Main navigation">
        <NavLink to="/" className="brand" aria-label="Editing & Editorial Hub — Home">
          <MbcLogo variant="mark" className="brand-logo" decorative />
          <span className="brand-text">
            <strong>Editing &amp; Editorial Hub</strong>
            <span>Group TV · Editing &amp; Editorial</span>
          </span>
        </NavLink>
        <nav className="nav-group">
          <NavItem to="/" end icon={<House />} label="Home" />
          <NavItem to="/rota" end icon={<CalendarDays />} label="Shift ROTA" badge={rotaIssues ? <span className="badge tone-warn">{rotaIssues}</span> : undefined} />
          <NavItem to="/manual" icon={<BookOpen />} label="Work Manual" />
          <NavItem to="/contacts" icon={<Contact />} label="Contacts" />
          {showBlacklist && <NavItem to="/blacklist" icon={<ShieldAlert />} label="Blacklist" danger />}
        </nav>
        <nav className="nav-group" aria-label="Data management">
          <div className="nav-label">Data Management</div>
          {perms.importRota && <NavItem to="/rota/import" icon={<FileSpreadsheet />} label="Import ROTA" />}
          {perms.editDocs && <NavItem to="/admin/documents" icon={<Upload />} label="Import Documents" />}
          {perms.exportBackup && <NavItem to="/admin/backup" icon={<Download />} label="Export Backup" />}
          {(perms.admin || perms.importRota || perms.viewAudit) && <NavItem to="/admin" end icon={<Database />} label="Data & Integrity" />}
          <NavItem to="/settings" icon={<Settings />} label="Settings" />
        </nav>
        <div className="sidebar-foot">
          <StatusPill />
          <div className="row">
            {pinOn ? <button className="btn btn-ghost btn-sm grow hide-rail" onClick={lock}><Lock /> Lock</button> : <span className="grow" />}
            <button className="icon-btn sm" onClick={() => setUi({ sidebarCollapsed: !ui.sidebarCollapsed })} aria-label={ui.sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={ui.sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
              {ui.sidebarCollapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
            </button>
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <h1>{title}</h1>
          <button className="search-trigger" onClick={palette.open} aria-label="Search everything (Ctrl+K)">
            <Search aria-hidden />
            <span>Search staff, rota, manual, contacts…</span>
            <kbd>Ctrl K</kbd>
          </button>
          <span className="desktop-only"><StatusPill /></span>
          <span className="mobile-only"><StatusPill compact /></span>
          {pinOn && <button className="icon-btn" onClick={lock} aria-label="Lock the Hub" title="Lock"><Lock /></button>}
        </header>
        <main id="main" className="content" tabIndex={-1}>
          {children}
        </main>
      </div>

      <nav className="bottombar" aria-label="Main navigation">
        <NavLink to="/" end className={({ isActive }) => cx(isActive && 'active')}><House /><span>Home</span></NavLink>
        <NavLink to="/rota" className={({ isActive }) => cx(isActive && !loc.pathname.startsWith('/rota/import') && 'active')}>
          <CalendarDays /><span>ROTA</span>{rotaIssues > 0 && <span className="dotbadge" aria-label={`${rotaIssues} rota warnings`} />}
        </NavLink>
        <NavLink to="/manual" className={({ isActive }) => cx(isActive && 'active')}><BookOpen /><span>Manual</span></NavLink>
        <NavLink to="/contacts" className={({ isActive }) => cx(isActive && 'active')}><Contact /><span>Contacts</span></NavLink>
        <NavLink to="/more" className={cx(moreActive && 'active')}><Ellipsis /><span>More</span></NavLink>
      </nav>
      <SearchPalette />
    </div>
  )
}

export function PageHead({ title, sub, actions, eyebrow }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="page-head">
      <div className="titles">
        {eyebrow && <div className="eyebrow" style={{ marginBottom: 6 }}>{eyebrow}</div>}
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  )
}

/** Mobile "More" menu. */
export function MorePage() {
  const perms = usePerms()
  const showBlacklist = useHub(() => canSeeBlacklist())
  const navigate = useNavigate()
  const lock = useHub((s) => s.lock)
  const pinOn = useHub((s) => s.pinOn)
  const installed = useInstall().standalone
  const [items] = useState(() => [
    showBlacklist && { to: '/blacklist', icon: <ShieldAlert />, label: 'Blacklist', sub: 'Restricted names — handle with care', tone: 'alert' },
    perms.importRota && { to: '/rota/import', icon: <FileSpreadsheet />, label: 'Import ROTA', sub: 'Official Excel rota' },
    perms.editDocs && { to: '/admin/documents', icon: <Upload />, label: 'Import Documents', sub: 'PDFs and videos' },
    perms.exportBackup && { to: '/admin/backup', icon: <Download />, label: 'Backup & Restore', sub: 'Encrypted .hub package' },
    (perms.admin || perms.importRota || perms.viewAudit) && { to: '/admin', icon: <Database />, label: 'Data & Integrity', sub: 'Staff, codes, audit, import history' },
    { to: '/settings', icon: <Settings />, label: 'Settings', sub: 'Display, security, offline status' },
    !installed && { to: '/settings#app', icon: <MonitorSmartphone />, label: 'Install the app', sub: 'Home-screen icon, full screen, offline' },
  ].filter(Boolean) as { to: string; icon: ReactNode; label: string; sub: string; tone?: string }[])
  return (
    <div className="col" style={{ gap: 10 }}>
      {items.map((it) => (
        <button key={it.to} className={cx('card stripe row', it.tone && `tone-${it.tone}`)} style={{ padding: '14px 16px', gap: 14, textAlign: 'left', color: 'var(--text)' }} onClick={() => navigate(it.to)}>
          <span style={{ color: it.tone ? 'var(--alert)' : 'var(--accent-2)' }}>{it.icon}</span>
          <span className="col grow" style={{ gap: 2 }}>
            <strong>{it.label}</strong>
            <span className="small muted">{it.sub}</span>
          </span>
        </button>
      ))}
      {pinOn && <button className="btn btn-lg" onClick={lock}><Lock /> Lock the Hub</button>}
    </div>
  )
}
