import { useEffect } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { useHub, loadUiPrefs, flushPersist } from './data/store'
import { pinRequired, readVault, unlockDevice } from './lib/vault'
import { syncPack, clearUrlCache, warmEssentials, restoreIndex } from './data/sync'
import { Welcome, LockScreen } from './features/unlock/Gate'
import { MorePage, Shell } from './features/shell/Shell'
import { HomePage } from './features/home/HomePage'
import { RotaPage } from './features/rota/RotaPage'
import { ImportWizard } from './features/rota/import/ImportWizard'
import { CellEditorHost } from './features/rota/CellEditor'
import { ManualPage } from './features/manual/ManualPage'
import { ContactsPage } from './features/contacts/ContactsPage'
import { BlacklistPage } from './features/blacklist/BlacklistPage'
import { SettingsPage } from './features/settings/SettingsPage'
import { AdminHome } from './features/admin/AdminHome'
import { StaffAdmin } from './features/admin/StaffAdmin'
import { CodesAdmin } from './features/admin/CodesAdmin'
import { AuditLog, ImportHistory } from './features/admin/History'
import { BackupPage } from './features/admin/BackupPage'
import { DocumentsAdmin } from './features/admin/DocumentsAdmin'
import { ConfirmHost, Toaster, toast } from './ui/toast'
import './features/admin/admin.css'

function useTheme() {
  const ui = useHub((s) => s.ui)
  useEffect(() => {
    const r = document.documentElement
    r.dataset.theme = ui.theme
    r.dataset.contrast = ui.contrast
    r.dataset.motion = ui.reduceMotion ? 'reduce' : 'full'
    r.style.setProperty('--text-scale', String(ui.textScale))
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', ui.theme === 'light' ? '#eef1f7' : '#070b16')
  }, [ui])
}

let booted = false

function useBoot() {
  const setPhase = useHub((s) => s.setPhase)
  useEffect(() => {
    // run the start-up sequence once (StrictMode mounts effects twice in development)
    if (!booted) void (async () => {
      const ui = await loadUiPrefs()
      useHub.setState({ ui })
      const v = await readVault()
      if (!v) return setPhase('welcome')
      if (!pinRequired(v)) {
        // No PIN on this device: open straight away with the device key
        const u = await unlockDevice()
        if (u) {
          await useHub.getState().startSession(u.payload, u.dek)
          useHub.setState({ pinOn: false })
          await restoreIndex()
          useHub.getState().audit('open')
          setPhase('ready', v.role)
          void syncPack()
          return
        }
      }
      useHub.setState({ pinOn: true })
      setPhase('locked', v.role)
    })()
    booted = true
    const online = () => {
      useHub.getState().setNet({ online: true })
      if (useHub.getState().session) void syncPack().then((r) => r.status === 'updated' && toast(r.message))
    }
    const offline = () => useHub.getState().setNet({ online: false })
    window.addEventListener('online', online)
    window.addEventListener('offline', offline)
    const save = () => void flushPersist()
    window.addEventListener('pagehide', save)
    return () => {
      window.removeEventListener('online', online)
      window.removeEventListener('offline', offline)
      window.removeEventListener('pagehide', save)
    }
  }, [setPhase])
}

function Ready() {
  useEffect(() => {
    void warmEssentials()
    const check = () => {
      if (navigator.onLine) void syncPack().then((r) => r.status === 'updated' && toast(r.message))
    }
    // periodic update check while the app is open (the manifest is under 1 KB)
    const t = setInterval(check, 5 * 60_000)
    // …and when the Hub comes back to the screen, e.g. a phone app reopened from the background
    const onVisible = () => {
      const last = useHub.getState().net.lastCheck ?? 0
      if (document.visibilityState === 'visible' && Date.now() - last > 60_000) check()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(t)
      document.removeEventListener('visibilitychange', onVisible)
      clearUrlCache()
    }
  }, [])
  return (
    <HashRouter>
      <Shell>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/rota" element={<RotaPage />} />
          <Route path="/rota/import" element={<ImportWizard />} />
          <Route path="/manual" element={<ManualPage />} />
          <Route path="/manual/:docId" element={<ManualPage />} />
          <Route path="/contacts" element={<ContactsPage />} />
          <Route path="/contacts/staff/:staffId" element={<ContactsPage />} />
          <Route path="/blacklist" element={<BlacklistPage />} />
          <Route path="/admin" element={<AdminHome />} />
          <Route path="/admin/staff" element={<StaffAdmin />} />
          <Route path="/admin/codes" element={<CodesAdmin />} />
          <Route path="/admin/imports" element={<ImportHistory />} />
          <Route path="/admin/audit" element={<AuditLog />} />
          <Route path="/admin/backup" element={<BackupPage />} />
          <Route path="/admin/documents" element={<DocumentsAdmin />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/more" element={<MorePage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Shell>
      <CellEditorHost />
    </HashRouter>
  )
}

export default function App() {
  useTheme()
  useBoot()
  const phase = useHub((s) => s.phase)
  return (
    <>
      {phase === 'boot' && (
        <div className="gate"><span className="spinner lg" aria-label="Loading" /></div>
      )}
      {phase === 'welcome' && <Welcome />}
      {phase === 'locked' && <LockScreen />}
      {phase === 'ready' && <Ready />}
      <Toaster />
      <ConfirmHost />
    </>
  )
}
