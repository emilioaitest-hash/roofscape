import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { BRAND } from '../brand.js'

/**
 * Everything Roofscape knows lives under one directory, so a whole installation
 * is a folder you can copy, back up, or move to a server. The environment
 * variable exists so tests get their own and never touch a real one.
 */
export function dataRoot(): string {
  return process.env.ROOFSCAPE_HOME ?? join(homedir(), BRAND.homeDir)
}

export const skylineDbPath = () => join(dataRoot(), 'skyline.db')

/** A building is a folder: its database, and room for anything else it accrues. */
export const buildingDir = (id: string) => join(dataRoot(), 'buildings', id)
export const buildingDbPath = (id: string) => join(buildingDir(id), 'building.db')

export function ensureDir(path: string): string {
  mkdirSync(path, { recursive: true, mode: 0o700 })
  return path
}
