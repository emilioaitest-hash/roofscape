import type { DatabaseSync } from 'node:sqlite'
import { openDatabase, toJson, fromJson, now, allAs, getAs } from './open.js'
import { SKYLINE_MIGRATIONS } from './schema/skyline.js'
import { skylineDbPath } from './paths.js'
import { slugify } from './idgen.js'
import { asBuildingId, type BuildingId } from '../domain/ids.js'
import type { Budget, Building } from '../domain/building.js'

export interface BreakGroundInput {
  name: string
  charter: string
  workspace: string
  repos?: readonly string[]
  budget?: Partial<Budget>
}

export interface ProviderRecord {
  name: string
  baseUrl: string | null
  credentialKind: 'literal' | 'env' | 'none'
  credential: string | null
}

const DEFAULT_BUDGET: Budget = { monthlyTokens: null, perTaskTokens: 120_000 }

interface BuildingRow {
  id: string
  name: string
  charter: string
  workspace: string
  repos: string
  budget: string
  created_at: string
  closed_at: string | null
}

/** The registry of buildings, the owner's own details, and provider credentials. */
export class SkylineStore {
  private constructor(private readonly db: DatabaseSync) {}

  static open(path = skylineDbPath()): SkylineStore {
    return new SkylineStore(openDatabase(path, SKYLINE_MIGRATIONS))
  }

  close(): void {
    this.db.close()
  }

  /**
   * Break ground on a building. The id is a slug of the name because it is also
   * the folder the building lives in, and a folder you cannot read is a folder
   * you cannot back up with any confidence.
   */
  breakGround(input: BreakGroundInput): Building {
    const base = slugify(input.name)
    let id = base
    for (let n = 2; this.exists(id); n++) id = `${base}-${n}`

    const building: Building = {
      id: asBuildingId(id),
      name: input.name,
      charter: input.charter,
      workspace: input.workspace,
      repos: input.repos ?? [],
      budget: { ...DEFAULT_BUDGET, ...input.budget },
      createdAt: now(),
      closedAt: null,
    }

    this.db
      .prepare(
        `insert into buildings (id, name, charter, workspace, repos, budget, created_at, closed_at)
         values (?, ?, ?, ?, ?, ?, ?, null)`,
      )
      .run(
        building.id,
        building.name,
        building.charter,
        building.workspace,
        toJson(building.repos),
        toJson(building.budget),
        building.createdAt,
      )
    return building
  }

  private exists(id: string): boolean {
    return this.db.prepare('select 1 from buildings where id = ?').get(id) !== undefined
  }

  get(id: BuildingId): Building | null {
    const row = getAs<BuildingRow>(this.db.prepare('select * from buildings where id = ?'), id)
    return row ? hydrate(row) : null
  }

  byName(name: string): Building | null {
    const row = getAs<BuildingRow>(this.db.prepare('select * from buildings where name = ?'), name)
    return row ? hydrate(row) : null
  }

  /** Open buildings first, oldest first — the order a skyline grew in. */
  list(options: { includeClosed?: boolean } = {}): Building[] {
    const sql = options.includeClosed
      ? 'select * from buildings order by created_at'
      : 'select * from buildings where closed_at is null order by created_at'
    return allAs<BuildingRow>(this.db.prepare(sql)).map(hydrate)
  }

  /** Mothball a building. Nothing is deleted; its folder stays where it is. */
  close_building(id: BuildingId): void {
    this.db.prepare('update buildings set closed_at = ? where id = ?').run(now(), id)
  }

  setBudget(id: BuildingId, budget: Budget): void {
    this.db.prepare('update buildings set budget = ? where id = ?').run(toJson(budget), id)
  }

  addRepo(id: BuildingId, repo: string): void {
    const building = this.get(id)
    if (!building) throw new Error(`No building ${id}`)
    if (building.repos.includes(repo)) return
    this.db.prepare('update buildings set repos = ? where id = ?').run(toJson([...building.repos, repo]), id)
  }

  owner(): { name: string; profile: string } {
    return getAs<{ name: string; profile: string }>(
      this.db.prepare('select name, profile from owner where id = 1'),
    )!
  }

  setOwner(patch: Partial<{ name: string; profile: string }>): void {
    const current = this.owner()
    this.db
      .prepare('update owner set name = ?, profile = ?, updated_at = ? where id = 1')
      .run(patch.name ?? current.name, patch.profile ?? current.profile, now())
  }

  putProvider(record: ProviderRecord): void {
    this.db
      .prepare(
        `insert into providers (name, base_url, credential, credential_kind, added_at)
         values (?, ?, ?, ?, ?)
         on conflict (name) do update set
           base_url = excluded.base_url,
           credential = excluded.credential,
           credential_kind = excluded.credential_kind`,
      )
      .run(record.name, record.baseUrl, record.credential, record.credentialKind, now())
  }

  providers(): ProviderRecord[] {
    const rows = allAs<{
      name: string
      base_url: string | null
      credential: string | null
      credential_kind: string
    }>(this.db.prepare('select * from providers order by name'))
    return rows.map((r) => ({
      name: r.name,
      baseUrl: r.base_url,
      credential: r.credential,
      credentialKind: r.credential_kind as ProviderRecord['credentialKind'],
    }))
  }

  /**
   * The secret itself, wherever it actually lives. An `env` credential is only
   * ever a variable name here, so the database can be copied around without
   * carrying the key with it.
   */
  credentialFor(providerName: string): string | null {
    const record = this.providers().find((p) => p.name === providerName)
    if (!record || record.credentialKind === 'none' || record.credential === null) return null
    if (record.credentialKind === 'env') return process.env[record.credential] ?? null
    return record.credential
  }

  setting(key: string): string | null {
    const row = getAs<{ value: string }>(this.db.prepare('select value from settings where key = ?'), key)
    return row?.value ?? null
  }

  setSetting(key: string, value: string): void {
    this.db
      .prepare('insert into settings (key, value) values (?, ?) on conflict (key) do update set value = excluded.value')
      .run(key, value)
  }
}

const hydrate = (row: BuildingRow): Building => ({
  id: asBuildingId(row.id),
  name: row.name,
  charter: row.charter,
  workspace: row.workspace,
  repos: fromJson<string[]>(row.repos, []),
  budget: fromJson<Budget>(row.budget, DEFAULT_BUDGET),
  createdAt: row.created_at,
  closedAt: row.closed_at,
})
