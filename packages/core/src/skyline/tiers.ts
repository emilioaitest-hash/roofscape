/**
 * A building's drawn form follows its headcount. See docs/decisions/0009.
 *
 * Nothing here is fixed art: a tier supplies a cap, a repeating storey and a
 * ground floor, and the storeys are generated from the staff list. So a building
 * with nine floors really is drawn nine storeys tall, and growing by one hire
 * visibly adds a storey rather than swapping a picture.
 *
 * The seven forms are New York's, by name. They used to be half New York and
 * would not say so — a "brick walk-up" and a "cast-iron block" are New York
 * words wearing a coat — and the one rung that was not a place you could point
 * at was the arcology, which was science fiction. A supertall on Billionaires'
 * Row is the same top of the same ladder and you can see it from the park.
 */

/** Every form is drawn to this width so a skyline lines up. */
export const BUILDING_WIDTH = 11

export type TierName =
  | 'newsstand'
  | 'bodega'
  | 'brownstone'
  | 'cast-iron loft'
  | 'setback tower'
  | 'landmark'
  | 'supertall'

export interface Tier {
  name: TierName
  /** What the owner is told when the building reaches this form. */
  blurb: string
  /** Drawn above the topmost storey. */
  cap: readonly string[]
  /** One storey. `lit` marks windows that should glow. */
  storey: string
  /** The lobby: ground floor, always present, always the way in. */
  ground: readonly string[]
  /** Which character in a storey counts as a window, for lighting. */
  window: string
}

const TIERS: readonly Tier[] = [
  {
    name: 'newsstand',
    // A corner kiosk with an awning over the papers.
    blurb: 'Plywood, a roll-down shutter and one bare bulb. It opens early.',
    cap: ['  ▗▄▄▄▄▄▖  ', '   ┌───┐   '],
    storey: '   │▫ ▫│   ',
    ground: ['   │▫ ▯│   ', '   └───┘   '],
    window: '▫',
  },
  {
    name: 'bodega',
    blurb: 'An awning, a neon OPEN and a cat in the window. Somebody is always in.',
    // The sign board on the parapet, then the striped awning over the shopfront.
    cap: [' ▗▄▄▄▄▄▄▄▖ ', '  │ OPEN│  '],
    storey: '  │▫ ▫ ▫│  ',
    ground: ['  ╱▨▨▨▨▨╲  ', '  │▫ ▯ ▫│  ', '  ╘═════╛  '],
    window: '▫',
  },
  {
    name: 'brownstone',
    blurb: 'A high stoop, tall windows and a proper cornice. People work here.',
    // A water tower on the roof, the cornice under it, and the stoop coming
    // down to the pavement on the right of the parlour door.
    cap: ['    ▟█▙    ', '    ║ ║    ', ' ▄▄▄▄▄▄▄▄▄ ', '  ┌─────┐  '],
    storey: '  │▫ ▫ ▫│  ',
    ground: ['  │▫ ▯ ▫│  ', '  ╘═▃▂▁═╛  '],
    window: '▫',
  },
  {
    name: 'cast-iron loft',
    blurb: 'Painted iron, arched bays, a fire escape down the front. The good part of town.',
    cap: [' ╒═══════╕ ', ' │▁▁▁▁▁▁▁│ '],
    // The left edge of every storey is the fire-escape landing sticking out.
    storey: ' ╞ ∩ ∩ ∩ │ ',
    ground: [' │ ∩ ▯ ∩ │ ', ' ╘═══════╛ '],
    window: '∩',
  },
  {
    name: 'setback tower',
    blurb: 'It steps back as it rises, because the code said so. You can see the crown from the bridge.',
    cap: ['   ▄▄▄▄▄   ', '   │▪▪▪│   ', ' ▄▄┴─────┴▄', ' │▪▪▪▪▪▪▪▪│'],
    storey: ' │▪▪ ▪▪ ▪▪│',
    ground: [' │▪▪ ▯▯ ▪▪│', ' ╘════════╛'],
    window: '▪',
  },
  {
    name: 'landmark',
    blurb: 'A spire, a lantern and one gargoyle. People give directions by it.',
    cap: ['     ╷     ', '    ╱▲╲    ', '   ╱───╲   ', '   │▪▪▪│   ', ' ▄▄┴─────┴▄', ' │▪▪▪▪▪▪▪▪│'],
    storey: ' │▪▪ ▪▪ ▪▪│',
    ground: [' │▪▪ ▯▯ ▪▪│', ' ╘════════╛'],
    window: '▪',
  },
  {
    name: 'supertall',
    blurb: 'Sixty feet wide, and it keeps going. There is still a crane on the top.',
    // The crane is not finished with it yet, which is true of every one of them.
    cap: ['  ╶──┬───╴ ', '     │     ', '     │     ', '   ┌─┴─┐   '],
    storey: '   │▪▪▪│   ',
    ground: ['   │▪▯▪│   ', '   ╘═══╛   '],
    window: '▪',
  },
]

/** Lower bound of each tier, by headcount. */
const THRESHOLDS = [1, 2, 3, 5, 8, 12, 18] as const

export function tierOf(headcount: number): Tier {
  const n = Math.max(1, Math.floor(headcount))
  let index = 0
  for (let i = 0; i < THRESHOLDS.length; i++) {
    if (n >= THRESHOLDS[i]!) index = i
  }
  return TIERS[index]!
}

/** The headcount at which this building next changes form, or null at the top. */
export function nextTierAt(headcount: number): number | null {
  const n = Math.max(1, Math.floor(headcount))
  for (const t of THRESHOLDS) if (t > n) return t
  return null
}

export const allTiers = (): readonly Tier[] => TIERS

/**
 * How tall a building is, said the way both renderers say it.
 *
 * Every nameplate used to read "N on staff", which was the floor count wearing
 * the word for people — and those are not the same number. The curator works in
 * the archives, below ground, so it is staff and is not a storey: a building
 * should not appear to grow because it started tidying up. A six-floor building
 * with a curator in it therefore had seven people and a sign saying six.
 *
 * Floors are the honest word here, and the better one besides: it is the number
 * you can count on the drawing in front of you.
 */
export const floorsSaid = (floors: number): string => {
  const n = Math.max(0, Math.floor(Number.isFinite(floors) ? floors : 0))
  // A tally of nothing is worse than no tally. "0 floors" is the caption on the
  // one screen where the owner most needs telling what to do, and it spends that
  // line saying nothing happened. An empty building has nobody in it; say that,
  // and the sentence next to it can be the one that offers to fix it.
  if (n === 0) return 'nobody in yet'
  return n === 1 ? '1 floor' : `${n} floors`
}
