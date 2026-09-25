/**
 * Deploy the site to the gh-pages branch (GitHub Pages → "Deploy from a branch": gh-pages / root).
 *
 *   npm run deploy
 *
 * Builds the app (which copies the encrypted public/pack into dist), then commits dist to gh-pages
 * through a temporary worktree so unchanged pack files are never uploaded twice.
 */
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.join(ROOT, 'dist')
const WT = path.join(ROOT, '.deploy')
const BRANCH = 'gh-pages'

const git = (args: string[], cwd = ROOT) => execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'inherit'] }).toString().trim()
const log = (...a: unknown[]) => console.log('•', ...a)

function main() {
  if (!existsSync(path.join(ROOT, 'public', 'pack', 'manifest.json'))) throw new Error('No pack in public/pack — run `npm run pack` first')
  log('Verifying the pack …')
  execFileSync('npx', ['tsx', 'scripts/pack/verify-pack.ts'], { cwd: ROOT, stdio: 'inherit', shell: true })
  log('Building …')
  execFileSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit', shell: true })
  writeFileSync(path.join(DIST, '.nojekyll'), '')
  // never let line-ending conversion touch the encrypted pack files
  writeFileSync(path.join(DIST, '.gitattributes'), '* -text\n')

  if (existsSync(WT)) {
    try {
      git(['worktree', 'remove', '--force', WT])
    } catch {
      rmSync(WT, { recursive: true, force: true })
    }
  }
  let hasRemote = false
  try {
    git(['fetch', 'origin', BRANCH])
    hasRemote = true
  } catch {
    log(`No ${BRANCH} branch on origin yet — creating it`)
  }
  if (hasRemote) git(['worktree', 'add', '-B', BRANCH, WT, `origin/${BRANCH}`])
  else {
    git(['worktree', 'add', '--detach', WT])
    git(['checkout', '--orphan', BRANCH], WT)
    git(['rm', '-rf', '--quiet', '.'], WT)
  }

  // Administrators publish data straight from the app. Never replace a newer live pack with an older local one:
  // deploy the app and keep the live data (run `npm run pack` first to merge it into the local pack).
  const versionOf = (dir: string) => {
    const f = path.join(dir, 'pack', 'manifest.json')
    return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as { version: number }).version : 0
  }
  const live = versionOf(WT)
  const local = versionOf(DIST)
  const keepLivePack = live > local
  if (keepLivePack) log(`The live data (v${live}) is newer than the local pack (v${local}) — deploying the app only and keeping the live data. Run \`npm run pack\` to merge it locally.`)

  for (const f of readdirSync(WT)) if (f !== '.git' && !(keepLivePack && f === 'pack')) rmSync(path.join(WT, f), { recursive: true, force: true })
  for (const f of readdirSync(DIST)) if (!(keepLivePack && f === 'pack')) cpSync(path.join(DIST, f), path.join(WT, f), { recursive: true })
  git(['add', '-A'], WT)
  const changed = git(['status', '--porcelain'], WT)
  if (!changed) {
    log('Nothing changed — the live site is already up to date')
  } else {
    const manifest = JSON.parse(readFileSync(path.join(keepLivePack ? WT : DIST, 'pack', 'manifest.json'), 'utf8'))
    const commit = git(['rev-parse', '--short', 'HEAD'])
    git(['commit', '-q', '-m', `Deploy app ${commit} with data version ${manifest.version}`], WT)
    log('Pushing to GitHub …')
    execFileSync('git', ['push', 'origin', BRANCH], { cwd: WT, stdio: 'inherit' })
    log('Deployed. GitHub Pages publishes it within a minute or two.')
  }
  git(['worktree', 'remove', '--force', WT])
}

main()
