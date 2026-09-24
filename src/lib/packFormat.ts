/**
 * Encrypted "Hub pack" format — what gets published to GitHub Pages.
 *
 *   pack/manifest.json          plaintext: version, KDF salt, sealed key slots, pointer to index
 *   pack/f/<opaque>.bin         sealed files (index, data, documents, media parts)
 *
 * Each role's access code unlocks one key slot (PBKDF2 → AES-GCM). A slot holds the content keys
 * that role may use: every role gets `core`; all roles except guest also get `restricted`
 * (blacklist). File names are HMACs of content, so unchanged files keep their names and
 * devices never re-download them.
 */
import type { HubData, HubRestricted, Role } from '../data/types'

export const PACK_FORMAT = 'eeh-pack/1'
export const PART_SIZE = 16 * 1024 * 1024

export interface PackManifest {
  format: typeof PACK_FORMAT
  version: number
  builtAt: string
  rev: string // opaque revision id (HMAC of content)
  kdf: { name: 'PBKDF2-SHA256'; iterations: number; salt: string }
  slots: string[] // base64 sealed SlotPayload
  index: string // relative path of the sealed index
}

export interface SlotPayload {
  role: Role
  label: string
  keys: { core: string; restricted?: string }
}

export type KeyName = 'core' | 'restricted'

export interface PackFileEntry {
  parts: string[] // relative paths, in order
  size: number
  mime: string
  sha: string // sha-256 of plaintext
  key: KeyName
  name?: string // original file name, for "download original"
}

export interface PackIndex {
  version: number
  builtAt: string
  files: Record<string, PackFileEntry>
  data: { core: string; restricted?: string } // file ids
}

export interface CoreDataFile {
  version: number
  builtAt: string
  data: HubData
}

export interface RestrictedDataFile {
  version: number
  data: HubRestricted
}

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Administrator',
  manager: 'Department manager',
  editor: 'Editor',
  guest: 'Guest',
}
