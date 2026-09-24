/**
 * Setup links: https://…/editing-editorial-hub/#setup=XXXX-XXXX-XXXX-XXXX
 * The code lives in the URL fragment, which browsers never send to the server. It is read once at
 * start-up and removed from the address bar before the router sees it.
 */
let pending: string | null = null

export function readSetupCodeFromUrl(): void {
  const m = location.hash.match(/^#\/?setup=([A-Za-z0-9-]+)/)
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
