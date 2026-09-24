/**
 * Setup links: https://…/ee-hub/#setup=XXXX-XXXX-XXXX-XXXX
 * The code lives in the URL fragment, which browsers never send to the server. It is read once at
 * start-up and removed from the address bar before the router sees it.
 */
let pending: string | null = null

/** Pulls the code out of a setup link (or returns null when the text isn't one). */
export function codeFromSetupLink(text: string): string | null {
  const m = text.match(/[#/]setup=([A-Za-z0-9%-]+)/)
  return m ? decodeURIComponent(m[1]) : null
}

export function readSetupCodeFromUrl(): void {
  const m = location.hash.match(/^#\/?setup=([A-Za-z0-9%-]+)/)
  if (!m) return
  pending = decodeURIComponent(m[1])
  history.replaceState(null, '', location.pathname + location.search)
}

/** Returns the code once (later calls return null). */
export function claimSetupCode(): string | null {
  const c = pending
  pending = null
  return c
}

/**
 * iPhone/iPad: put the link back in the address bar while the user adds the Hub to the Home Screen, so an
 * icon made from this page can set itself up. Removed again as soon as the device is set up here instead.
 */
export function showSetupLinkInUrl(code: string): void {
  history.replaceState(null, '', `${location.pathname}${location.search}#setup=${encodeURIComponent(code)}`)
}

export function clearSetupLinkFromUrl(): void {
  if (/setup=/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search)
}
