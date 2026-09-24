/**
 * Publish: turn this (administrator) device's data into the next version of the encrypted pack.
 * Produces a zip with pack/manifest.json + new sealed files, to be committed to the repository's
 * public/pack/ folder. Existing media files are reused; key slots are unchanged, so every device
 * decrypts the new version with the keys it already holds.
 */
import { zipSync } from 'fflate'
import { randomBytes, sealJson, toHex } from '../lib/crypto'
import type { CoreDataFile, PackFileEntry, PackIndex, PackManifest, RestrictedDataFile } from '../lib/packFormat'
import { PACK_FORMAT } from '../lib/packFormat'
import { useHub } from './store'
import { localFileParts, referencedLocalFileIds } from './localFiles'

const newName = () => `f/${toHex(randomBytes(16))}.bin`

export async function buildPublishZip(): Promise<{ zip: Uint8Array; version: number; files: number }> {
  const s = useHub.getState()
  const { session, manifest, index } = s
  if (!session || !manifest || !index) throw new Error('Connect once so the current published version is known')
  if (!session.keys.restricted) throw new Error('This access level cannot publish')
  const version = Math.max(manifest.version, s.local.packVersion ?? 0) + 1
  const builtAt = new Date().toISOString()
  const out: Record<string, Uint8Array> = {}

  // Data: drop device-only bookkeeping (import rollback snapshots stay on the importing device)
  const data = { ...s.data, imports: s.data.imports.map(({ before: _b, beforeDuties: _d, ...rest }) => rest) }
  const core: CoreDataFile = { version, builtAt, data }
  const restricted: RestrictedDataFile = { version, data: { blacklist: s.blacklist, sheets: s.sheets } }
  const coreBytes = await sealJson(session.keys.core, core)
  const restrictedBytes = await sealJson(session.keys.restricted, restricted)
  const coreName = newName()
  const restrictedName = newName()
  out[`pack/${coreName}`] = coreBytes
  out[`pack/${restrictedName}`] = restrictedBytes

  const files: Record<string, PackFileEntry> = { ...index.files }
  const coreId = `data:core:v${version}`
  const restrictedId = `data:restricted:v${version}`
  delete files[index.data.core]
  if (index.data.restricted) delete files[index.data.restricted]
  files[coreId] = { parts: [coreName], size: coreBytes.length, mime: 'application/json', sha: '', key: 'core' }
  files[restrictedId] = { parts: [restrictedName], size: restrictedBytes.length, mime: 'application/json', sha: '', key: 'restricted' }

  // Files added on this device (imported documents, the blacklist image) travel with the publish
  for (const id of referencedLocalFileIds()) {
    const entry = s.localFiles[id]
    files[id] = entry
    for (const [p, bytes] of Object.entries(await localFileParts(entry))) out[`pack/${p}`] = bytes
  }

  const idx: PackIndex = { version, builtAt, files, data: { core: coreId, restricted: restrictedId } }
  const indexName = newName()
  out[`pack/${indexName}`] = await sealJson(session.keys.core, idx)
  const next: PackManifest = { ...manifest, format: PACK_FORMAT, version, builtAt, rev: toHex(randomBytes(12)), index: indexName }
  out['pack/manifest.json'] = new TextEncoder().encode(JSON.stringify(next, null, 2))
  const readme = [
    `Editing & Editorial Hub — data version ${version}`,
    `Published ${builtAt} by ${s.local.userName ?? session.label}.`,
    '',
    'Upload on GitHub: open the repository, switch to the "gh-pages" branch, open the "pack" folder,',
    'choose Add file > Upload files, and drag in everything from this zip’s "pack" folder',
    '(manifest.json and the "f" folder). Commit. The site updates within a minute or two and',
    'every device picks up the new version the next time it is online.',
  ].join('\n')
  out['README.txt'] = new TextEncoder().encode(readme)
  return { zip: zipSync(out, { level: 0 }), version, files: Object.keys(out).length - 1 }
}
