/**
 * Verify the built pack before publishing:
 *   - every access code opens exactly its own role
 *   - the guest code cannot decrypt the blacklist; a wrong code opens nothing
 *   - no known plaintext (names, emails, document words) appears anywhere in public/pack
 *
 *   npm run pack:verify
 */
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { deriveKey, fromB64, importKey, normalizeCode, open, openJson, DecryptError } from '../../src/lib/crypto.ts'
import type { PackIndex, PackManifest, SlotPayload, CoreDataFile } from '../../src/lib/packFormat.ts'
import type { Role } from '../../src/data/types.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SOURCE = path.resolve(process.env.HUB_SOURCE ?? path.join(ROOT, '..'))
const CONTENT = path.resolve(process.env.HUB_CONTENT ?? path.join(SOURCE, 'hub-content'))
const OUT = path.join(ROOT, 'public', 'pack')

let failures = 0
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? '✓' : '✗'} ${msg}`)
  if (!cond) failures++
}

async function unlock(manifest: PackManifest, code: string): Promise<SlotPayload | null> {
  const kek = await deriveKey(normalizeCode(code), fromB64(manifest.kdf.salt), manifest.kdf.iterations)
  for (const s of manifest.slots) {
    try {
      return await openJson<SlotPayload>(kek, fromB64(s))
    } catch (e) {
      if (!(e instanceof DecryptError)) throw e
    }
  }
  return null
}

const read = (rel: string) => new Uint8Array(readFileSync(path.join(OUT, rel)))

async function main() {
  const manifest: PackManifest = JSON.parse(readFileSync(path.join(OUT, 'manifest.json'), 'utf8'))
  const secrets = JSON.parse(readFileSync(path.join(CONTENT, 'secrets.json'), 'utf8')) as { codes: Partial<Record<Role, string>> }
  console.log(`Pack v${manifest.version} · ${manifest.slots.length} key slots`)

  let sample: CoreDataFile | undefined
  const roles = Object.keys(secrets.codes) as Role[]
  ok(manifest.slots.length === roles.length, `manifest has exactly ${roles.length} key slots (${roles.join(', ')})`)
  for (const role of roles) {
    const slot = await unlock(manifest, secrets.codes[role]!)
    ok(slot?.role === role, `${role} code opens the ${role} slot`)
    if (!slot) continue
    const core = await importKey(fromB64(slot.keys.core))
    const index = await openJson<PackIndex>(core, read(manifest.index))
    const coreEntry = index.files[index.data.core]
    sample = await openJson<CoreDataFile>(core, read(coreEntry.parts[0]))
    const rEntry = index.files[index.data.restricted!]
    if (role === 'guest') {
      ok(!slot.keys.restricted, 'guest slot carries no blacklist key')
      let opened = false
      try {
        await open(core, read(rEntry.parts[0]))
        opened = true
      } catch {
        /* expected */
      }
      ok(!opened, 'blacklist file cannot be decrypted with the core key')
    } else {
      const rk = await importKey(fromB64(slot.keys.restricted!))
      await open(rk, read(rEntry.parts[0]))
      ok(true, `${role} can decrypt the blacklist`)
    }
  }
  ok((await unlock(manifest, 'AAAA-BBBB-CCCC-DDDD')) === null, 'a wrong code opens nothing')

  // plaintext scan: nothing recognisable may appear in any published file
  // Probes are ≥ 6 bytes: in ~300 MB of ciphertext a given 4-byte string appears by chance (~7%), 6 bytes practically never.
  const needles = new Set<string>(['mbc.net', 'Editorial', 'TXMHD-', 'DALET ', 'Morning', 'segmentation', 'Shift ROTA'])
  for (const s of sample?.data.staff.slice(0, 10) ?? []) if (s.name.length >= 6) needles.add(s.name)
  for (const c of sample?.data.contacts.slice(0, 10) ?? []) if (c.email) needles.add(c.email)
  const files = ['manifest.json', ...readdirSync(path.join(OUT, 'f')).map((f) => `f/${f}`)]
  const hits: string[] = []
  for (const f of files) {
    const text = Buffer.from(read(f)).toString('latin1')
    for (const n of needles) if (text.includes(n)) hits.push(`${f}: “${n}”`)
  }
  ok(hits.length === 0, `no plaintext found in ${files.length} published files (${needles.size} probes)${hits.length ? ' — ' + hits.slice(0, 5).join(', ') : ''}`)

  if (failures) {
    console.error(`\n${failures} check(s) failed — do not publish.`)
    process.exit(1)
  }
  console.log('\nPack verified — safe to publish.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
