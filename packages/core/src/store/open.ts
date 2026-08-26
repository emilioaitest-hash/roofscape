import { DatabaseSync } from 'node:sqlite'
import { dirname } from 'node:path'
import { ensureDir } from './paths.js'

export interface Migration {
  /** Monotonic. Never renumber or rewrite one that has shipped. */
  id: number
  name: string
  sql: string
}

/**
 * Open a database, apply any migrations it has not seen, and hand it back ready.
 *
 * Migrations are applied inside a transaction each, so a failure leaves the
 * database at the last good version rather than half-way through one.
 */
export function openDatabase(path: string, migrations: readonly Migration[]): DatabaseSync {
  if (path !== ':memory:') ensureDir(dirname(path))
  const db = new DatabaseSync(path)

  // Before anything that can contend. Switching to WAL takes an exclusive lock,
  // and with no busy timeout set yet it fails outright rather than waiting —
  // so two processes opening the same new database at once had a real chance of
  // one of them simply erroring. Found by running five writers against one
  // building; it failed about one run in six.
  db.exec('pragma busy_timeout = 5000')
  db.exec('pragma journal_mode = wal')
  db.exec('pragma foreign_keys = on')
  // Durability over speed: an agent's work log is not worth losing to a crash.
  db.exec('pragma synchronous = normal')

  migrate(db, migrations)
  return db
}

/**
 * Apply what has not been applied, under one exclusive lock.
 *
 * All of it in a single `begin immediate`, not a transaction per migration: the
 * race is between reading which have been applied and applying them, so a
 * second process must not be able to read that list while the first is acting
 * on it. It waits for the write lock instead, and then finds there is nothing
 * to do.
 */
function migrate(db: DatabaseSync, migrations: readonly Migration[]): void {
  db.exec('begin immediate')
  try {
    db.exec(`create table if not exists applied_migrations (
      id integer primary key,
      name text not null,
      applied_at text not null
    )`)

    const seen = new Set(
      (db.prepare('select id from applied_migrations').all() as Array<{ id: number }>).map((r) => r.id),
    )

    for (const migration of [...migrations].sort((a, b) => a.id - b.id)) {
      if (seen.has(migration.id)) continue
      try {
        db.exec(migration.sql)
      } catch (cause) {
        throw new Error(`Migration ${migration.id} (${migration.name}) failed: ${(cause as Error).message}`, { cause })
      }
      db.prepare('insert into applied_migrations (id, name, applied_at) values (?, ?, ?)').run(
        migration.id,
        migration.name,
        new Date().toISOString(),
      )
    }
    db.exec('commit')
  } catch (error) {
    // A failure leaves the database at the last good version rather than
    // half-way through one.
    try {
      db.exec('rollback')
    } catch {
      // Already rolled back by SQLite; nothing useful to add.
    }
    throw error
  }
}

/** JSON in, text out — SQLite has no array type and we want none. */
export const toJson = (value: unknown): string => JSON.stringify(value)
export const fromJson = <T>(text: string | null, fallback: T): T =>
  text === null ? fallback : (JSON.parse(text) as T)

export const toBool = (value: boolean): number => (value ? 1 : 0)
export const fromBool = (value: number): boolean => value !== 0

export const now = (): string => new Date().toISOString()

/**
 * node:sqlite hands back `Record<string, SQLOutputValue>`, which overlaps with
 * nothing. These two put the cast in one place instead of at every call site.
 */
export function allAs<T>(stmt: { all: (...p: never[]) => unknown }, ...params: unknown[]): T[] {
  return (stmt.all as (...p: unknown[]) => unknown)(...params) as T[]
}

export function getAs<T>(stmt: { get: (...p: never[]) => unknown }, ...params: unknown[]): T | undefined {
  return (stmt.get as (...p: unknown[]) => unknown)(...params) as T | undefined
}
