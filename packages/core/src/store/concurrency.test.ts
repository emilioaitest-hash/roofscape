import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { BuildingStore } from './buildingStore.js'
import { asBuildingId } from '../domain/ids.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const CORE = join(HERE, '..', 'index.js')

/** A separate process, because this race only exists between real processes. */
function writer(db: string, tag: string, count: number): Promise<void> {
  const source = `
    import { BuildingStore } from ${JSON.stringify(CORE)}
    const b = BuildingStore.open('t', ${JSON.stringify(db)})
    for (let i = 0; i < ${count}; i++) {
      b.remember({ scope: 'building', layer: 'episodic', text: '${tag} ' + i })
    }
    b.close()
  `
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', source], {
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    let err = ''
    child.stderr.on('data', (chunk) => { err += String(chunk) })
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${tag}: ${err.slice(0, 300)}`))))
  })
}

test('several processes can open one building at once without one of them failing', async () => {
  // `pragma journal_mode = wal` takes an exclusive lock, and it used to run
  // before `busy_timeout` was set — so it failed outright instead of waiting,
  // and one of five writers against a brand-new building died about one run in
  // six. The daemon and the CLI open the same building routinely.
  const dir = mkdtempSync(join(tmpdir(), 'roofscape-conc-'))
  const db = join(dir, 'building.db')
  try {
    const tags = ['a', 'b', 'c', 'd']
    const each = 120
    await Promise.all(tags.map((tag) => writer(db, tag, each)))

    const store = BuildingStore.open(asBuildingId('t'), db)
    try {
      assert.equal(store.memoryCount(), tags.length * each, 'every write from every process landed')
    } finally {
      store.close()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a second process opening a fresh database does not re-run the migrations', async () => {
  // The race was between reading which migrations had been applied and applying
  // them. Two processes could both read "none applied" and both try.
  const dir = mkdtempSync(join(tmpdir(), 'roofscape-mig-'))
  const db = join(dir, 'building.db')
  try {
    await Promise.all([writer(db, 'x', 1), writer(db, 'y', 1), writer(db, 'z', 1)])
    const store = BuildingStore.open(asBuildingId('t'), db)
    try {
      assert.equal(store.memoryCount(), 3)
      assert.equal(store.archiveStats().total, 3, 'and the schema is intact afterwards')
    } finally {
      store.close()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
