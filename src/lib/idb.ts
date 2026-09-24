/** IndexedDB access. Everything sensitive is stored sealed (see vault.ts); 'kv' holds only non-sensitive state. */
import { openDB, type IDBPDatabase } from 'idb'

const DB_NAME = 'ee-hub'
const DB_VERSION = 1

type Stores = 'kv' | 'sealed'

let dbp: Promise<IDBPDatabase> | null = null

function db(): Promise<IDBPDatabase> {
  dbp ??= openDB(DB_NAME, DB_VERSION, {
    upgrade(d) {
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv')
      if (!d.objectStoreNames.contains('sealed')) d.createObjectStore('sealed')
    },
  })
  return dbp
}

export async function get<T>(store: Stores, key: string): Promise<T | undefined> {
  return (await db()).get(store, key) as Promise<T | undefined>
}

export async function put(store: Stores, key: string, value: unknown): Promise<void> {
  await (await db()).put(store, value, key)
}

export async function del(store: Stores, key: string): Promise<void> {
  await (await db()).delete(store, key)
}

export async function clearAll(): Promise<void> {
  const d = await db()
  await d.clear('kv')
  await d.clear('sealed')
}
