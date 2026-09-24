/**
 * "Install the Hub" support.
 *
 * Chrome, Edge and Samsung Internet fire `beforeinstallprompt`; we keep that event so our own button can open
 * the browser's install dialog. Safari (iPhone, iPad, Mac) and Firefox have no such event, so those users get
 * step-by-step instructions instead. Listening starts in main.tsx, before React renders, because the event
 * fires early and only once per page load.
 */
import { useSyncExternalStore } from 'react'

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export type Platform = 'ios' | 'android' | 'mac' | 'windows' | 'other'
export type Browser = 'safari' | 'chrome' | 'edge' | 'firefox' | 'samsung' | 'inapp' | 'other'

export interface InstallState {
  platform: Platform
  browser: Browser
  /** Running as an installed app (own window / home-screen icon) rather than a browser tab. */
  standalone: boolean
  /** The browser offered a one-tap install (Chrome, Edge, Samsung Internet). */
  canPrompt: boolean
  /** Installed during this visit. */
  justInstalled: boolean
}

let deferred: BeforeInstallPromptEvent | null = null
let justInstalled = false
const listeners = new Set<() => void>()

export function detectPlatform(ua = navigator.userAgent, touchPoints = navigator.maxTouchPoints ?? 0): { platform: Platform; browser: Browser } {
  // iPadOS reports itself as a Mac; a Mac has no touch screen
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1)
  const platform: Platform = ios ? 'ios' : /Android/.test(ua) ? 'android' : /Macintosh|Mac OS X/.test(ua) ? 'mac' : /Windows/.test(ua) ? 'windows' : 'other'
  // Browsers built into other apps (Facebook, Instagram, LinkedIn, Google app, Android web views) cannot install
  const inapp = /FBAN|FBAV|Instagram|LinkedInApp|Line\/|Snapchat|MicroMessenger|GSA\//.test(ua) || (platform === 'android' && /; wv\)/.test(ua))
  const browser: Browser = inapp
    ? 'inapp'
    : /EdgiOS|EdgA\/|Edg\//.test(ua)
      ? 'edge'
      : /SamsungBrowser/.test(ua)
        ? 'samsung'
        : /FxiOS|Firefox\//.test(ua)
          ? 'firefox'
          : /CriOS|Chrome\/|Chromium\//.test(ua)
            ? 'chrome'
            : /Safari\//.test(ua)
              ? 'safari'
              : 'other'
  return { platform, browser }
}

/** "iPhone", "iPad", "phone" or "computer" — for messages such as "Install the Hub on this iPhone". */
export function deviceNoun(platform: Platform): string {
  if (platform === 'ios') return /iPad|Macintosh/.test(navigator.userAgent) ? 'iPad' : 'iPhone'
  return platform === 'android' ? 'phone' : 'computer'
}

function isStandalone(): boolean {
  const modes = ['standalone', 'fullscreen', 'minimal-ui', 'window-controls-overlay']
  return modes.some((m) => window.matchMedia?.(`(display-mode: ${m})`).matches) || (navigator as Navigator & { standalone?: boolean }).standalone === true
}

function compute(): InstallState {
  return { ...detectPlatform(), standalone: isStandalone(), canPrompt: !!deferred, justInstalled }
}

let snapshot: InstallState | null = null
function emit() {
  snapshot = compute()
  listeners.forEach((l) => l())
}

let listening = false
export function listenForInstall(): void {
  if (listening) return
  listening = true
  window.addEventListener('beforeinstallprompt', (e) => {
    // keep the browser's own mini-banner quiet; the Hub shows its own install button
    e.preventDefault()
    deferred = e as BeforeInstallPromptEvent
    emit()
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    justInstalled = true
    emit()
  })
  window.matchMedia?.('(display-mode: standalone)').addEventListener?.('change', emit)
}

export function useInstall(): InstallState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => (snapshot ??= compute()),
  )
}

/** Opens the browser's install dialog. Only works while `canPrompt` is true and from a click. */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const e = deferred
  if (!e) return 'unavailable'
  await e.prompt()
  const { outcome } = await e.userChoice
  // the event can be used once; Chrome fires a fresh one later if the user said no
  deferred = null
  emit()
  return outcome
}
