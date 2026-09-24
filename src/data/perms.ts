import type { Role } from './types'

export interface Perms {
  viewBlacklist: boolean
  editBlacklist: boolean
  editRota: boolean
  importRota: boolean
  editStaff: boolean
  editContacts: boolean
  editDocs: boolean
  exportBackup: boolean
  restoreBackup: boolean
  viewAudit: boolean
  admin: boolean
}

/**
 * Role matrix. Enforcement is local to each device; the blacklist is additionally protected
 * cryptographically — the guest access code never receives its key.
 */
export const PERMS: Record<Role, Perms> = {
  admin: { viewBlacklist: true, editBlacklist: true, editRota: true, importRota: true, editStaff: true, editContacts: true, editDocs: true, exportBackup: true, restoreBackup: true, viewAudit: true, admin: true },
  manager: { viewBlacklist: true, editBlacklist: true, editRota: true, importRota: true, editStaff: true, editContacts: true, editDocs: false, exportBackup: true, restoreBackup: false, viewAudit: true, admin: false },
  editor: { viewBlacklist: true, editBlacklist: false, editRota: false, importRota: false, editStaff: false, editContacts: false, editDocs: false, exportBackup: false, restoreBackup: false, viewAudit: false, admin: false },
  guest: { viewBlacklist: false, editBlacklist: false, editRota: false, importRota: false, editStaff: false, editContacts: false, editDocs: false, exportBackup: false, restoreBackup: false, viewAudit: false, admin: false },
}
