/**
 * Bring public/pack up to date with the live site (the gh-pages branch).
 *
 * Administrators can publish from the app by uploading files straight into gh-pages/pack on
 * GitHub. Before rebuilding the pack locally, pull that version so the builder merges it and
 * nothing published from the app is lost. Runs automatically as part of `npm run pack`.
 */
import { execFileSync, execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const PACK = path.join(ROOT, 'public', 'pack')
const git = (args: string[]) => execFileSync('git', args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString()

function main() {
  try {
    git(['fetch', 'origin', 'gh-pages'])
  } catch {
    console.log('• No live site to pull from (no gh-pages branch yet) — using the local pack')
    return
  }
  let remote: { version: number }
  try {
    remote = JSON.parse(git(['show', 'origin/gh-pages:pack/manifest.json']))
  } catch {
    console.log('• The live site has no pack yet')
    return
  }
  const localFile = path.join(PACK, 'manifest.json')
  const local = existsSync(localFile) ? (JSON.parse(readFileSync(localFile, 'utf8')) as { version: number }) : { version: 0 }
  if (remote.version <= local.version) {
    console.log(`• Local pack v${local.version} is current (live site: v${remote.version})`)
    return
  }
  mkdirSync(PACK, { recursive: true })
  // extract gh-pages:pack/* into public/pack (tar ships with Git for Windows, macOS and Linux)
  execSync(`git archive --format=tar origin/gh-pages pack | tar -x -C "${path.join(ROOT, 'public')}"`, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' ? 'bash' : '/bin/sh' })
  console.log(`• Pulled live pack v${remote.version} (was v${local.version}) — changes published from the app will be kept`)
}

main()
