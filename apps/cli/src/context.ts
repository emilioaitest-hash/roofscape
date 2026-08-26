import { SkylineStore, BuildingStore, dataRoot, type Building, type BuildingId } from '@app/core'
import { fail, dim, say } from './ui.js'

export const openSkyline = (): SkylineStore => SkylineStore.open()

/** Find a building by id or by name, and say something useful when it is neither. */
export function findBuilding(skyline: SkylineStore, needle: string | undefined): Building {
  const all = skyline.list()
  if (all.length === 0) {
    fail('There are no buildings yet.', 'Break ground on one:  roofscape ground "My Project"')
  }

  if (!needle) {
    if (all.length === 1) return all[0]!
    say(dim('More than one building. Name which one with --building:'))
    for (const building of all) say(dim(`  ${building.id}`))
    fail('Which building?')
  }

  const found =
    all.find((b) => b.id === needle) ??
    all.find((b) => b.name.toLowerCase() === needle.toLowerCase()) ??
    all.find((b) => b.id.startsWith(needle))
  if (!found) fail(`No building called "${needle}".`, `Known: ${all.map((b) => b.id).join(', ')}`)
  return found
}

export const openBuilding = (id: BuildingId): BuildingStore => BuildingStore.open(id)

export const where = (): string => dataRoot()
